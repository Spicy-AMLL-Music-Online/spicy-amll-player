import { addTrackToQueue, clearQueue, setCurrentIndex, getPlaylists, createPlaylist, addTrackToPlaylist, getPlaylistTracks, playPlaylist, deletePlaylist } from './router.js';
import { parseAudioMetadata } from './metadata-parser.js';
import { getAnimatedArtwork } from './animated-art.js';
import { robustFetch, fetchJson } from './network-utils.js';
import { TTMLDownloader } from './ttml-downloader.js';
import isRtl from './is-rtl.js';
import { escapeHTML } from './security-utils.js';

document.addEventListener('DOMContentLoaded', () => {
  const ttmlZone = document.getElementById('ttml-zone');
  const audioZone = document.getElementById('audio-zone');
  const ttmlInput = document.getElementById('ttml-input');
  const audioInput = document.getElementById('audio-input');
  const startBtn = document.getElementById('start-button');
  const errorEl = document.getElementById('upload-error');

  const queuePreview = document.getElementById('queue-preview');
  const queueList = document.getElementById('queue-list');
  const queueCount = document.getElementById('queue-count');
  const clearQueueBtn = document.getElementById('clear-queue-btn');

  const prepOverlay = document.getElementById('prep-overlay');
  const prepStatus = document.getElementById('prep-status');
  const trendingGrid = document.getElementById('trending-grid');
  const albumsGrid = document.getElementById('albums-grid');

  // Search Elements
  const catalogSearch = document.getElementById('catalog-search');
  const listenInitialContent = document.getElementById('listen-initial-content');
  const searchSearchResults = document.getElementById('search-results-container');
  const searchGrid = document.getElementById('search-grid');
  const searchTitle = document.getElementById('search-results-title');
  const searchBackBtn = document.getElementById('search-back-btn');

  // Album View
  const albumViewContainer = document.getElementById('album-view-container');
  const albumHeader = document.getElementById('album-header');
  const albumTracksGrid = document.getElementById('album-tracks-grid');

  // Artist View
  const artistViewContainer = document.getElementById('artist-view-container');
  const artistViewContent = document.getElementById('artist-view-content');

  // Context Menu & Playlists
  const songContextMenu = document.getElementById('song-context-menu');
  const ctxPlay = document.getElementById('ctx-play');
  const ctxAddPlaylist = document.getElementById('ctx-add-playlist');
  const ctxViewAlbum = document.getElementById('ctx-view-album');
  const ctxViewArtist = document.getElementById('ctx-view-artist');
  const ctxFavorite = document.getElementById('ctx-favorite');
  const ctxCopyId = document.getElementById('ctx-copy-id');

  const playlistModal = document.getElementById('playlist-select-modal');
  const playlistOptionsList = document.getElementById('playlist-options-list');
  const modalCreatePlaylistBtn = document.getElementById('modal-create-playlist-btn');
  const closePlaylistModal = document.getElementById('close-playlist-modal');

  const playlistsGrid = document.getElementById('playlists-grid');
  const playlistDetail = document.getElementById('playlist-detail');
  const playlistDetailTitle = document.getElementById('playlist-detail-title');
  const playlistTracksGrid = document.getElementById('playlist-tracks-grid');
  const playlistBackBtn = document.getElementById('playlist-back-btn');
  const createPlaylistBtn = document.getElementById('create-playlist-btn');

  // TTML Downloader Elements
  const fetchTtmlBtn = document.getElementById('fetch-ttml-btn');
  const ttmlSongIdInput = document.getElementById('ttml-song-id');
  const ttmlResultContainer = document.getElementById('ttml-result-preview');
  const ttmlPreviewName = document.getElementById('ttml-preview-name');
  const ttmlPreviewArtist = document.getElementById('ttml-preview-artist');
  const ttmlPreviewArt = document.getElementById('ttml-preview-art');
  const ttmlCodeBlock = document.getElementById('ttml-code-block');
  const ttmlStatus = document.getElementById('ttml-status');
  const downloadTtmlBtn = document.getElementById('download-ttml-file-btn');

  let currentFetchedTTML = null;
  let currentFetchedSong = null;

  let contextMenuTrack = null;

  let stagedAudio = []; // Array of { file, ttmlFile: null }
  let stagedTTML = [];  // Array of File

  // ── Zone Click ──
  ttmlZone.addEventListener('click', (e) => {
    if (e.target === ttmlInput) return;
    console.log('TTML Zone clicked');
    ttmlInput.click();
  });

  audioZone.addEventListener('click', (e) => {
    if (e.target === audioInput) return;
    console.log('Audio Zone clicked');
    audioInput.click();
  });

  // ── File Input Change ──
  ttmlInput.addEventListener('change', (e) => {
    handleTTMLFiles(Array.from(e.target.files));
  });

  audioInput.addEventListener('change', (e) => {
    handleAudioFiles(Array.from(e.target.files));
  });

  // ── Drag & Drop ──
  [ttmlZone, audioZone].forEach(zone => {
    zone.addEventListener('dragover', (e) => {
      e.preventDefault();
      zone.classList.add('dragover');
    });
    zone.addEventListener('dragleave', () => {
      zone.classList.remove('dragover');
    });
    zone.addEventListener('drop', (e) => {
      e.preventDefault();
      zone.classList.remove('dragover');
      const files = Array.from(e.dataTransfer.files);
      if (files.length === 0) return;

      if (zone === ttmlZone) handleTTMLFiles(files);
      else handleAudioFiles(files);
    });
  });

  // ── File Handlers ──
  function handleTTMLFiles(files) {
    console.log('Processing TTML files:', files.map(f => f.name));
    const validFiles = files.filter(f => {
      const ext = f.name.split('.').pop().toLowerCase();
      return ext === 'ttml' || ext === 'xml';
    });

    if (validFiles.length < files.length) {
      showError('Skipped some non-TTML files.');
    }

    stagedTTML = [...stagedTTML, ...validFiles];
    matchAndRender();
  }

  function handleAudioFiles(files) {
    console.log('Processing audio files:', files.map(f => f.name));
    const audioExts = ['mp3', 'flac', 'wav', 'ogg', 'm4a', 'aac'];
    const playlistExts = ['m3u', 'json'];

    const validAudio = [];
    files.forEach(f => {
      const ext = f.name.split('.').pop().toLowerCase();
      if (audioExts.includes(ext)) {
        validAudio.push({ file: f, ttmlFile: null });
      } else if (playlistExts.includes(ext)) {
        handlePlaylistImport(f);
      }
    });

    if (validAudio.length === 0 && files.length > 0) {
      showError('No valid audio files found.');
    }

    stagedAudio = [...stagedAudio, ...validAudio];
    matchAndRender();
  }

  /**
   * Automatically match audio files with TTML files by name.
   */
  function matchAndRender() {
    clearError();

    stagedAudio.forEach(item => {
      const baseName = item.file.name.replace(/\.[^/.]+$/, "");

      // Look for a matching TTML if not already matched
      if (!item.ttmlFile) {
        const match = stagedTTML.find(tf => tf.name.replace(/\.[^/.]+$/, "") === baseName);
        if (match) item.ttmlFile = match;
      }
    });

    renderQueue();
    checkReady();
  }

  function renderQueue() {
    queueList.innerHTML = '';

    if (stagedAudio.length > 0) {
      queuePreview.classList.add('active');
      queueCount.textContent = `${stagedAudio.length} track${stagedAudio.length > 1 ? 's' : ''}`;
    } else {
      queuePreview.classList.remove('active');
    }

    stagedAudio.forEach((item, index) => {
      const el = document.createElement('div');
      el.className = 'queue-item';
      el.draggable = true;
      el.dataset.index = index;

      // TTML Options
      let ttmlOptions = '<option value="">⏳ Auto-fetch lyrics</option>';
      stagedTTML.forEach((tf, tfIdx) => {
        const isSelected = item.ttmlFile === tf;
        ttmlOptions += `<option value="${tfIdx}" ${isSelected ? 'selected' : ''}>${escapeHTML(tf.name)}</option>`;
      });

      const safeName = escapeHTML(item.file.name);
      const safeArtist = escapeHTML(item.artist || 'Unknown Artist');

      el.innerHTML = `
        <div class="drag-handle">≡</div>
        <div class="queue-item-info">
          <span class="queue-item-name">${safeName}</span>
          <span class="queue-item-meta">${safeArtist}</span>
        </div>
        <div class="queue-pair-controls">
          <select class="ttml-select" data-index="${index}">
            ${ttmlOptions}
          </select>
          <button class="remove-item" data-index="${index}">✕</button>
        </div>
      `;
      queueList.appendChild(el);

      // Drag Events
      el.addEventListener('dragstart', (e) => {
        el.classList.add('dragging');
        e.dataTransfer.setData('text/plain', index);
      });

      el.addEventListener('dragend', () => el.classList.remove('dragging'));
    });

    // Drop Logic for Reordering
    queueList.addEventListener('dragover', (e) => {
      e.preventDefault();
      const draggingEl = queueList.querySelector('.dragging');
      const afterElement = getDragAfterElement(queueList, e.clientY);
      if (afterElement == null) {
        queueList.appendChild(draggingEl);
      } else {
        queueList.insertBefore(draggingEl, afterElement);
      }
    });

    queueList.addEventListener('drop', (e) => {
      e.preventDefault();
      const newOrder = Array.from(queueList.querySelectorAll('.queue-item')).map(item => parseInt(item.dataset.index, 10));
      const reorderedAudio = newOrder.map(idx => stagedAudio[idx]);
      stagedAudio = reorderedAudio;
      // Re-render to update indices if needed, but avoid flickering
      setTimeout(() => renderQueue(), 50);
    });

    // Manual TTML Selection
    queueList.querySelectorAll('.ttml-select').forEach(sel => {
      sel.onchange = (e) => {
        const audioIdx = parseInt(e.target.dataset.index, 10);
        const ttmlIdx = e.target.value;
        if (ttmlIdx === "") {
          stagedAudio[audioIdx].ttmlFile = null;
        } else {
          stagedAudio[audioIdx].ttmlFile = stagedTTML[parseInt(ttmlIdx, 10)];
        }
      };
    });

    // Remove item logic
    queueList.querySelectorAll('.remove-item').forEach(btn => {
      btn.onclick = (e) => {
        const idx = parseInt(e.target.closest('button').dataset.index, 10);
        stagedAudio.splice(idx, 1);
        matchAndRender();
      };
    });
  }

  function getDragAfterElement(container, y) {
    const draggableElements = [...container.querySelectorAll('.queue-item:not(.dragging)')];
    return draggableElements.reduce((closest, child) => {
      const box = child.getBoundingClientRect();
      const offset = y - box.top - box.height / 2;
      if (offset < 0 && offset > closest.offset) {
        return { offset: offset, element: child };
      } else {
        return closest;
      }
    }, { offset: Number.NEGATIVE_INFINITY }).element;
  }

  async function handlePlaylistImport(file) {
    const text = await readFileAsText(file);
    const ext = file.name.split('.').pop().toLowerCase();

    if (ext === 'json') {
      try {
        const data = JSON.parse(text);
        if (data.tracks) {
          showError('JSON Playlist imported. Please ensure matching audio files are uploaded.');
          // Logic for JSON reordering can go here
        }
      } catch (e) {
        showError('Invalid JSON playlist.');
      }
    } else if (ext === 'm3u') {
      showError('M3U playlist detected. Ordering will follow the file list.');
      // Logic for M3U parsing can go here
    }
  }

  function checkReady() {
    if (stagedAudio.length > 0) {
      startBtn.classList.add('enabled');
      startBtn.removeAttribute('disabled');
    } else {
      startBtn.classList.remove('enabled');
      startBtn.setAttribute('disabled', 'true');
    }
  }

  clearQueueBtn.onclick = () => {
    stagedAudio = [];
    stagedTTML = [];
    matchAndRender();
  };

  // ── Start Playback ──
  startBtn.addEventListener('click', async () => {
    if (stagedAudio.length === 0) return;

    const originalText = startBtn.querySelector('span');
    if (originalText) originalText.textContent = 'Preparing Queue...';
    else startBtn.textContent = 'Preparing Queue...';

    startBtn.classList.remove('enabled');
    startBtn.disabled = true;

    try {
      await clearQueue(); // Start fresh

      for (const item of stagedAudio) {
        const audioBuffer = await readFileAsArrayBuffer(item.file);
        const metadata = await parseAudioMetadata(audioBuffer, item.file.name);

        let ttmlContent = null;
        if (item.ttmlFile) {
          ttmlContent = await readFileAsText(item.ttmlFile);
        } else {
          ttmlContent = '__AUTO_FETCH__';
        }

        await addTrackToQueue(audioBuffer, {
          name: metadata.title || item.file.name,
          artist: metadata.artist || 'Unknown Artist',
          artUrl: metadata.artUrl || null,
          type: item.file.type || 'audio/mpeg',
          ttml: ttmlContent
        });
      }

      setCurrentIndex(0);
      window.location.href = 'player.html';
    } catch (err) {
      console.error('Queue processing failed:', err);
      showError('Failed to prepare queue: ' + err.message);
      startBtn.textContent = 'Start Playback';
      startBtn.classList.add('enabled');
      startBtn.disabled = false;
    }
  });

  // ── Sidebar & Mobile Navigation ──
  const navItems = document.querySelectorAll('.am-nav-item, .am-mobile-nav-item');
  const pages = document.querySelectorAll('.am-page');

  navItems.forEach(item => {
    item.addEventListener('click', () => {
      const pageId = item.dataset.page;
      if (!pageId || pageId === 'browse' || pageId === 'radio') return;

      // Update Active Nav (Both sidebar and mobile nav)
      navItems.forEach(i => i.classList.remove('am-nav-active', 'am-mobile-nav-active'));
      document.querySelectorAll(`[data-page="${pageId}"]`).forEach(el => {
        if (el.classList.contains('am-nav-item')) el.classList.add('am-nav-active');
        if (el.classList.contains('am-mobile-nav-item')) el.classList.add('am-mobile-nav-active');
      });

      // Update Active Page
      pages.forEach(p => p.classList.remove('active'));
      const targetPage = document.getElementById(`page-${pageId}`);
      if (targetPage) targetPage.classList.add('active');

      if (pageId === 'listen') {
         // Reset views
         listenInitialContent.style.display = 'block';
         searchSearchResults.classList.add('hidden');
         albumViewContainer.classList.add('hidden');
         artistViewContainer.classList.add('hidden');
         if (catalogSearch) catalogSearch.value = '';
         fetchTrending();
      }
      if (pageId === 'playlists') renderPlaylistsPage();
      if (pageId === 'songs') renderFavoritesPage();
      if (pageId === 'recent') renderRecentPage();
      if (pageId === 'download-ttml') {
        if (ttmlSongIdInput) ttmlSongIdInput.value = '';
        if (ttmlResultContainer) ttmlResultContainer.classList.add('hidden');
        if (ttmlStatus) {
           ttmlStatus.textContent = '';
           ttmlStatus.className = 'status-indicator';
        }
      }
      if (pageId === 'download-song') {
        const dlSongInput = document.getElementById('dl-song-input');
        const dlSongStatus = document.getElementById('dl-song-status');
        if (dlSongInput) dlSongInput.value = '';
        if (dlSongStatus) {
           dlSongStatus.textContent = '';
           dlSongStatus.className = 'status-indicator';
        }
      }
    });
  });

  // ── TTML Downloader Logic (V2) ──
  if (fetchTtmlBtn) {
    const btnText = fetchTtmlBtn.querySelector('.btn-text');
    const btnLoader = fetchTtmlBtn.querySelector('.btn-loader');

    fetchTtmlBtn.onclick = async () => {
      const songId = ttmlSongIdInput.value.trim();
      if (!songId) {
        ttmlStatus.textContent = 'Please enter a valid Song ID.';
        ttmlStatus.className = 'status-indicator error';
        return;
      }

      // Start Loading State
      fetchTtmlBtn.disabled = true;
      if (btnText) btnText.textContent = 'Searching...';
      if (btnLoader) btnLoader.classList.remove('hidden');
      
      ttmlStatus.textContent = '';
      ttmlStatus.className = 'status-indicator';
      ttmlResultContainer.classList.add('hidden');
      downloadTtmlBtn.disabled = true;

      try {
        // 1. Fetch Metadata
        const metadata = await TTMLDownloader.fetchMetadata(songId);
        currentFetchedSong = metadata;
        
        ttmlPreviewName.textContent = metadata.name;
        if (isRtl(metadata.name)) ttmlPreviewName.classList.add('rtl');
        else ttmlPreviewName.classList.remove('rtl');

        ttmlPreviewArtist.textContent = metadata.artist;
        if (isRtl(metadata.artist)) ttmlPreviewArtist.classList.add('rtl');
        else ttmlPreviewArtist.classList.remove('rtl');

        ttmlPreviewArt.src = metadata.artUrl;
        
        if (btnText) btnText.textContent = 'Extracting TTML...';

        // 2. Fetch TTML
        const ttml = await TTMLDownloader.fetchTTML(songId);
        if (!ttml) throw new Error('No TTML content available for this ID.');
        
        currentFetchedTTML = ttml;
        ttmlCodeBlock.textContent = ttml;
        
        // 3. Success State
        ttmlResultContainer.classList.remove('hidden');
        downloadTtmlBtn.disabled = false;
        ttmlStatus.textContent = 'Lyrics successfully extracted!';
        ttmlStatus.className = 'status-indicator success';
        
      } catch (err) {
        console.error('[Downloader] Error:', err);
        ttmlStatus.textContent = err.message;
        ttmlStatus.className = 'status-indicator error';
      } finally {
        fetchTtmlBtn.disabled = false;
        if (btnText) btnText.textContent = 'Fetch Lyrics';
        if (btnLoader) btnLoader.classList.add('hidden');
      }
    };
  }

  if (downloadTtmlBtn) {
    downloadTtmlBtn.onclick = () => {
      if (!currentFetchedTTML || !currentFetchedSong) return;
      
      const filename = `${currentFetchedSong.name} - ${currentFetchedSong.artist}.ttml`;
      TTMLDownloader.download(filename, currentFetchedTTML);
    };
  }

  // ── Listen Now / Trending Logic ──
  let trendingCache = null;
  let albumsCache = null;

  // ── iTunes Search to Apple Music API Mapper ──
  function mapSearchAmToItunes(item) {
    if (!item || !item.attributes) return item;
    const attr = item.attributes;
    const artUrl = attr.artwork?.url ? attr.artwork.url.replace(/{w}/g, '100').replace(/{h}/g, '100') : '';
    return {
      wrapperType: item.type === 'songs' ? 'track' : 'collection',
      trackId: item.id,
      collectionId: item.id,
      trackName: attr.name,
      artistName: attr.artistName,
      artistId: item.relationships?.artists?.data?.[0]?.id || item.artistId || null,
      collectionName: attr.albumName || attr.name,
      artworkUrl100: artUrl,
      releaseDate: attr.releaseDate,
      trackCount: attr.trackCount || 0,
      url: attr.url
    };
  }

  /*
  async function itunesFetch(url) {
    // Strategy 1: Plain fetch (works in test.html)
    try {
      const res = await fetch(url, { mode: 'cors', credentials: 'omit' });
      if (res.ok) return await res.json();
      console.warn(`[iTunes] Direct fetch returned ${res.status}`);
    } catch (e) {
      console.warn(`[iTunes] Direct fetch failed:`, e.message);
    }

    // Strategy 2: allorigins proxy
    try {
      const proxyUrl = `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`;
      const res = await fetch(proxyUrl);
      if (res.ok) return await res.json();
    } catch (e) {
      console.warn(`[iTunes] allorigins proxy failed:`, e.message);
    }

    // Strategy 3: corsproxy
    try {
      const proxyUrl = `https://proxy.corsfix.com/?${encodeURIComponent(url)}`;
      const res = await fetch(proxyUrl);
      if (res.ok) return await res.json();
    } catch (e) {
      console.warn(`[iTunes] corsfix proxy failed:`, e.message);
    }

    throw new Error('All fetch strategies failed for: ' + url);
  }*/ // ehh

  async function fetchTrending() {
    if (trendingCache && albumsCache) {
      renderListenNow(trendingCache);
      renderFeaturedAlbums(albumsCache);
      return;
    }

    try {
      const songsRes = await fetch(
        "https://api.spicyamll.online/search?term=pop&types=songs&limit=15"
      );
      if (!songsRes.ok) throw new Error(`holy shit ${songsRes.status}`);
      const songsData = await songsRes.json();

      trendingCache = songsData.results?.songs?.data?.map(mapSearchAmToItunes) || [];
      renderListenNow(trendingCache);

      const albumsRes = await fetch(
        "https://api.spicyamll.online/search?term=2024&types=albums&limit=6"
      );
      if (!albumsRes.ok) throw new Error(`holy shit ${albumsRes.status}`);
      const albumsData = await albumsRes.json();

      albumsCache = albumsData.results?.albums?.data?.map(mapSearchAmToItunes) || [];
      renderFeaturedAlbums(albumsCache);

    } catch (err) {
      console.error("Failed to fetch trending:", err);
      if (trendingGrid) {
        trendingGrid.innerHTML = `<div class="am-error-msg">Failed to load trending. Try refreshing.</div>`;
      }
    }
  }

  function renderListenNow(songs) {
    if (!trendingGrid) return;
    trendingGrid.innerHTML = songs.map(song => {
      const highResArt = song.artworkUrl100.replace('100x100', '600x600');
      const safeName = escapeHTML(song.trackName);
      const safeArtist = escapeHTML(song.artistName);
      return `
        <div class="trending-card animate-fade" data-id="${song.trackId}">
          <div class="trending-art">
            <img src="${highResArt}" loading="lazy" alt="${safeName}">
          </div>
          <div class="trending-info">
            <h4>${safeName}</h4>
            <p>${safeArtist}</p>
          </div>
        </div>
      `;
    }).join('');

    // Add Context Menu Listeners
    trendingGrid.querySelectorAll('.trending-card').forEach(card => {
      card.onclick = (e) => {
        const id = card.dataset.id;
        const song = songs.find(s => s.trackId == id);
        if (song) showContextMenu(e, song);
      };
    });
  }

  function renderFeaturedAlbums(albums) {
    if (!albumsGrid) return;
    albumsGrid.innerHTML = albums.map(album => {
      const safeName = escapeHTML(album.collectionName);
      const safeArtist = escapeHTML(album.artistName);
      return `
      <div class="album-card animate-fade" data-query="${safeName} ${safeArtist}">
        <img src="${album.artworkUrl100.replace('100x100', '300x300')}" class="album-art" loading="lazy">
        <div class="album-info">
          <h4>${safeName}</h4>
          <p>${safeArtist}</p>
        </div>
      </div>
    `;
    }).join('');

    albumsGrid.querySelectorAll('.album-card').forEach(card => {
      card.onclick = async () => {
        const query = card.dataset.query;
        // In real Apple Music click opens album directly, here we simulate by fetching album items if we have ID. Since it's a search result, let's look up by exact keyword or switch to openAlbum
        let album = albums.find(a => (a.collectionName + " " + a.artistName) === query);
        if(album) {
            openAlbumView(album.collectionId, album.collectionName, album.artistName, album.artworkUrl100);
        } else {
             if (catalogSearch) { catalogSearch.value = query; performSearch(); }
        }
      };
    });
  }

  // ── Search Logic ──
  if (catalogSearch) {
    catalogSearch.onkeypress = (e) => {
      if (e.key === 'Enter') performSearch();
    };
  }


  if (searchBackBtn) {
    searchBackBtn.onclick = clearSearch;
  }

  async function performSearch() {
    const query = catalogSearch.value.trim();
    if (!query) {
      clearSearch();
      return;
    }

    // Handle /songid command
    if (query.startsWith('/songid ')) {
      const id = query.replace('/songid ', '').trim();
      if (id && /^\d+$/.test(id)) {
        loadTrackById(id);
        return;
      }
    }

    listenInitialContent.style.display = 'none';
    albumViewContainer.classList.add('hidden');
    artistViewContainer.classList.add('hidden');
    searchSearchResults.classList.remove('hidden');
    searchTitle.textContent = `Results for "${query}"`;
    searchGrid.innerHTML = `<div class="am-loading-msg">Searching catalog...</div>`;

    try {
      // const data = await itunesFetch(`https://itunes.apple.com/search?term=${encodeURIComponent(query)}&entity=song&limit=25`);
      const res = await fetch(`https://api.spicyamll.online/search?term=${encodeURIComponent(query)}&types=songs&limit=25`);
      const data = await res.json();
      renderSearchResults(data.results?.songs?.data?.map(mapSearchAmToItunes) || []);
    } catch (err) {
      console.error("Search failed:", err);
      searchGrid.innerHTML = `<div class="am-error-msg">Search failed. Check your connection.</div>`;
    }
  }

  function clearSearch() {
    if(catalogSearch) catalogSearch.value = '';
    listenInitialContent.style.display = 'block';
    searchSearchResults.classList.add('hidden');
    albumViewContainer.classList.add('hidden');
    artistViewContainer.classList.add('hidden');
  }

  function renderSearchResults(results) {
    if (!searchGrid) return;
    if (results.length === 0) {
      searchGrid.innerHTML = `<div class="am-error-msg">No results found.</div>`;
      return;
    }

    searchGrid.innerHTML = results.map(track => {
      const highResArt = track.artworkUrl100.replace('100x100', '600x600');
      const safeName = escapeHTML(track.trackName);
      const safeArtist = escapeHTML(track.artistName);
      return `
        <div class="trending-card animate-fade" data-id="${track.trackId}">
          <div class="trending-art">
             <img src="${highResArt}" loading="lazy" alt="${safeName}">
          </div>
          <div class="trending-info">
             <h4>${safeName}</h4>
             <p>${safeArtist}</p>
          </div>
        </div>
      `;
    }).join('');

    searchGrid.querySelectorAll('.trending-card').forEach(card => {
      card.onclick = (e) => {
        const id = card.dataset.id;
        const song = results.find(s => s.trackId == id);
        if (song) showContextMenu(e, song);
      };
    });
  }

  async function loadRemoteTrack(song) {
    if (!prepOverlay) return;

    addToRecent(song);

    prepOverlay.classList.add('active');
    prepStatus.textContent = "Downloading Track...";

    try {
      // 1. Fetch Audio Buffer from AMLL Server (Corrected URL)
      const audioUrl = `https://api.spicyamll.online/download?song=${song.trackId}`;
      const response = await robustFetch(audioUrl, { skipProxy: true });
      const audioBuffer = await response.arrayBuffer();

      prepStatus.textContent = "Processing Metadata...";

      // 2. Prepare Metadata
      const metadata = {
        name: song.trackName,
        artist: song.artistName,
        album: song.collectionName,
        artUrl: song.artworkUrl100.replace('100x100', '600x600'),
        type: isMP4Buffer(audioBuffer) ? 'audio/mp4' : 'audio/mpeg',
        ttml: '__AUTO_FETCH__',
        amTrackId: song.trackId
      };

      // Enrich with parser data if possible (e.g. if the file has better internal tags)
      const parsed = await parseAudioMetadata(audioBuffer, song.trackName);
      if (parsed.title && parsed.title !== song.trackName) metadata.name = parsed.title;
      if (parsed.artist && parsed.artist !== 'Unknown Artist') metadata.artist = parsed.artist;

      // 3. Clear and Add to Queue
      await clearQueue();
      await addTrackToQueue(audioBuffer, metadata);

      // 4. Go to Player
      setCurrentIndex(0);
      window.location.href = 'player.html';

    } catch (err) {
      console.error("Remote load failed:", err);
      prepOverlay.classList.remove('active');

      const serverUrl = `https://api.spicyamll.online/download?song=${song.trackId}`;
      const msg = `Failed to load track. This often happens if the server is 'sleeping'.\n\nTry clicking OK, then opening this link once to wake it up:\n${serverUrl}\n\nError: ${err.message}`;
      alert(msg);
    }
  }

  async function loadTrackById(id) {
    if (!prepOverlay) return;
    
    prepOverlay.classList.add('active');
    prepStatus.textContent = "Fetching metadata...";
    
    try {
      let song = null;

      // Try 1: Try Spicy AMLL backend's iTunes lookup
      try {
        console.log(`[ID Loader] Trying backend iTunes lookup for ${id}...`);
        const res = await fetch(`https://api.spicyamll.online/itunes/lookup?id=${id}`);
        if (res.ok) {
          const data = await res.json();
          if (data.results && data.results.length > 0) {
            song = data.results[0];
          }
        }
      } catch (err) {
        console.warn("[ID Loader] Backend iTunes lookup failed:", err);
      }

      // Try 2: Try direct iTunes lookup via robustFetch (with CORS proxy rotation)
      if (!song) {
        try {
          console.log(`[ID Loader] Trying direct iTunes lookup via robustFetch for ${id}...`);
          const res = await robustFetch(`https://itunes.apple.com/lookup?id=${id}`);
          if (res.ok) {
            const data = await res.json();
            if (data.results && data.results.length > 0) {
              song = data.results[0];
            }
          }
        } catch (err) {
          console.warn("[ID Loader] Direct iTunes lookup via robustFetch failed:", err);
        }
      }

      // Try 3: Fallback to Apple Music API catalog search by term
      if (!song) {
        try {
          console.log(`[ID Loader] Trying Apple Music API search fallback for ${id}...`);
          const res = await fetch(`https://api.spicyamll.online/search?term=${id}&types=songs&limit=1`);
          if (res.ok) {
            const data = await res.json();
            const mappedResults = data.results?.songs?.data?.map(mapSearchAmToItunes) || [];
            if (mappedResults && mappedResults.length > 0) {
              song = mappedResults.find(s => s.trackId == id) || mappedResults[0];
            }
          }
        } catch (err) {
          console.warn("[ID Loader] Apple Music API search fallback failed:", err);
        }
      }

      if (song) {
        // Normalize fields if they are under alternative names
        song.trackId = song.trackId || song.id;
        song.trackName = song.trackName || song.name || "Unknown Track";
        song.artistName = song.artistName || song.artist || "Unknown Artist";
        song.collectionName = song.collectionName || song.album || "";
        song.artworkUrl100 = song.artworkUrl100 || song.artUrl || "favicon.svg";
        
        loadRemoteTrack(song);
      } else {
        throw new Error("Track ID not found in catalog or lookup APIs");
      }
    } catch (err) {
      console.error("[ID Loader] Failed:", err);
      prepOverlay.classList.remove('active');
      alert(`Could not load track ${id}: ${err.message}`);
    }
  }

  // Initial load
  fetchTrending();

  // ── Helpers ──
  function showError(msg) {
    errorEl.textContent = msg;
    setTimeout(() => clearError(), 5000);
  }

  function clearError() {
    errorEl.textContent = '';
  }

  function readFileAsText(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => resolve(e.target.result);
      reader.onerror = (e) => reject(e.target.error);
      reader.readAsText(file);
    });
  }

  function readFileAsArrayBuffer(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => resolve(e.target.result);
      reader.onerror = (e) => reject(e.target.error);
      reader.readAsArrayBuffer(file);
    });
  }

  function isMP4Buffer(buffer) {
    const view = new DataView(buffer);
    if (view.byteLength < 8) return false;
    return (
      view.getUint8(4) === 0x66 && // f
      view.getUint8(5) === 0x74 && // t
      view.getUint8(6) === 0x79 && // y
      view.getUint8(7) === 0x70    // p
    );
  }

  // ══════════════════════════════════════════════════
  // NEW APPLE MUSIC VIEWS (ALBUM, ARTIST) & CONTEXT MENU
  // ══════════════════════════════════════════════════
  
  function showContextMenu(e, song) {
    e.preventDefault();
    contextMenuTrack = song;
    songContextMenu.style.left = `${e.clientX}px`;
    songContextMenu.style.top = `${e.clientY}px`;
    songContextMenu.classList.remove('hidden');

    const closeMenu = () => {
      songContextMenu.classList.add('hidden');
      document.removeEventListener('click', closeMenu);
    };
    setTimeout(() => document.addEventListener('click', closeMenu), 10);
  }

  // Bind Actions
  ctxPlay.onclick = () => { if (contextMenuTrack) loadRemoteTrack(contextMenuTrack); };
  ctxViewAlbum.onclick = () => {
    if (contextMenuTrack && contextMenuTrack.collectionId) {
      openAlbumView(contextMenuTrack.collectionId, contextMenuTrack.collectionName, contextMenuTrack.artistName, contextMenuTrack.artworkUrl100);
    }
  };
  ctxViewArtist.onclick = () => {
    if (contextMenuTrack && contextMenuTrack.artistName) {
      openArtistView(contextMenuTrack.artistId, contextMenuTrack.artistName);
    }
  };

  ctxAddPlaylist.onclick = async () => {
     if (!contextMenuTrack) return;
     let playlists = await getPlaylists();
     
     const renderModalOptions = () => {
        playlistOptionsList.innerHTML = playlists.map(p => `
          <div class="playlist-option" data-id="${p.id}">${escapeHTML(p.name)}</div>
        `).join('') || '<p style="text-align:center; padding:10px; opacity:0.5;">No playlists created yet.</p>';
        
        playlistOptionsList.querySelectorAll('.playlist-option').forEach(opt => {
          opt.onclick = async () => {
            const pId = parseInt(opt.dataset.id, 10);
            await addToPlaylistProcess(pId, contextMenuTrack);
            playlistModal.classList.add('hidden');
          };
        });
     };
     
     renderModalOptions();
     playlistModal.classList.remove('hidden');
     
     modalCreatePlaylistBtn.onclick = async () => {
        const name = prompt("Enter new playlist name:");
        if (name) {
           await createPlaylist(name);
           playlists = await getPlaylists();
           renderModalOptions(); // rerender list inside modal
        }
     };
  };

  ctxFavorite.onclick = async () => {
     if (!contextMenuTrack) return;
     let playlists = await getPlaylists();
     let favPlaylist = playlists.find(p => p.name === 'Favorites');
     if (!favPlaylist) {
       const id = await createPlaylist('Favorites');
       favPlaylist = { id, name: 'Favorites' };
     }
     await addToPlaylistProcess(favPlaylist.id, contextMenuTrack);
     alert('Added to Favorites!');
  };

  function copyToClipboard(text) {
    if (navigator.clipboard && window.isSecureContext) {
      return navigator.clipboard.writeText(text);
    }
    // Fallback for non-secure contexts (HTTP/localhost)
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.cssText = 'position:fixed;left:-9999px;top:-9999px';
    document.body.appendChild(ta);
    ta.select();
    try {
      document.execCommand('copy');
      document.body.removeChild(ta);
      return Promise.resolve();
    } catch (err) {
      document.body.removeChild(ta);
      return Promise.reject(err);
    }
  }

  ctxCopyId.onclick = () => {
    if (contextMenuTrack) {
      const id = contextMenuTrack.trackId || contextMenuTrack.id;
      if (id) {
        copyToClipboard(id.toString())
          .then(() => {
            alert(`Song ID ${id} copied to clipboard!`);
          })
          .catch(err => {
            console.error('Failed to copy: ', err);
          });
      }
    }
  };

  closePlaylistModal.onclick = () => playlistModal.classList.add('hidden');

  async function addToPlaylistProcess(pId, track) {
     prepOverlay.classList.add('active');
     prepStatus.textContent = "Saving to Playlist...";
     try {
       const audioUrl = `https://api.spicyamll.online/download?song=${track.trackId}`;
       const response = await robustFetch(audioUrl, { skipProxy: true });
       const audioBuffer = await response.arrayBuffer();
       
       await addTrackToPlaylist(pId, {
         name: track.trackName,
         artist: track.artistName,
         artUrl: track.artworkUrl100.replace('100x100', '600x600'),
         type: isMP4Buffer(audioBuffer) ? 'audio/mp4' : 'audio/mpeg',
         ttml: '__AUTO_FETCH__',
         amTrackId: track.trackId
       }, audioBuffer);
       prepOverlay.classList.remove('active');
     } catch (err) {
       console.error("Failed to add to playlist:", err);
       prepOverlay.classList.remove('active');
       alert("Failed to save track: " + err.message);
     }
  }

  // Playlist Page Functionality
  async function renderPlaylistsPage() {
     const playlists = await getPlaylists();
     playlistDetail.classList.add('hidden');
     playlistsGrid.classList.remove('hidden');

     playlistsGrid.innerHTML = playlists.map(p => `
       <div class="playlist-card animate-fade" data-id="${p.id}">
         <div class="playlist-icon">
           <svg viewBox="0 0 24 24" fill="currentColor"><path d="M4 10h12v2H4v-2zm0-4h12v2H4V6zm0 8h8v2H4v-2zm10 0v6l5-3-5-3z" /></svg>
         </div>
         <h4>${escapeHTML(p.name)}</h4>
         <button class="am-text-btn delete-playlist" style="margin-top:10px; font-size:0.8rem;" data-id="${p.id}">Delete</button>
       </div>
     `).join('');

     playlistsGrid.querySelectorAll('.playlist-card').forEach(card => {
       card.onclick = (e) => {
         if (e.target.classList.contains('delete-playlist')) {
           const id = parseInt(e.target.dataset.id, 10);
           deletePlaylist(id).then(() => renderPlaylistsPage());
           return;
         }
         const id = parseInt(card.dataset.id, 10);
         const p = playlists.find(x => x.id === id);
         showPlaylistDetail(p);
       };
     });
  }

  if (createPlaylistBtn) {
    createPlaylistBtn.onclick = () => {
      const name = prompt("Playlist name:");
      if (name) createPlaylist(name).then(() => renderPlaylistsPage());
    };
  }

  if (playlistBackBtn) {
    playlistBackBtn.onclick = () => renderPlaylistsPage();
  }

  async function showPlaylistDetail(playlist) {
     playlistsGrid.classList.add('hidden');
     playlistDetail.classList.remove('hidden');
     playlistDetailTitle.textContent = playlist.name;
     playlistTracksGrid.innerHTML = '<div class="am-loading-msg">Loading tracks...</div>';

     const tracks = await getPlaylistTracks(playlist.id);
     if (!tracks.length) {
       playlistTracksGrid.innerHTML = '<div class="am-error-msg">Playlist is empty.</div>';
     } else {
       playlistTracksGrid.innerHTML = tracks.map(t => {
         const safeName = escapeHTML(t.name);
         const safeArtist = escapeHTML(t.artist);
         return `
         <div class="trending-card animate-fade" data-id="${t.id}">
           <div class="trending-art">
             <img src="${t.artUrl || 'favicon.svg'}" loading="lazy" alt="${safeName}">
           </div>
           <div class="trending-info">
             <h4>${safeName}</h4>
             <p>${safeArtist}</p>
           </div>
         </div>
       `;
       }).join('');

        playlistTracksGrid.querySelectorAll('.trending-card').forEach(card => {
          card.onclick = async () => {
            const tid = parseInt(card.dataset.id, 10);
            const clickedIndex = tracks.findIndex(x => x.id === tid);
            const clickedTrack = tracks[clickedIndex];

            if (clickedTrack && clickedTrack.buffer) {
              if (prepOverlay) {
                prepOverlay.classList.add('active');
                prepStatus.textContent = "Loading Playlist...";
              }
              try {
                await clearQueue();
                for (const t of tracks) {
                  await addTrackToQueue(t.buffer, t);
                }
                setCurrentIndex(clickedIndex);
                window.location.href = 'player.html';
              } catch (err) {
                console.error("Failed to load playlist:", err);
                if (prepOverlay) prepOverlay.classList.remove('active');
                alert("Error loading playlist: " + err.message);
              }
            }
          };
        });
     }
  }

  // ── Open Album View ──
  async function openAlbumView(collectionId, collectionName, artistName, artUrl) {
    listenInitialContent.style.display = 'none';
    searchSearchResults.classList.add('hidden');
    artistViewContainer.classList.add('hidden');
    
    // Check local album artwork animation
    let artSrc = artUrl.replace('100x100', '600x600');
    albumHeader.innerHTML = `
      <img src="${artSrc}" id="album-view-art" class="am-album-cover">
      <div class="am-album-details">
        <h2 class="am-album-title">${escapeHTML(collectionName)}</h2>
        <div class="am-album-artist">${escapeHTML(artistName)}</div>
        <div class="am-album-meta">Album • 2024</div>
        <div class="am-album-desc">Enjoy this high fidelity master release on Spicy AMLL Player. Automatically synchronized with moving UI features.</div>
        <button class="am-start-btn" id="album-play-btn">Play</button>
      </div>
    `;

    albumViewContainer.classList.remove('hidden');
    albumTracksGrid.innerHTML = '<div class="am-loading-msg" style="padding-top:20px;">Fetching Tracks...</div>';
    
    // Attempt Animated Canvas Replacement
    getAnimatedArtwork(artistName, collectionName, "").then(videoUrl => {
         if (videoUrl) {
             const img = document.getElementById('album-view-art');
             if(img) {
                 const video = document.createElement('video');
                 video.src = videoUrl;
                 video.autoplay = true; video.loop = true; video.muted = true;
                 video.className = 'am-album-cover';
                 img.replaceWith(video);
             }
         }
    });

    try {
      // const data = await itunesFetch(`https://itunes.apple.com/lookup?id=${collectionId}&entity=song`);
      const res = await fetch(`https://api.spicyamll.online/itunes/lookup?id=${collectionId}&entity=song`);
      const data = await res.json();
      const tracks = data.results.filter(r => r.wrapperType === 'track');
      
      albumTracksGrid.innerHTML = tracks.map((t, idx) => `
        <div class="am-track-row animate-fade" data-id="${t.trackId}" style="animation-delay:${idx*30}ms">
           <div class="am-track-num">${t.trackNumber}</div>
           <div class="am-track-title">${escapeHTML(t.trackName)}</div>
           <div class="am-track-duration">${millisToMinutesAndSeconds(t.trackTimeMillis)}</div>
           <svg class="am-track-more" viewBox="0 0 24 24" width="20" height="20" fill="currentColor">
              <path d="M6 10c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm12 0c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm-6 0c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2z"/>
           </svg>
        </div>
      `).join('');

      albumTracksGrid.querySelectorAll('.am-track-row').forEach(row => {
          row.onclick = (e) => {
              const id = row.dataset.id;
              const song = tracks.find(s => s.trackId == id);
              if (song) showContextMenu(e, song);
          };
      });

      const playBtn = document.getElementById('album-play-btn');
      playBtn.onclick = () => {
         if (tracks.length > 0) loadRemoteTrack(tracks[0]);
      };

    } catch (err) {
      console.error(err);
      albumTracksGrid.innerHTML = `<div class="am-error-msg">Failed to load album tracks.</div>`;
    }
  }

  // ── Open Artist View ──
  async function openArtistView(artistId, artistName) {
     listenInitialContent.style.display = 'none';
     searchSearchResults.classList.add('hidden');
     albumViewContainer.classList.add('hidden');
     artistViewContainer.classList.remove('hidden');

     artistViewContent.innerHTML = `<div class="am-loading-msg" style="padding-top:40px;">Fetching Artist Profile...</div>`;

     let realArtistId = artistId;
     if (!realArtistId) {
        try {
           const searchRes = await fetch(`https://api.spicyamll.online/search?term=${encodeURIComponent(artistName)}&types=artists&limit=1`);
           if (searchRes.ok) {
              const searchData = await searchRes.json();
              const foundArtist = searchData?.results?.artists?.data?.[0];
              if (foundArtist) {
                 realArtistId = foundArtist.id;
              }
           }
        } catch (err) {
           console.warn("[Artist Lookup] Failed to find artist ID:", err);
        }
     }

      try {
        let songs = [];
        let albums = [];
        let latestAlbum = null;

        if (realArtistId) {
          // Fetch exact songs and albums using our new logic
          const songsRes = await fetch(`https://api.spicyamll.online/artist/songs?artist=${realArtistId}&limit=10`);
          if (songsRes.ok) {
            const songsData = await songsRes.json();
            songs = songsData.data?.map(mapSearchAmToItunes) || [];
          }

          const albumsRes = await fetch(`https://api.spicyamll.online/artist/albums?artist=${realArtistId}&limit=10`);
          if (albumsRes.ok) {
            const albumsData = await albumsRes.json();
            albums = albumsData.data?.map(mapSearchAmToItunes) || [];
            if (albums.length > 0) {
              // Find latest release based on releaseDate
              latestAlbum = [...albums].sort((a, b) => new Date(b.releaseDate) - new Date(a.releaseDate))[0];
            }
          }
        }

        // Fallback to fuzzy search if artistId could not be resolved or requests failed
        if (songs.length === 0) {
          console.log("[Artist View] Falling back to fuzzy iTunes search...");
          const res = await fetch(`https://api.spicyamll.online/itunes/search?term=${encodeURIComponent(artistName)}&entity=song&limit=4`);
          const data = await res.json();
          songs = data.results || [];

          const albRes = await fetch(`https://api.spicyamll.online/itunes/search?term=${encodeURIComponent(artistName)}&entity=album&limit=10`);
          const albData = await albRes.json();
          albums = albData.results || [];
          latestAlbum = albums[0];
        }

        const placeholderPhoto = songs[0] ? songs[0].artworkUrl100.replace('100x100', '600x600') : 'favicon.svg';
        
        let songsHTML = songs.slice(0, 4).map(s => {
          const safeName = escapeHTML(s.trackName);
          return `
          <div class="am-track-row" data-id="${s.trackId}">
            <img src="${s.artworkUrl100}" width="40" height="40" style="border-radius:6px; margin-right:15px;">
            <div class="am-track-title">${safeName} <span style="font-size:0.7rem;color:#777;background:rgba(255,255,255,0.1);padding:2px 4px;border-radius:4px;margin-left:6px;">E</span></div>
            <svg class="am-track-more" viewBox="0 0 24 24" width="20" height="20" fill="currentColor">
               <path d="M6 10c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm12 0c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm-6 0c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2z"/>
            </svg>
          </div>
        `;
        }).join('');

        let albumsHTML = albums.map(album => {
          const safeName = escapeHTML(album.collectionName);
          const safeArtist = escapeHTML(album.artistName);
          return `
            <div class="album-card animate-fade" data-id="${album.collectionId}" data-name="${safeName}" data-artist="${safeArtist}" data-art="${album.artworkUrl100}">
              <img src="${album.artworkUrl100.replace('100x100', '300x300')}" class="album-art" loading="lazy">
              <div class="album-info">
                <h4>${safeName}</h4>
                <p>${safeArtist}</p>
              </div>
            </div>
          `;
        }).join('') || '<p style="color:rgba(255,255,255,0.4)">No albums found.</p>';

        let allSongsHTML = songs.map(s => {
          const safeName = escapeHTML(s.trackName);
          return `
          <div class="am-track-row" data-id="${s.trackId}">
            <img src="${s.artworkUrl100}" width="40" height="40" style="border-radius:6px; margin-right:15px;">
            <div class="am-track-title">${safeName} <span style="font-size:0.7rem;color:#777;background:rgba(255,255,255,0.1);padding:2px 4px;border-radius:4px;margin-left:6px;">E</span></div>
            <svg class="am-track-more" viewBox="0 0 24 24" width="20" height="20" fill="currentColor">
               <path d="M6 10c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm12 0c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm-6 0c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2z"/>
            </svg>
          </div>
        `;
        }).join('') || '<p style="color:rgba(255,255,255,0.4)">No songs found.</p>';

        artistViewContent.innerHTML = `
           <div class="am-artist-header">
              <img src="${placeholderPhoto}" class="am-artist-image">
              <div class="am-artist-name-row">
                  <div class="am-artist-play-btn"><svg viewBox="0 0 24 24" fill="#fff" width="24" height="24"><path d="M8 5v14l11-7z"/></svg></div>
                  <h2 class="am-artist-name">${escapeHTML(artistName)}</h2>
              </div>
           </div>
           
           <div class="am-artist-content-grid">
              <div>
                 <h3 style="margin-bottom:15px; font-weight:700;">Latest Release</h3>
                 ${latestAlbum ? `
                 <div class="am-latest-release-card" data-id="${latestAlbum.collectionId}" data-name="${escapeHTML(latestAlbum.collectionName)}" data-artist="${escapeHTML(latestAlbum.artistName)}" data-art="${latestAlbum.artworkUrl100}">
                    <img src="${latestAlbum.artworkUrl100.replace('100x100', '300x300')}">
                    <div style="display:flex; flex-direction:column; justify-content:center;">
                       <div style="font-size:0.7rem; color:rgba(255,255,255,0.4); text-transform:uppercase; font-weight:700; margin-bottom:4px;">${latestAlbum.releaseDate ? new Date(latestAlbum.releaseDate).getFullYear() : 'Album'}</div>
                       <div style="font-weight:700; margin-bottom:4px; font-size:1rem;">${escapeHTML(latestAlbum.collectionName)}</div>
                       <div style="font-size:0.8rem; color:rgba(255,255,255,0.4);">${latestAlbum.trackCount ? latestAlbum.trackCount + ' songs' : ''}</div>
                    </div>
                 </div>` : '<p style="color:rgba(255,255,255,0.4)">No recent releases found.</p>'}
              </div>
              <div>
                 <h3 style="margin-bottom:15px; font-weight:700;">Top Songs</h3>
                 <div class="am-top-songs-list">${songsHTML}</div>
              </div>
           </div>

           <div class="artist-albums-section" style="margin-top: 40px;">
              <h3 style="margin-bottom: 20px; font-weight: 700; font-size: 1.5rem;">Albums</h3>
              <div class="albums-grid" style="display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: 20px;">
                  ${albumsHTML}
              </div>
           </div>

           <div class="artist-songs-section" style="margin-top: 40px; margin-bottom: 40px;">
              <h3 style="margin-bottom: 20px; font-weight: 700; font-size: 1.5rem;">All Songs</h3>
              <div class="am-top-songs-list" style="display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 15px;">
                  ${allSongsHTML}
              </div>
           </div>
        `;

        artistViewContent.querySelectorAll('.am-track-row').forEach(row => {
           row.onclick = (e) => {
              const id = row.dataset.id;
              const song = songs.find(s => s.trackId == id);
              if (song) showContextMenu(e, song);
           };
        });

        const latestReleaseCard = artistViewContent.querySelector('.am-latest-release-card');
        if (latestReleaseCard) {
          latestReleaseCard.onclick = () => {
            const id = latestReleaseCard.dataset.id;
            const name = latestReleaseCard.dataset.name;
            const artist = latestReleaseCard.dataset.artist;
            const art = latestReleaseCard.dataset.art;
            if (id) {
              openAlbumView(id, name, artist, art);
            }
          };
        }

        artistViewContent.querySelectorAll('.artist-albums-section .album-card').forEach(card => {
          card.onclick = () => {
            const id = card.dataset.id;
            const name = card.dataset.name;
            const artist = card.dataset.artist;
            const art = card.dataset.art;
            if (id) {
              openAlbumView(id, name, artist, art);
            }
          };
        });

      } catch (e) {
        console.error(e);
        artistViewContent.innerHTML = `<div class="am-error-msg">Failed to load artist profile.</div>`;
      }
   }

  async function renderFavoritesPage() {
     const favoriteGrid = document.getElementById('favorite-tracks-grid');
     if (!favoriteGrid) return;
     favoriteGrid.innerHTML = '<div class="am-loading-msg">Loading favorites...</div>';

     const playlists = await getPlaylists();
     const favPlaylist = playlists.find(p => p.name === 'Favorites');
     
     if (!favPlaylist) {
       favoriteGrid.innerHTML = '<div class="am-error-msg">No favorite songs yet. Start by clicking "Add to Favorites" on a song.</div>';
       return;
     }

     const tracks = await getPlaylistTracks(favPlaylist.id);
     if (!tracks.length) {
       favoriteGrid.innerHTML = '<div class="am-error-msg">No favorite songs yet.</div>';
     } else {
       renderTrackGrid(favoriteGrid, tracks);
     }
  }

  async function renderRecentPage() {
     const recentGrid = document.getElementById('recent-tracks-grid');
     if (!recentGrid) return;
     
     const recentTracks = JSON.parse(localStorage.getItem('spicy_recent_tracks') || '[]');
     if (!recentTracks.length) {
       recentGrid.innerHTML = '<div class="am-error-msg">No recently played tracks.</div>';
     } else {
       renderTrackGrid(recentGrid, recentTracks, true);
     }
  }

  function renderTrackGrid(container, tracks, isRemote = false) {
     container.innerHTML = tracks.map(t => {
       const safeName = escapeHTML(t.name || t.trackName);
       const safeArtist = escapeHTML(t.artist || t.artistName);
       return `
       <div class="trending-card animate-fade" data-id="${t.id || t.trackId}">
         <div class="trending-art">
           <img src="${t.artUrl || t.artworkUrl100 || 'favicon.svg'}" loading="lazy" alt="${safeName}">
         </div>
         <div class="trending-info">
           <h4>${safeName}</h4>
           <p>${safeArtist}</p>
         </div>
       </div>
     `;
     }).join('');

      container.querySelectorAll('.trending-card').forEach(card => {
        card.onclick = async () => {
          const tid = card.dataset.id;
          const clickedIndex = tracks.findIndex(x => (x.id || x.trackId) == tid);
          const clickedTrack = tracks[clickedIndex];

          if (clickedTrack && clickedTrack.buffer) {
            if (prepOverlay) {
              prepOverlay.classList.add('active');
              prepStatus.textContent = "Loading Tracks...";
            }
            try {
              await clearQueue();
              for (const track of tracks) {
                await addTrackToQueue(track.buffer, track);
              }
              setCurrentIndex(clickedIndex);
              window.location.href = 'player.html';
            } catch (err) {
              console.error("Failed to load tracks:", err);
              if (prepOverlay) prepOverlay.classList.remove('active');
              alert("Error loading tracks: " + err.message);
            }
          } else if (clickedTrack) {
            if (prepOverlay) {
              prepOverlay.classList.add('active');
              prepStatus.textContent = "Loading Recently Played...";
            }
            try {
              await clearQueue();
              for (const track of tracks) {
                const metadata = {
                  name: track.trackName || track.name,
                  artist: track.artistName || track.artist || 'Unknown Artist',
                  album: track.collectionName || track.album || '',
                  artUrl: (track.artworkUrl100 || track.artUrl || '').replace('100x100', '600x600'),
                  type: 'audio/mpeg',
                  ttml: '__AUTO_FETCH__',
                  amTrackId: track.trackId || track.id
                };
                await addTrackToQueue(null, metadata);
              }
              setCurrentIndex(clickedIndex);
              window.location.href = 'player.html';
            } catch (err) {
              console.error("Failed to load recently played tracks:", err);
              if (prepOverlay) prepOverlay.classList.remove('active');
              alert("Error loading recently played: " + err.message);
            }
          }
        };
      });
  }

  // Tracking recent tracks
  function addToRecent(track) {
    let recent = JSON.parse(localStorage.getItem('spicy_recent_tracks') || '[]');
    // Avoid duplicates
    recent = recent.filter(t => (t.trackId || t.id) !== (track.trackId || track.id));
    recent.unshift(track);
    if (recent.length > 20) recent.pop();
    localStorage.setItem('spicy_recent_tracks', JSON.stringify(recent));
  }

  function millisToMinutesAndSeconds(millis) {
     if(!millis) return "0:00";
     var minutes = Math.floor(millis / 60000);
     var seconds = ((millis % 60000) / 1000).toFixed(0);
     return minutes + ":" + (seconds < 10 ? '0' : '') + seconds;
  }

  // ── URL ID Detection (Quick Init) ──
  function extractSongId() {
    // 1. Check query parameters (e.g. ?id=1738734057 or ?song=1738734057)
    const queryParams = new URLSearchParams(window.location.search);
    const qId = queryParams.get('id') || queryParams.get('song');
    if (qId && /^\d+$/.test(qId.trim())) {
      return qId.trim();
    }

    // 2. Check hash (e.g. #1738734057 or #/song/1738734057 or #song/1738734057)
    const hash = window.location.hash;
    if (hash) {
      const hashMatch = hash.match(/\b\d{8,15}\b/);
      if (hashMatch) {
        return hashMatch[0];
      }
    }

    // 3. Check pathname (e.g. /1738734057 or /song/1738734057)
    const pathMatch = window.location.pathname.match(/\b\d{8,15}\b/);
    if (pathMatch) {
      return pathMatch[0];
    }

    return null;
  }

  const potentialId = extractSongId();

  if (potentialId) {
     console.log("[AutoInit] Detected potential song ID in URL:", potentialId);
     // Use a small delay to ensure all UI elements are ready
     setTimeout(() => loadTrackById(potentialId), 500);
  }

});
