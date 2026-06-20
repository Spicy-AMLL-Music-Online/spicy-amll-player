/**
 * song-downloader.js
 * Handles fetching audio tracks via M4A/conversion backends.
 */

document.addEventListener('DOMContentLoaded', () => {
  const inputEl = document.getElementById('dl-song-input');
  const formatSelect = document.getElementById('dl-song-format');
  const fetchBtn = document.getElementById('fetch-song-btn');
  const btnText = fetchBtn.querySelector('.btn-text');
  const btnLoader = fetchBtn.querySelector('.btn-loader');
  const statusEl = document.getElementById('dl-song-status');
  const searchResultsEl = document.getElementById('dl-search-results');

  const setStatus = (message, isError = false) => {
    statusEl.textContent = message;
    statusEl.className = 'status-indicator ' + (isError ? 'error showing' : 'showing');
    setTimeout(() => { if (statusEl.textContent === message) statusEl.classList.remove('showing'); }, 5000);
  };

  const setLoading = (loading) => {
    fetchBtn.disabled = loading;
    if (loading) {
      btnText.classList.add('hidden');
      btnLoader.classList.remove('hidden');
    } else {
      btnText.classList.remove('hidden');
      btnLoader.classList.add('hidden');
    }
  };

  const triggerDownload = (url, filename) => {
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  const downloadTrack = (songId, name) => {
    const format = formatSelect.value;
    searchResultsEl.classList.add('hidden');
    
    if (format === 'm4a') {
      // Original M4A download
      const url = `https://api.spicyamll.online/download?song=${songId}`;
      setStatus(`Starting direct M4A download for ${name || songId}...`);
      triggerDownload(url, `Song_${songId}.m4a`);
      setLoading(false);
    } else {
      // Convert to mp3/flac using our backend
      setStatus(`Requesting conversion to ${format.toUpperCase()} for ${name || songId}... this may take a moment.`);
      const url = `https://api.spicyamll.online/convert?song=${songId}&fmt=${format}`;
      triggerDownload(url, `Song_${songId}.${format}`);
      setStatus('Conversion requested. Download will start automatically when ready.');
      setLoading(false);
    }
  };

  const processDownload = async () => {
    const query = inputEl.value.trim();
    if (!query) {
      setStatus('Please enter a Song ID or Search Term.', true);
      return;
    }

    setLoading(true);
    searchResultsEl.classList.add('hidden');
    searchResultsEl.innerHTML = '';

    try {
      // If it's not a pure number, maybe it's a search term
      if (!/^\d+$/.test(query)) {
        setStatus('Searching for tracks...');
        const searchRes = await fetch(`https://api.spicyamll.online/search?term=${encodeURIComponent(query)}&types=songs&limit=10`);
        if (!searchRes.ok) throw new Error('Search failed');
        const searchData = await searchRes.json();

        let foundSongs = searchData?.results?.songs?.data;
        if (!foundSongs || foundSongs.length === 0) {
          throw new Error('No songs found for that query.');
        }

        // Render search results
        setStatus(`Found ${foundSongs.length} results. Select one to download.`);
        setLoading(false);
        btnText.textContent = 'Search';
        
        foundSongs.forEach(song => {
          const attr = song.attributes;
          const artUrl = attr.artwork?.url ? attr.artwork.url.replace('{w}', '100').replace('{h}', '100') : '';
          
          const itemEl = document.createElement('div');
          itemEl.className = 'dl-search-item';

          const imgEl = document.createElement('img');
          imgEl.className = 'dl-search-art';
          imgEl.alt = 'Art';
          imgEl.src = artUrl;

          const infoEl = document.createElement('div');
          infoEl.className = 'dl-search-info';

          const titleEl = document.createElement('h4');
          titleEl.className = 'dl-search-title';
          titleEl.textContent = attr.name;

          const artistEl = document.createElement('p');
          artistEl.className = 'dl-search-artist';
          artistEl.textContent = attr.artistName;

          infoEl.appendChild(titleEl);
          infoEl.appendChild(artistEl);
          itemEl.appendChild(imgEl);
          itemEl.appendChild(infoEl);
          
          itemEl.addEventListener('click', () => {
            setLoading(true);
            btnText.textContent = 'Downloading...';
            downloadTrack(song.id, attr.name);
          });
          
          searchResultsEl.appendChild(itemEl);
        });
        
        searchResultsEl.classList.remove('hidden');

      } else {
        // Pure number -> Direct Download
        setStatus('Initiating download via ID...');
        downloadTrack(query, query);
      }

    } catch (e) {
      console.error(e);
      setStatus(e.message || 'Error occurred during download process.', true);
      setLoading(false);
    }
  };

  fetchBtn.addEventListener('click', processDownload);
  inputEl.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') processDownload();
  });
});
