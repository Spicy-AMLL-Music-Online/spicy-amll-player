import { GetExpireStore } from './stores.js';

export const LyricsStore = GetExpireStore("SL:lyrics", 1, { Duration: 3, Unit: "Days" });

export const RemoveCurrentLyrics_AllCaches = async (ui = false) => {
  const nowBar = document.getElementById('now-bar');
  const songId = nowBar?.getAttribute('data-am-track-id');
  const songName = document.querySelector('.SongName span')?.textContent || '';
  const artistName = document.querySelector('.Artists')?.textContent || '';
  const cacheKey = songId || `${songName}_${artistName}`.toLowerCase().replace(/\s+/g, '_');

  try {
    await LyricsStore.RemoveItem(cacheKey);
    if (ui) {
      alert(`Lyrics for "${songName}" removed from persistent caches.`);
    }
  } catch (error) {
    if (ui) {
      alert(`Failed to remove lyrics cache.`);
    }
    console.error("SpicyLyrics Cache:", error);
  }
};

export const RemoveLyricsCache = async (ui = false) => {
  try {
    await LyricsStore.Destroy();
    if (ui) {
      alert("Lyrics cache destroyed successfully.");
    }
  } catch (error) {
    if (ui) {
      alert(`Failed to destroy Lyrics Cache.`);
    }
    console.error("SpicyLyrics Cache:", error);
  }
};

export const RemoveCurrentLyrics_StateCache = (ui = false) => {
  try {
    if (ui) {
      alert("Lyrics cleared from internal state.");
    }
  } catch (error) {
    console.error("SpicyLyrics State:", error);
  }
};
