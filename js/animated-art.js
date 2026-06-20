/**
 * Spicy AMLL Player WEB — Animated Artwork
 * Fetches animated (video) album art from Apple Music via iTunes search + Dodson proxy.
 * Based on the animated-art-test implementation.
 */
import { robustFetch } from './network-utils.js';

async function searchiTunes(query) {
  try {
    const encoded = encodeURIComponent(query);
    // Use Spicy AMLL Server as a proxy for iTunes search to avoid CORS issues on Netlify
    const res = await fetch(`https://api.spicyamll.online/search?term=${encoded}&types=albums&limit=5`);
    if (!res.ok) return null;

    const data = await res.json();
    const albums = data.results?.albums?.data;
    if (!albums || albums.length === 0) return null;

    // Return the album ID instead of catalog URL
    return albums[0].id || null;
  } catch (err) {
    console.warn('[AnimatedArt] iTunes search failed:', err);
    return null;
  }
}

/**
 * Try to fetch animated cover art for a song.
 * Searches with artist + album, falling back to artist + title if album search fails.
 * @param {string} artist - Artist name
 * @param {string} album - Album name
 * @param {string} [title] - Song title (used as fallback search)
 * @returns {Promise<string|null>} Video URL for animated artwork, or null
 */
export async function getAnimatedArtwork(artist, album, title) {
  if (!artist) return null;

  const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
  const quality = isMobile ? 'low' : 'high';

  // Strategy 1: Search with "artist album"
  if (album) {
    console.log(`[AnimatedArt] Searching: "${artist} ${album}"`);
    const albumId = await searchiTunes(`${artist} ${album}`);
    if (albumId) {
      console.log(`[AnimatedArt] Found Album ID via album search: ${albumId}`);
      return `https://api.spicyamll.online/animatedart?album=${albumId}&quality=${quality}`;
    }
  }

  // Strategy 2: Fallback to "artist title" if album search failed or no album
  if (title && title !== album) {
    console.log(`[AnimatedArt] Album search failed, trying: "${artist} ${title}"`);
    const albumId = await searchiTunes(`${artist} ${title}`);
    if (albumId) {
      console.log(`[AnimatedArt] Found Album ID via title search: ${albumId}`);
      return `https://api.spicyamll.online/animatedart?album=${albumId}&quality=${quality}`;
    }
  }

  // Strategy 3: Try just artist name as last resort
  console.log(`[AnimatedArt] Trying artist-only search: "${artist}"`);
  const albumId = await searchiTunes(artist);
  if (albumId) {
    console.log(`[AnimatedArt] Found Album ID via artist-only: ${albumId}`);
    return `https://api.spicyamll.online/animatedart?album=${albumId}&quality=${quality}`;
  }

  console.log('[AnimatedArt] No animated artwork found after all strategies');
  return null;
}

/**
 * Apply animated artwork to the album art container.
 * @param {HTMLElement} mediaBoxEl - The .MediaImageContainer element
 * @param {string} videoUrl - The animated artwork video URL
 */
// Track the active fetch controller so we can abort stale requests on track change
let _activeAnimatedArtController = null;

export function applyAnimatedArt(mediaBoxEl, videoUrl) {
  if (!mediaBoxEl || !videoUrl) return;

  // Abort any in-flight fetch from a previous track to prevent memory pile-up
  if (_activeAnimatedArtController) {
    _activeAnimatedArtController.abort();
    _activeAnimatedArtController = null;
  }

  // Remove any existing video
  const existingVideo = mediaBoxEl.querySelector('.animated-art-video');
  if (existingVideo) {
    if (existingVideo.src.startsWith('blob:')) {
      try { URL.revokeObjectURL(existingVideo.src); } catch (e) {}
    }
    existingVideo.remove();
  }

  const video = document.createElement('video');
  video.classList.add('animated-art-video');
  
  // Set safety attributes to bypass mobile autoplay blocks
  video.autoplay = true;
  video.loop = true;
  video.muted = true;
  video.playsInline = true;
  video.setAttribute('playsinline', '');
  video.setAttribute('disablepictureinpicture', '');

  const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);

  let localVideoUrl = null;

  if (isMobile) {
    // On mobile, skip the full-blob download to avoid OOM tab crashes.
    // Use a <source type="video/mp4"> child element to give iOS Safari's AVPlayer an
    // explicit MIME type hint even when the server returns no Content-Type header and
    // the URL has no file extension.
    //
    // CRITICAL ORDER: attach <source> to <video> BEFORE appending <video> to the DOM.
    // iOS Safari only initiates a network load when a video element with a source
    // already set *enters* the DOM — mirroring how static HTML <video><source></video>
    // works. Calling load() on a video that is already in the DOM with no src is
    // silently suppressed by iOS's autoplay/load policy (no network request is sent).
    console.log(`[AnimatedArt] Mobile: using <source type=video/mp4> for: ${videoUrl}`);
    const source = document.createElement('source');
    source.src = videoUrl;
    source.type = 'video/mp4';

    // Blob fallback: if iOS still rejects the source (fires error with video.error=null /
    // NETWORK_NO_SOURCE), re-fetch as a typed Blob so AVPlayer gets an unambiguous MIME
    // type. On mobile we request quality=low so the file is small — OOM risk is minimal.
    source.addEventListener('error', async () => {
      console.warn('[AnimatedArt] <source> rejected by iOS — falling back to blob');
      if (!video.parentNode) return; // video was already removed, bail
      video.removeChild(source);
      try {
        const resp = await fetch(videoUrl);
        if (!resp.ok) {
          if (resp.status === 404) {
            console.log('[AnimatedArt] No animated art available (404)');
            video.remove();
            return;
          }
          throw new Error(`HTTP ${resp.status}`);
        }
        const blob = new Blob([await resp.arrayBuffer()], { type: 'video/mp4' });
        localVideoUrl = URL.createObjectURL(blob);
        video.src = localVideoUrl;
        video.load();
        video.play().catch(() => {});
        console.log('[AnimatedArt] Blob fallback applied on mobile');
      } catch (e) {
        console.warn('[AnimatedArt] Blob fallback failed:', e.message || e);
        video.remove();
      }
    });

    video.appendChild(source);

    // NOW append to DOM (video already has source set — iOS will load immediately)
    mediaBoxEl.appendChild(video);
    // Don't call video.play() here — it races with the load and causes AbortError on iOS.
    // The autoplay + muted + playsinline attributes let the browser start playing
    // automatically once enough data has buffered.
  } else {
    // 2. On desktop: append to DOM first, then fetch the video as a Blob and force
    //    the video/mp4 MIME type. Desktop has ample RAM so buffering is fine.
    mediaBoxEl.appendChild(video);

    const controller = new AbortController();
    _activeAnimatedArtController = controller;

    (async () => {
      try {
        console.log(`[AnimatedArt] Fetching video bytes for: ${videoUrl}`);
        const response = await fetch(videoUrl, { signal: controller.signal });
        if (!response.ok) {
          if (response.status === 404) {
            console.log('[AnimatedArt] No animated art available (404)');
            video.remove();
            return;
          }
          throw new Error(`HTTP error ${response.status}`);
        }
        
        const rawBlob = await response.blob();
        // Force correct MIME type so desktop browsers accept it without ambiguity
        const videoBlob = new Blob([rawBlob], { type: 'video/mp4' });
        localVideoUrl = URL.createObjectURL(videoBlob);
        
        video.src = localVideoUrl;
        console.log('[AnimatedArt] Blob URL assigned successfully');
      } catch (err) {
        if (err.name === 'AbortError') {
          console.log('[AnimatedArt] Fetch aborted (track changed)');
          video.remove();
          return;
        }
        console.warn('[AnimatedArt] Blob fetch failed:', err.message || err);
        video.remove();
        return;
      }

      // 3. Call play() ONLY after the src is assigned to trigger play state
      video.play().catch(err => {
        console.warn('[AnimatedArt] Immediate video.play() failed:', err);
      });
    })();
  }

  // Hide the static background image and fade in video when first frame is decoded
  video.addEventListener('loadeddata', () => {
    mediaBoxEl.style.backgroundImage = 'none';
    video.classList.add('loaded');
  });

  video.addEventListener('error', () => {
    console.warn('[AnimatedArt] Video failed to load. MediaError:', video.error ? {
      code: video.error.code,
      message: video.error.message
    } : 'Unknown Error');
    
    if (localVideoUrl) {
      try { URL.revokeObjectURL(localVideoUrl); } catch (e) {}
    }
    video.remove();
  });
}
