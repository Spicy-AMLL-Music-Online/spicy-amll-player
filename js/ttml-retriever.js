import parseTTMLToLyrics from './ttml-parser.js';
import { settingsManager } from './settings-manager.js';
import { robustFetch } from './network-utils.js';
import { GetExpireStore } from './stores.js';

export const LyricsStore = GetExpireStore("SL:lyrics", 1, { Duration: 3, Unit: "Days" });

const SPICY_API_URL = 'https://api.spicylyrics.org';
const SPICY_VERSION = '2.8.0';
const CUSTOM_LYRICS_API = 'https://api.spicyamll.online/community';

/** Source label mapping */
const SOURCE_LABELS = {
  spl: 'Spicy Lyrics Community',
  lyricsplus: 'LyricsPlus',
  aml: 'Apple Music',
  spt: 'Spotify',
  spicy: 'Spicy AMLL Player',
  spotify: 'Spotify',
  lrclib: 'LRCLIB',
  netease: 'Netease',
  musixmatch: 'Musixmatch',
  genius: 'Genius',
  apple: 'Apple Music',
  custom: "Our Community's Lyrics",
};

function resolveSourceLabel(source, sourceDisplayName) {
  if (sourceDisplayName?.trim()) return sourceDisplayName.trim();
  if (source && SOURCE_LABELS[source]) return SOURCE_LABELS[source];
  if (source?.trim()) return source.trim();
  return 'Spicy AMLL Player';
}

// ═══════════════════════════════════════════════
// Helpers & Utilities
// ═══════════════════════════════════════════════

function normalizeText(text) {
  return (text || '')
    .toLowerCase()
    .replace(/[^\w\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Fetch from custom TTML API */
async function fetchFromCustomAPI(songId) {
  try {
    const res = await fetch(`${CUSTOM_LYRICS_API}/lyrics/${songId}`);
    if (!res.ok) return null;

    const data = await res.json();
    if (!data || !data.ttml) return null;

    let lyricsData = parseTTMLToLyrics(data.ttml);
    if (lyricsData?.Type) {
      return {
        lyricsData,
        source: 'custom',
        sourceDisplayName: data.sourceDisplayName || `Synced by ${data.makerHandle || 'Community'}`,
        makerHandle: data.makerHandle,
        makerId: data.makerId,
        makerDisplayName: data.makerDisplayName,
        makerNickname: data.makerNickname,
        makerAvatar: data.makerAvatar
      };
    }
  } catch (e) {
    console.warn('[TTMLRetriever] Custom API fetch error:', e);
  }
  return null;
}

/** Proxy fetch to bypass CORS for specific providers */
async function proxiedFetch(url, options = {}) {
  try {
    return await robustFetch(url, options);
  } catch (e) {
    console.warn(`[TTMLRetriever] robustFetch failed for ${url}:`, e.message);
    throw e;
  }
}

// ═══════════════════════════════════════════════
// Spotify Search
// ═══════════════════════════════════════════════

let cachedSpotifyToken = null;

async function getSpotifyAccessToken() {
  if (cachedSpotifyToken) return cachedSpotifyToken;
  try {
    const targetUrl = 'https://open.spotify.com/get_access_token?reason=transport&productType=web_player';
    const res = await proxiedFetch(targetUrl, { credentials: 'omit' });
    if (res.ok) {
      const data = await res.json();
      if (data.accessToken) {
        cachedSpotifyToken = data.accessToken;
        return data.accessToken;
      }
    }
  } catch (e) {
    console.log('[TTMLRetriever] Spotify token error:', e.message);
  }
  return null;
}

async function searchSpotifyTrack(songName, artistName, albumName) {
  try {
    const token = await getSpotifyAccessToken();
    const query = encodeURIComponent(`track:${songName} artist:${artistName}`);
    const url = `https://api.spotify.com/v1/search?q=${query}&type=track&limit=5`;

    if (token) {
      const res = await fetch(url, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.ok) {
        const data = await res.json();
        const tracks = data?.tracks?.items;
        if (tracks && tracks.length > 0) {
          return tracks[0].id;
        }
      }
    }
    return null;
  } catch (err) {
    return null;
  }
}

// Musixmatch Provider
// ═══════════════════════════════════════════════

async function fetchFromMusixmatch(songName, artistName, albumName, durationMs) {
  const durationSec = durationMs / 1000;

  try {
    const params = new URLSearchParams({
      provider: 'musixmatch',
      format: "json",
      namespace: "lyrics_richsynched",
      subtitle_format: "mxm",
      app_id: "web-desktop-app-v1.0",
      q_track: songName,
      q_artist: artistName,
      q_album: albumName || "",
      q_duration: durationSec
    });

    const res = await fetch(`/api/proxy?${params}`);
    if (!res.ok) return null;

    const data = await res.json();
    const macroCalls = data?.message?.body?.macro_calls;
    if (!macroCalls) return null;

    // Check for richsync (word sync)
    const ignoreWordSync = settingsManager.get("ignoreMusixmatchWordSync");
    const richsync = macroCalls["track.richsync.get"]?.message?.body?.richsync?.richsync_body;
    if (richsync && !ignoreWordSync) {
      // Note: Full RichSync parsing would be integrated here if ported from reference
    }

    // Fallback to subtitle (line sync)
    const subtitle = macroCalls["track.subtitles.get"]?.message?.body?.subtitle_list?.[0]?.subtitle?.subtitle_body;
    if (subtitle) {
      const lines = JSON.parse(subtitle);
      const content = lines.map((l, i) => ({
        Type: "Vocal",
        Text: l.text,
        StartTime: l.time.total,
        EndTime: (i < lines.length - 1) ? lines[i + 1].time.total : l.time.total + 4
      }));
      return {
        lyricsData: { Type: "Line", StartTime: content[0].StartTime, Content: content },
        source: "musixmatch",
        sourceDisplayName: "Musixmatch"
      };
    }
    return null;
  } catch (e) {
    return null;
  }
}

// ═══════════════════════════════════════════════
// Netease Provider
// ═══════════════════════════════════════════════

async function fetchFromNetease(songName, artistName) {
  try {
    const searchUrl = `https://music.163.com/api/search/get?s=${encodeURIComponent(songName + " " + artistName)}&type=1&limit=1`;
    const searchRes = await proxiedFetch(searchUrl);
    if (!searchRes.ok) return null;

    const searchData = await searchRes.json();
    const songId = searchData?.result?.songs?.[0]?.id;
    if (!songId) return null;

    const lyricsUrl = `https://music.163.com/api/song/lyric?id=${songId}&lv=1&kv=1&tv=-1`;
    const lyricsRes = await proxiedFetch(lyricsUrl);
    if (!lyricsRes.ok) return null;

    const data = await lyricsRes.json();
    const lrc = data?.lrc?.lyric;
    if (!lrc) return null;

    // Use our existing parseLRC logic
    const lines = parseLRC(lrc, 240000); // 4 min duration fallback
    if (lines) {
      return {
        lyricsData: lines,
        source: "netease",
        sourceDisplayName: "NetEase"
      };
    }
    return null;
  } catch (e) {
    return null;
  }
}

// ═══════════════════════════════════════════════
// LRCLIB
// ═══════════════════════════════════════════════

async function fetchFromLRCLIB(songName, artistName, albumName, durationSec) {
  const tryFetch = async (album) => {
    try {
      const params = new URLSearchParams({
        track_name: songName,
        artist_name: artistName,
        duration: String(Math.round(durationSec)),
      });
      if (album) params.append('album_name', album);

      const res = await fetch(`https://lrclib.net/api/get?${params}`, {
        headers: { 'x-user-agent': 'spicy-amll-player/1.0' },
      });

      if (!res.ok) return null;
      const body = await res.json();
      return processLRCLIBResponse(body, durationSec * 1000);
    } catch (err) {
      return null;
    }
  };

  let result = await tryFetch(albumName);
  if (!result && albumName) {
    console.log(`[TTMLRetriever] LRCLIB: Not found with album "${albumName}", retrying without album...`);
    result = await tryFetch(null);
  }
  
  return result;
}

function processLRCLIBResponse(body, durationMs) {
  if (body?.syncedLyrics) {
    const lines = parseLRC(body.syncedLyrics, durationMs);
    if (lines) return { lyricsData: lines, source: 'lrclib', sourceDisplayName: 'LRCLIB' };
  }
  if (body?.plainLyrics) {
    const staticLines = body.plainLyrics.split(/\r?\n/).map(l => l.trim()).filter(Boolean).map(Text => ({ Text }));
    if (staticLines.length > 0) return { lyricsData: { Type: 'Static', Lines: staticLines }, source: 'lrclib', sourceDisplayName: 'LRCLIB' };
  }
  return null;
}

function parseLRC(lrcText, durationMs) {
  const rows = lrcText.split(/\r?\n/).map(r => r.trim()).filter(Boolean);
  const lines = [];
  rows.forEach(row => {
    const matches = Array.from(row.matchAll(/\[([0-9:.]+)\]/g));
    const text = row.replace(/\[[0-9:.]+\]/g, '').trim();
    if (!text || !matches.length) return;
    matches.forEach(match => {
      const ts = parseTimestamp(match[1]);
      if (ts !== null) lines.push({ text, startTimeMs: ts });
    });
  });
  if (!lines.length) return null;
  lines.sort((a, b) => a.startTimeMs - b.startTimeMs);
  const content = lines.map((line, i) => ({
    Type: 'Vocal',
    Text: line.text,
    StartTime: line.startTimeMs / 1000,
    EndTime: i < lines.length - 1 ? lines[i + 1].startTimeMs / 1000 : Math.max(line.startTimeMs / 1000 + 4, durationMs / 1000),
    OppositeAligned: false,
  }));
  return { Type: 'Line', StartTime: content[0]?.StartTime || 0, Content: content };
}

function parseTimestamp(ts) {
  const parts = ts.trim().split(':');
  if (parts.length < 2) return null;
  const minutes = parseInt(parts[0], 10);
  const seconds = parseFloat(parts[1]);
  return Math.round((minutes * 60 + seconds) * 1000);
}

// ═══════════════════════════════════════════════
// LyricsPlus Provider
// ═══════════════════════════════════════════════

function resolveSongwriters(metadata) {
  const songwriters = metadata?.songWriters || metadata?.songwriters;
  return Array.isArray(songwriters) ? songwriters : [];
}

async function fetchFromLyricsPlus(songName, artistName, albumName, durationSec) {
  const trySearchWithArtist = async (artist) => {
    try {
      const params = new URLSearchParams({
        title: songName,
        artist: artist
      });
      if (albumName) params.append('album', albumName);
      if (durationSec) params.append('duration', String(Math.round(durationSec)));

      const res = await fetch(`https://lyrics.geeked.wtf/v2/lyrics/get?${params}`, {
        headers: {
          'User-Agent': 'spicy-amll-player/1.0'
        }
      });

      if (!res.ok) return null;
      const data = await res.json();
      console.log('[TTMLRetriever] LyricsPlus raw data:', data);

      const isMusixmatch = data.source === "Musixmatch" || data.provider === "Musixmatch" || data.metadata?.provider === "Musixmatch";
      const ignoreWordSync = settingsManager.get("ignoreMusixmatchWordSync");
      
      if (data.type === "Word" && isMusixmatch && ignoreWordSync) {
        console.log('[TTMLRetriever] LyricsPlus: Downgrading Musixmatch Word sync to Line sync due to user settings.');
        data.type = "Line";
      }

      // Handle word/syllable-level sync (type: "Word")
      if (data.type === "Word" && data.lyrics && Array.isArray(data.lyrics)) {
        try {
          const lyricsData = convertLyricsPlusWordSync(data);
          if (lyricsData) {
            const songwriters = resolveSongwriters(data.metadata);
            if (songwriters.length > 0) {
              lyricsData.SongWriters = songwriters;
            }
            const result = {
              lyricsData,
              source: 'lyricsplus',
              sourceDisplayName: 'LyricsPlus'
            };
            // Attach songwriter metadata at both levels for compatibility
            if (songwriters.length > 0) {
              result.SongWriters = songwriters;
            }
            return result;
          }
        } catch (e) {
          console.warn('[TTMLRetriever] LyricsPlus word-sync parsing failed:', e);
        }
      }

      // Handle line-level sync (type: "Line")
      if (data.type === "Line" && data.lyrics && Array.isArray(data.lyrics)) {
        try {
          const lyricsData = convertLyricsPlusLineSync(data);
          if (lyricsData) {
            const songwriters = resolveSongwriters(data.metadata);
            if (songwriters.length > 0) {
              lyricsData.SongWriters = songwriters;
            }
            const result = {
              lyricsData,
              source: 'lyricsplus',
              sourceDisplayName: 'LyricsPlus'
            };
            // Attach songwriter metadata at both levels for compatibility
            if (songwriters.length > 0) {
              result.SongWriters = songwriters;
            }
            return result;
          }
        } catch (e) {
          console.warn('[TTMLRetriever] LyricsPlus line-sync parsing failed:', e);
        }
      }

      // Fallback to plain text lyrics
      if (data.lyrics && typeof data.lyrics === 'string' && data.lyrics.trim().length > 0) {
        const staticLines = data.lyrics
          .split(/\r?\n/)
          .map(l => l.trim())
          .filter(line => line.length > 0)
          .map(Text => ({ Text }));

        if (staticLines.length > 0) {
          const lyricsData = { Type: 'Static', Lines: staticLines };
          const songwriters = resolveSongwriters(data.metadata);
          if (songwriters.length > 0) {
            lyricsData.SongWriters = songwriters;
          }
          const result = {
            lyricsData,
            source: 'lyricsplus',
            sourceDisplayName: 'LyricsPlus'
          };
          if (songwriters.length > 0) {
            result.SongWriters = songwriters;
          }
          return result;
        }
      }
      return null;
    } catch (e) {
      console.warn(`[TTMLRetriever] LyricsPlus fetch error with artist "${artist}":`, e);
      return null;
    }
  };

  try {
    // Try with full artist name first
    let result = await trySearchWithArtist(artistName);
    if (result) return result;

    // If full artist search failed or returned empty, try with first artist (before "/")
    if (artistName.includes('/')) {
      const firstArtist = artistName.split('/')[0].trim();
      if (firstArtist && firstArtist !== artistName) {
        result = await trySearchWithArtist(firstArtist);
        if (result) return result;
      }
    }

    return null;
  } catch (e) {
    console.warn('[TTMLRetriever] LyricsPlus fetch error:', e);
    return null;
  }
}

function convertLyricsPlusWordSync(data) {
  const lines = data.lyrics;
  if (!lines || lines.length === 0) return null;

  // Extract agents from metadata (voice1, voice2, etc.)
  const agentMap = buildAgentMap(data.metadata?.agents || {});

  const content = lines.map(line => {
    // Convert times from milliseconds to seconds for player format
    const startTime = Math.max(0, line.time / 1000);
    const endTime = Math.max(0, (line.time + line.duration) / 1000);

    // Separate lead and background syllables
    const leadSyllables = [];
    const backgroundGroups = [];
    let currentBgGroup = null;
    let inBracketedSection = false;

    const syllabusArray = line.syllabus || [];
    let textCursor = 0;
    syllabusArray.forEach((syl, index) => {
      const sylTrimmed = syl.text.trim();
      
      let isPartOfWord = false;
      if (index < syllabusArray.length - 1) {
        const nextSyl = syllabusArray[index + 1];
        const nextSylTrimmed = nextSyl.text.trim();
        
        if (sylTrimmed && nextSylTrimmed && line.text) {
          const firstIdx = line.text.toLowerCase().indexOf(sylTrimmed.toLowerCase(), textCursor);
          if (firstIdx !== -1) {
            const secondIdx = line.text.toLowerCase().indexOf(nextSylTrimmed.toLowerCase(), firstIdx + sylTrimmed.length);
            if (secondIdx !== -1) {
              const betweenText = line.text.substring(firstIdx + sylTrimmed.length, secondIdx);
              isPartOfWord = !/\s/.test(betweenText);
              textCursor = firstIdx;
            } else {
              isPartOfWord = index < syllabusArray.length - 1;
            }
          } else {
            isPartOfWord = index < syllabusArray.length - 1;
          }
        } else {
          isPartOfWord = index < syllabusArray.length - 1;
        }
      }
      
      const syllableObj = {
        Text: sylTrimmed,
        StartTime: Math.max(0, syl.time / 1000),
        EndTime: Math.max(0, (syl.time + syl.duration) / 1000),
        IsPartOfWord: isPartOfWord
      };

      if (sylTrimmed.startsWith('(')) {
        inBracketedSection = true;
      }

      // Check for both synthetic and isBackground properties, plus bracketed section
      const isBackground = syl.synthetic || syl.isBackground || inBracketedSection;

      if (inBracketedSection) {
        syllableObj.Text = syllableObj.Text.replace('(', '').replace(')', '');
      }

      if (sylTrimmed.endsWith(')')) {
        inBracketedSection = false;
      }

      if (isBackground) {
        // Start or continue background group
        if (!currentBgGroup) {
          currentBgGroup = {
            StartTime: syllableObj.StartTime,
            Syllables: []
          };
        }
        currentBgGroup.Syllables.push(syllableObj);
        currentBgGroup.EndTime = syllableObj.EndTime;
      } else {
        // Close current background group if one exists
        if (currentBgGroup) {
          backgroundGroups.push(currentBgGroup);
          currentBgGroup = null;
        }
        leadSyllables.push(syllableObj);
      }
    });

    // Close any remaining background group
    if (currentBgGroup) {
      backgroundGroups.push(currentBgGroup);
    }

    // Determine agent ID for this line (duet support)
    const singerAlias = line.element?.singer;
    const agentId = singerAlias && agentMap[singerAlias] ? agentMap[singerAlias] : null;

    const lineObj = {
      Type: 'Vocal',
      Text: line.text,
      Lead: {
        StartTime: startTime,
        EndTime: endTime,
        Syllables: leadSyllables
      },
      OppositeAligned: agentId === 'v2' || agentId === 'v2000'
    };

    // Add background vocals if any
    if (backgroundGroups.length > 0) {
      lineObj.Background = backgroundGroups;
    }

    // Add agent ID for duet support
    if (agentId) {
      lineObj.AgentId = agentId;
    }

    return lineObj;
  });

  if (content.length === 0) return null;

  return {
    Type: 'Syllable',
    StartTime: content[0].Lead.StartTime,
    Content: content,
    Lines: content,
    // Store agents for the player's duet system
    Agents: Object.values(agentMap).reduce((acc, id) => {
      acc[id] = id === 'v2'; // v2 is opposite-aligned (right side)
      return acc;
    }, {})
  };
}

function convertLyricsPlusLineSync(data) {
  const lines = data.lyrics;
  if (!lines || lines.length === 0) return null;

  // Extract agents from metadata (voice1, voice2, etc.)
  const agentMap = buildAgentMap(data.metadata?.agents || {});

  const content = lines.map(line => {
    // Convert times from milliseconds to seconds for player format
    const startTime = Math.max(0, line.time / 1000);
    const endTime = Math.max(0, (line.time + line.duration) / 1000);

    // Determine agent ID for this line (duet support)
    const singerAlias = line.element?.singer;
    const agentId = singerAlias && agentMap[singerAlias] ? agentMap[singerAlias] : null;

    const lineObj = {
      Type: 'Vocal',
      Text: line.text,
      StartTime: startTime,
      EndTime: endTime,
      OppositeAligned: agentId === 'v2' || agentId === 'v2000'
    };

    // Add agent ID for duet support
    if (agentId) {
      lineObj.AgentId = agentId;
    }

    return lineObj;
  });

  if (content.length === 0) return null;

  return {
    Type: 'Line',
    StartTime: content[0].StartTime,
    Content: content,
    Lines: content,
    // Store agents for the player's duet system
    Agents: Object.values(agentMap).reduce((acc, id) => {
      acc[id] = id === 'v2'; // v2 is opposite-aligned (right side)
      return acc;
    }, {})
  };
}

function buildAgentMap(agentsObj) {
  const map = {};
  if (!agentsObj || typeof agentsObj !== 'object') return map;

  const entries = Object.entries(agentsObj);
  let voiceIndex = 1;

  for (const [alias, agentInfo] of entries) {
    if (!agentInfo) continue;
    
    // Use provided agent ID or generate one
    let agentId = agentInfo.id || agentInfo.agentId || `v${voiceIndex}`;
    
    // Normalize to v1, v2 format if not already
    if (!agentId.match(/^v\d+/)) {
      agentId = `v${voiceIndex}`;
    }

    map[alias] = agentId;
    voiceIndex++;
  }

  // Ensure v1 exists and v2 is marked as opposite
  if (!Object.values(map).includes('v1') && entries.length > 0) {
    const firstAlias = entries[0][0];
    map[firstAlias] = 'v1';
  }

  return map;
}

// ═══════════════════════════════════════════════
// Spicy AMLL Player API
// ═══════════════════════════════════════════════

async function fetchFromSpicyAPI(songId) {
  try {
    const token = await getSpotifyAccessToken();
    const res = await fetch(`${SPICY_API_URL}/query`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'spicylyrics-version': SPICY_VERSION,
        'SpicyLyrics-WebAuth': token ? `Bearer ${token}` : ''
      },
      body: JSON.stringify({
        queries: [{ operation: 'lyrics', variables: { id: songId, auth: 'SpicyLyrics-WebAuth' } }],
        client: { version: SPICY_VERSION }
      }),
    });

    if (!res.ok) return null;
    const data = await res.json();
    const result = data?.queries?.[0]?.result;
    if (!result || result.httpStatus !== 200) return null;

    let lyricsData = result.data;
    if (typeof lyricsData === 'string') {
      lyricsData = parseTTMLToLyrics(lyricsData);
    }

    if (lyricsData?.Type) {
      const source = lyricsData.source || 'spicy';
      return {
        lyricsData,
        source,
        sourceDisplayName: resolveSourceLabel(source, lyricsData.sourceDisplayName)
      };
    }
  } catch (err) {
    return null;
  }
}

// ═══════════════════════════════════════════════
// Apple Music Provider
// ═══════════════════════════════════════════════

async function fetchFromAppleMusic(songName, artistName, albumName, durationSec = 0, trackId = null) {
  try {
    let apiRes;

    if (trackId) {
      console.log(`[TTMLRetriever] Apple Music: Using track ID ${trackId}, fetching TTML...`);
      apiRes = await proxiedFetch(`https://api.spicyamll.online/lyrics?song=${trackId}`, { skipProxy: true });
    } else {
      console.log(`[TTMLRetriever] Apple Music: No track ID provided. Querying via text metadata metadata...`);
      const params = new URLSearchParams({
        title: songName,
        artist: artistName,
        album: albumName || '',
        duration: String(Math.round(durationSec))
      });
      apiRes = await proxiedFetch(`https://api.spicyamll.online/lyrics/get?${params}`, { skipProxy: true });
    }

    if (!apiRes || !apiRes.ok) return null;

    const data = await apiRes.json();
    console.log('[TTMLRetriever] Apple Music API Full Response:', data);

    const ttmlCode = data?.raw?.data?.[0]?.attributes?.ttmlLocalizations;
    console.log('[TTMLRetriever] Apple Music Extracted TTML:', ttmlCode);

    if (!ttmlCode) {
      console.log('[TTMLRetriever] Apple Music: No TTML found.');
      return null;
    }

    let lyricsData = parseTTMLToLyrics(ttmlCode);
    if (lyricsData?.Type) {
      return {
        lyricsData,
        source: 'apple',
        sourceDisplayName: 'Apple Music'
      };
    }

    return null;
  } catch (e) {
    console.warn('[TTMLRetriever] Apple Music fetch error:', e);
    return null;
  }
}


// ═══════════════════════════════════════════════
// Main Entry Point
// ═══════════════════════════════════════════════

export async function retrieveTTML(songName, artistName, albumName, durationSec = 0, songId = null) {
  const cacheKey = songId || `${songName}_${artistName}`.toLowerCase().replace(/\s+/g, '_');
  try {
    const cached = await LyricsStore.GetItem(cacheKey);
    if (cached) {
      console.log(`[TTMLRetriever] ✓ Found cached lyrics for key: ${cacheKey}`);
      return cached;
    }
  } catch (e) {
    console.warn('[TTMLRetriever] Cache read error:', e);
  }

  const order = settingsManager.get("lyricsSourceOrder") || DEFAULT_LYRICS_SOURCE_ORDER;
  const disabled = new Set(settingsManager.get("disabledLyricsSources") || []);
  const activeOrder = order.filter(p => !disabled.has(p));

  console.log(`[TTMLRetriever] Saved order: ${JSON.stringify(order)}`);
  console.log(`[TTMLRetriever] Disabled: ${JSON.stringify([...disabled])}`);
  console.log(`[TTMLRetriever] Sequential lookup: ${activeOrder.join(" -> ")}`);

  // Only perform iTunes scraping fallback if we definitely need it, otherwise finalSongId stays null
  // and enables the text-based Apple Music API alternative.
  let finalSongId = songId;
  if (!finalSongId) {
    finalSongId = await searchAppleTrackId(songName, artistName, albumName);
  }

  // 1. Fire all provider requests simultaneously in the background (Parallel Search)
  const providerPromises = {};
  for (const providerId of activeOrder) {
    providerPromises[providerId] = (async () => {
      try {
        if (providerId === "spicy" || providerId === "genius") return null;
        if (providerId === "apple" || providerId === "aml") return await fetchFromAppleMusic(songName, artistName, albumName, durationSec, finalSongId);
        if (providerId === "musixmatch") return await fetchFromMusixmatch(songName, artistName, albumName, durationSec * 1000);
        if (providerId === "netease") return await fetchFromNetease(songName, artistName);
        if (providerId === "lrclib") return await fetchFromLRCLIB(songName, artistName, albumName, durationSec);
        if (providerId === "lyricsplus") return await fetchFromLyricsPlus(songName, artistName, albumName, durationSec);
        if (providerId === "custom") return finalSongId ? await fetchFromCustomAPI(finalSongId) : null;
      } catch (e) {
        console.warn(`[TTMLRetriever] ${providerId} failed in parallel fetch:`, e);
      }
      return null;
    })();
  }

  let staticFallback = null;
  let finalResult = null;

  // 2. Resolve them strictly in priority order
  for (const providerId of activeOrder) {
    console.log(`[TTMLRetriever] Checking parallel result for ${providerId}...`);
    const result = await providerPromises[providerId];

    if (result) {
      if (result.lyricsData?.Type === 'Static') {
        console.log(`[TTMLRetriever] ✓ Found static lyrics via ${providerId}, keeping as fallback...`);
        if (!staticFallback) staticFallback = { ...result, songId: finalSongId };
        continue;
      }
      
      console.log(`[TTMLRetriever] ✓ Found synced lyrics via ${providerId}`);
      finalResult = { ...result, songId: finalSongId };
      break;
    }
  }

  if (!finalResult && staticFallback) {
    console.log(`[TTMLRetriever] ✗ No synced lyrics found, falling back to static lyrics from ${staticFallback.source}`);
    finalResult = staticFallback;
  }

  if (finalResult && finalResult.lyricsData) {
    try {
      await LyricsStore.SetItem(cacheKey, finalResult);
      console.log(`[TTMLRetriever] ✓ Saved lyrics to cache for key: ${cacheKey}`);
    } catch (e) {
      console.warn('[TTMLRetriever] Cache write error:', e);
    }
  }

  if (finalResult) return finalResult;

  console.log('[TTMLRetriever] ✗ No lyrics found from any source');
  return null;
}

/** Helper to find Apple Music track ID without full lyrics fetch */
async function searchAppleTrackId(songName, artistName, albumName) {
  try {
    const q1 = encodeURIComponent(`${artistName} ${albumName || ''} ${songName}`);
    let res = await proxiedFetch(`https://itunes.apple.com/search?term=${q1}&entity=song&limit=1`);
    if (res.ok) {
      let data = await res.json();
      if (data.results && data.results.length > 0) {
        return data.results[0].trackId;
      }
    }
    return null;
  } catch (e) {
    return null;
  }
}