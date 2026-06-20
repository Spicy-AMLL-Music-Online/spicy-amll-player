/**
 * Spicy AMLL Player — Genius Service
 * Handles fetching songwriter credits, legal names, and plain-text lyrics from the Genius API.
 */

const BASE_URL = 'https://api.genius.com';

/** CORS proxies for scraping Genius song pages */
const SCRAPE_PROXIES = [
  (url) => `https://corsproxy.io/?${encodeURIComponent(url)}`,
  (url) => `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(url)}`,
  (url) => `https://thingproxy.freeboard.io/fetch/${url}`,
  (url) => `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`,
  (url) => `https://api.allorigins.win/get?url=${encodeURIComponent(url)}`,
  (url) => `https://cors.eu.org/${url}`,
  (url) => `https://api.cors.lol/?url=${encodeURIComponent(url)}`,
];

export const GeniusService = {
  /**
   * Proxied fetch for Genius API.
   * Authentication is handled on the server side via Netlify Functions.
   */
  async fetchApi(endpoint, options = {}) {
    try {
      const urlObj = new URL(endpoint, 'https://api.genius.com');
      const params = new URLSearchParams(urlObj.search);
      params.set('provider', 'genius');
      params.set('endpoint', urlObj.pathname);

      const url = `/api/proxy?${params.toString()}`;
      const response = await fetch(url, options);
      if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
      return response.json();
    } catch (e) {
      console.error(`[GeniusService] Request failed for ${endpoint}:`, e.message);
      throw e;
    }
  },

  /**
   * Search for a song and return its result object (includes url, id, title, etc.)
   */
  async searchSong(title, artist) {
    const query = `${artist} ${title}`.trim();
    if (!query) return null;

    try {
      const data = await this.fetchApi(`/search?q=${encodeURIComponent(query)}`);
      const hits = data.response.hits;
      if (hits && hits.length > 0) {
        return hits[0].result;
      }
    } catch (e) {
      console.error('[GeniusService] Search failed:', e);
    }
    return null;
  },

  /**
   * Fetch song details, including writer_artists
   */
  async getSongDetails(songId) {
    try {
      const data = await this.fetchApi(`/songs/${songId}`);
      return data.response.song;
    } catch (e) {
      console.error('[GeniusService] Detail fetch failed:', e);
    }
    return null;
  },

  /**
   * Scrape plain-text lyrics from a Genius song page.
   * Genius does NOT expose lyrics via their API — they must be scraped from the HTML page.
   * Uses CORS proxies to bypass browser security policies.
   * 
   * Ported from ttml-tool-dev/src/modules/genius/api/client.ts → getLyrics()
   * 
   * @param {string} songUrl - Full Genius URL (e.g. "https://genius.com/Artist-song-lyrics")
   * @returns {Promise<string|null>} Plain-text lyrics or null
   */
  async getLyrics(songUrl) {
    try {
      const cacheBuster = `?cb=${Math.random().toString(36).substring(7)}`;
      const targetUrl = songUrl.includes('?') ? `${songUrl}&${cacheBuster.slice(1)}` : `${songUrl}${cacheBuster}`;

      let html = null;
      let lastError = null;

      // Try each CORS proxy until one returns valid (non-Cloudflare) content
      for (let i = 0; i < SCRAPE_PROXIES.length; i++) {
        try {
          const proxyUrl = SCRAPE_PROXIES[i](targetUrl);
          console.log(`[GeniusService] Trying proxy ${i + 1}/${SCRAPE_PROXIES.length}...`);
          const resp = await fetch(proxyUrl);
          
          if (!resp.ok) {
            lastError = new Error(`Proxy ${i + 1} returned ${resp.status}`);
            if (i < SCRAPE_PROXIES.length - 1) {
              await new Promise(resolve => setTimeout(resolve, i * 200 + 100));
            }
            continue;
          }

          let rawText = await resp.text();

          // Handle JSON-wrapped proxy responses (e.g. allorigins /get endpoint)
          try {
            const possibleJson = JSON.parse(rawText);
            if (possibleJson.contents) {
              rawText = possibleJson.contents;
            }
          } catch (e) {
            // Not JSON, use raw text
          }

          // Check for anti-bot pages — if blocked, try the next proxy
          if (rawText.includes('cf-browser-verification') || rawText.includes('captcha') || rawText.includes('Checking your browser')) {
            console.warn(`[GeniusService] Proxy ${i + 1} blocked by Cloudflare/Captcha, trying next...`);
            lastError = new Error(`Proxy ${i + 1} blocked by Cloudflare`);
            if (i < SCRAPE_PROXIES.length - 1) {
              await new Promise(resolve => setTimeout(resolve, i * 300 + 200));
            }
            continue;
          }

          // Check for extremely short responses (probably error pages)
          if (rawText.length < 500) {
            console.warn(`[GeniusService] Proxy ${i + 1} returned suspiciously short response (${rawText.length} chars)`);
            lastError = new Error(`Proxy ${i + 1} returned short response`);
            continue;
          }

          html = rawText;
          console.log(`[GeniusService] ✓ Proxy ${i + 1} returned valid HTML (${html.length} chars)`);
          break;
        } catch (e) {
          lastError = e;
          console.warn(`[GeniusService] Proxy ${i + 1} fetch error:`, e.message);
        }
      }

      if (!html) {
        console.error(`[GeniusService] All ${SCRAPE_PROXIES.length} proxies failed. Last error:`, lastError?.message);
        return null;
      }

      const parser = new DOMParser();
      const doc = parser.parseFromString(html, 'text/html');

      // ── Method 1: Extract from window.__PRELOADED_STATE__ (most robust) ──
      try {
        const stateRegexes = [
          /window\.__PRELOADED_STATE__\s*=\s*JSON\.parse\('(.*?)'\)/,
          /window\.__PRELOADED_STATE__\s*=\s*({.*?});/,
          /window\.__PRELOADED_STATE__\s*=\s*(.*?)<\/script>/s
        ];

        let stateString = null;
        for (const reg of stateRegexes) {
          const match = html.match(reg);
          if (match) {
            stateString = match[1];
            break;
          }
        }

        if (stateString) {
          // Handle escaped characters
          if (stateString.includes("\\'")) {
            stateString = stateString.replace(/\\'/g, "'").replace(/\\\\/g, "\\");
          }
          if (stateString.startsWith("'") && stateString.endsWith("'")) {
            stateString = stateString.slice(1, -1);
          }

          const state = JSON.parse(stateString);
          const lyricsHtml = state.songPage?.lyricsData?.body?.html ||
                             state.song?.lyricsData?.body?.html ||
                             state.lyricsData?.body?.html;

          if (lyricsHtml) {
            const lyricsDoc = parser.parseFromString(lyricsHtml, 'text/html');
            const text = lyricsDoc.body.textContent?.trim();
            if (text) {
              console.log('[GeniusService] Extracted lyrics via __PRELOADED_STATE__');
              return this._cleanLyricsText(text);
            }
          }
        }
      } catch (e) {
        console.warn('[GeniusService] JSON state parse failed, falling back to DOM:', e.message);
      }

      // ── Method 2: DOM selectors ──
      let lyricsContainers = Array.from(doc.querySelectorAll('[data-lyrics-container="true"]'));

      if (lyricsContainers.length === 0) {
        lyricsContainers = Array.from(doc.querySelectorAll('[class^="Lyrics__Container"]'));
      }

      let fullLyrics = '';

      if (lyricsContainers.length === 0) {
        // Old Genius layout fallback
        const oldContainer = doc.querySelector('.lyrics');
        if (oldContainer) {
          fullLyrics = oldContainer.textContent?.trim() || '';
        }
      }

      if (lyricsContainers.length === 0 && !fullLyrics) {
        // Generic fallback
        const anyLyrics = doc.querySelector('[id*="lyrics"], [class*="lyrics"]');
        if (anyLyrics && anyLyrics.textContent && anyLyrics.textContent.length > 250) {
          fullLyrics = anyLyrics.textContent.trim();
        }
      }

      if (lyricsContainers.length > 0) {
        for (const container of lyricsContainers) {
          const brs = container.querySelectorAll('br');
          for (const br of Array.from(brs)) {
            br.replaceWith('\n');
          }
          fullLyrics += `${container.textContent}\n`;
        }
      }

      if (!fullLyrics) {
        console.warn('[GeniusService] Could not extract lyrics from page');
        return null;
      }

      console.log('[GeniusService] Extracted lyrics via DOM scraping');
      return this._cleanLyricsText(fullLyrics);

    } catch (e) {
      console.error('[GeniusService] getLyrics failed:', e);
      return null;
    }
  },

  /**
   * Clean up scraped lyrics text — remove contributor headers, section tags, etc.
   */
  _cleanLyricsText(text) {
    let cleaned = text.trim();
    // Remove "123 Contributors ... Lyrics" header
    cleaned = cleaned.replace(/^[0-9]+\sContributors.*Lyrics/i, '');
    // Remove section tags like [Verse 1], [Chorus], etc.
    cleaned = cleaned.replace(/\[.*?\]/g, '');
    return cleaned
      .split('\n')
      .map(line => line.trim())
      .filter(line => line.length > 0)
      .join('\n');
  },

  /**
   * Full flow: Search for a song on Genius and fetch its plain-text lyrics.
   * @param {string} title - Song title
   * @param {string} artist - Artist name
   * @returns {Promise<{lyrics: string, url: string}|null>}
   */
  async fetchLyrics(title, artist) {
    try {
      const result = await this.searchSong(title, artist);
      if (!result || !result.url) {
        console.log('[GeniusService] No song found for lyrics');
        return null;
      }

      console.log(`[GeniusService] Found song: "${result.full_title}" → ${result.url}`);
      
      // Strategy 1: Scrape the full song page
      let lyrics = await this.getLyrics(result.url);
      
      // Strategy 2: Try the embed endpoint (bypasses Cloudflare)
      if (!lyrics && result.id) {
        console.log('[GeniusService] Page scrape failed, trying embed endpoint...');
        lyrics = await this.getLyricsFromEmbed(result.id);
      }

      if (!lyrics) return null;
      return { lyrics, url: result.url };
    } catch (e) {
      console.error('[GeniusService] fetchLyrics failed:', e);
      return null;
    }
  },

  /**
   * Fallback: Extract lyrics from Genius embed.js endpoint.
   * This endpoint is designed for cross-origin embedding and often bypasses Cloudflare.
   * The embed contains an HTML snippet with the lyrics inside.
   * @param {number} songId - Genius song ID
   * @returns {Promise<string|null>}
   */
  async getLyricsFromEmbed(songId) {
    try {
      // The embed endpoint returns JS that sets innerHTML with lyrics
      const embedUrl = `https://genius.com/songs/${songId}/embed.js`;
      
      // Try direct fetch first (embed.js might allow CORS)
      let text = null;
      try {
        const resp = await fetch(embedUrl);
        if (resp.ok) text = await resp.text();
      } catch (e) {
        // Direct fetch failed, try through proxies
      }

      if (!text) {
        for (let i = 0; i < SCRAPE_PROXIES.length; i++) {
          try {
            const proxyUrl = SCRAPE_PROXIES[i](embedUrl);
            console.log(`[GeniusService] Embed proxy ${i + 1}/${SCRAPE_PROXIES.length}...`);
            const resp = await fetch(proxyUrl);
            if (!resp.ok) continue;
            
            let rawText = await resp.text();
            try {
              const j = JSON.parse(rawText);
              if (j.contents) rawText = j.contents;
            } catch (e) {}

            if (rawText.includes('cf-browser-verification') || rawText.includes('captcha')) continue;
            if (rawText.length < 200) continue;
            
            text = rawText;
            break;
          } catch (e) { continue; }
        }
      }

      if (!text) return null;

      // The embed.js contains HTML like: document.write(JSON.parse('..."<div>...lyrics...</div>"...'))
      // Extract the HTML content from the JS
      const htmlMatch = text.match(/document\.write\(JSON\.parse\('(.+?)'\)\)/s) ||
                        text.match(/<div[^>]*class="[^"]*rg_embed_body[^"]*"[^>]*>([\s\S]*?)<\/div>/);
      
      if (!htmlMatch) {
        // Try to find any lyrics-like content in the response
        const lyricsMatch = text.match(/<p[^>]*>([\s\S]*?)<\/p>/g);
        if (lyricsMatch) {
          const parser = new DOMParser();
          const combined = lyricsMatch.join('\n');
          const doc = parser.parseFromString(`<div>${combined}</div>`, 'text/html');
          const result = doc.body.textContent?.trim();
          if (result && result.length > 50) {
            console.log('[GeniusService] ✓ Extracted lyrics from embed (p tags)');
            return this._cleanLyricsText(result);
          }
        }
        return null;
      }

      let htmlContent = htmlMatch[1];
      // If it came from JSON.parse, unescape it
      if (htmlMatch[0].includes('JSON.parse')) {
        try {
          htmlContent = JSON.parse(`"${htmlContent}"`);
        } catch (e) {
          htmlContent = htmlContent.replace(/\\n/g, '\n').replace(/\\"/g, '"').replace(/\\\\/g, '\\');
        }
      }

      const parser = new DOMParser();
      const doc = parser.parseFromString(htmlContent, 'text/html');
      
      // Extract text from lyrics containers in the embed
      const containers = doc.querySelectorAll('[class*="Lyrics"], [class*="lyrics"], p');
      let lyrics = '';
      for (const el of containers) {
        const brs = el.querySelectorAll('br');
        for (const br of brs) br.replaceWith('\n');
        lyrics += el.textContent + '\n';
      }

      if (!lyrics.trim() || lyrics.trim().length < 50) return null;

      console.log('[GeniusService] ✓ Extracted lyrics from embed endpoint');
      return this._cleanLyricsText(lyrics);
    } catch (e) {
      console.warn('[GeniusService] Embed lyrics extraction failed:', e);
      return null;
    }
  },

  /**
   * Try to extract "Real Names" for artists
   */
  async fetchArtistRealName(artistId, stageName) {
    try {
      const data = await this.fetchApi(`/artists/${artistId}?text_format=plain`);
      const artist = data.response.artist;
      const description = artist.description.plain || "";
      const altNames = artist.alternate_names || [];

      const bornMatch = description.match(/born\s+([A-Z][a-zA-Z.]+(?:\s[A-Z][a-zA-Z.]+){1,4})/);
      const realNameMatch = description.match(/real\s+name\s+(?:is\s+)?([A-Z][a-zA-Z.]+(?:\s[A-Z][a-zA-Z.]+){1,4})/i);

      if (bornMatch) return bornMatch[1];
      if (realNameMatch) return realNameMatch[1];

      const forbiddenPrefixes = ["King ", "The ", "Mr. ", "aka ", "alias ", "DJ "];
      const potentialNames = altNames.filter(name => {
        const isNotStageName = !name.toLowerCase().includes(stageName.toLowerCase()) &&
          !stageName.toLowerCase().includes(name.toLowerCase());
        const hasGoodWordCount = name.split(" ").length >= 2 && name.split(" ").length <= 4;
        const noForbiddenPrefix = !forbiddenPrefixes.some(p => name.startsWith(p));
        const isCapitalized = name.split(" ").every(word => /^[A-Z]/.test(word));
        return isNotStageName && hasGoodWordCount && noForbiddenPrefix && isCapitalized;
      });

      if (potentialNames.length > 0) {
        return potentialNames.sort((a, b) => a.length - b.length)[0];
      }
    } catch (e) {
      console.warn(`[GeniusService] Failed to fetch real name for ${stageName}:`, e);
    }
    return stageName;
  },

  /**
   * Main entry point to get songwriters for a track
   */
  async fetchCredits(metadata, existingWriters = []) {
    try {
      const result = await this.searchSong(metadata.title, metadata.artist);
      if (!result) return existingWriters;

      const song = await this.getSongDetails(result.id);
      if (!song) return existingWriters;

      const geniusWriters = song.writer_artists || [];
      if (geniusWriters.length > existingWriters.length) {
        const names = [];
        for (const artist of geniusWriters) {
          const realName = await this.fetchArtistRealName(artist.id, artist.name);
          names.push(realName);
        }
        return names;
      }
    } catch (e) {
      console.error('[GeniusService] fetchCredits failed:', e);
    }
    return existingWriters;
  }
};
