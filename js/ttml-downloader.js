import { robustFetch } from './network-utils.js';

export const TTMLDownloader = {
  /**
   * Fetch song metadata (art, name, artist) for an Apple Music Track ID
   */
  async fetchMetadata(songId) {
    try {
      // Use the standard iTunes lookup API for exact ID matching
      const url = `https://itunes.apple.com/lookup?id=${songId}`;
      const res = await robustFetch(url);
      if (!res.ok) throw new Error(`iTunes lookup failed: ${res.status}`);

      const data = await res.json();
      if (data.results && data.results.length > 0) {
        const song = data.results[0];
        return {
          id: song.trackId,
          name: song.trackName,
          artist: song.artistName,
          album: song.collectionName,
          artUrl: song.artworkUrl100.replace('100x100', '1024x1024') || song.artworkUrl100
        };
      }
      throw new Error('Track ID not found in iTunes catalog.');
    } catch (err) {
      console.error('[TTMLDownloader] Metadata fetch failed:', err);
      throw err;
    }
  },

  /**
   * Fetch raw TTML content for an Apple Music Track ID
   */
  async fetchTTML(songId) {
    // 1. Try Community DB First ( synced by users)
    try {
      console.log(`[TTMLDownloader] 🔍 Checking Community Database for: ${songId}`);
      const communityUrl = `https://api.spicyamll.online/community/lyrics/${songId}`;
      const communityRes = await robustFetch(communityUrl);
      if (communityRes.ok) {
        const data = await communityRes.json();
        if (data && data.ttml) {
          console.log('[TTMLDownloader] ✅ Found lyrics in Community Database');
          return data.ttml;
        }
      }
    } catch (err) {
      console.warn('[TTMLDownloader] ⚠️ Community Database check failed, falling back...');
    }

    // 2. Fallback to Apple Music API
    try {
      const url = `https://api.spicyamll.online/lyrics?song=${songId}`;
      console.log(`[TTMLDownloader] 🔍 Checking Apple Music API: ${url}`);

      const res = await robustFetch(url, { skipProxy: true });
      if (!res.ok) throw new Error(`Server returned ${res.status}`);

      const data = await res.json();

      // Handle the various ways the AMLL server might return the TTML
      const ttmlLocalizations = data?.raw?.data?.[0]?.attributes?.ttmlLocalizations;
      const ttmlRaw = data?.raw?.data?.[0]?.attributes?.ttml;

      let ttml = null;
      if (ttmlLocalizations) {
        // Prefer 'default' or English, otherwise just pick the first one
        ttml = ttmlLocalizations.default || ttmlLocalizations['en-US'] || Object.values(ttmlLocalizations)[0];
      } else if (ttmlRaw) {
        ttml = ttmlRaw;
      }

      if (!ttml) {
        throw new Error('No TTML formatted lyrics found for this track in any source.');
      }

      console.log('[TTMLDownloader] ✅ Found lyrics in Apple Music API');
      return ttml;
    } catch (err) {
      console.error('[TTMLDownloader] ❌ TTML fetch failed:', err);
      throw err;
    }
  },

  /**
   * Trigger a browser download of the TTML content
   */
  download(filename, content) {
    const blob = new Blob([content], { type: 'application/xml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename.endsWith('.ttml') ? filename : `${filename}.ttml`;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }, 0);
  }
};
