/**
 * Spicy AMLL Player WEB — Lyrics Setter
 * Sets NotSung/Active/Sung status on each line/word based on audio time.
 * Port of LyricsSetter.ts
 */

import { LyricsObject } from './lyrics-applyer.js';

/**
 * Update status of all lyrics elements based on current playback position.
 * @param {number} currentPosition - Current position in milliseconds
 * @param {string} lyricsType - "Syllable", "Line", or "Static"
 */
export function setLyricsTime(currentPosition, lyricsType) {
  if (!lyricsType || lyricsType === "None" || lyricsType === "Static") return;

  if (lyricsType === "Syllable") {
    const lines = LyricsObject.Types.Syllable.Lines;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const start = line.StartTime;
      const end = line.EndTime;

      if (start <= currentPosition && currentPosition <= end) {
        line.Status = "Active";
        if (!line.Syllables?.Lead) continue;

        for (let j = 0; j < line.Syllables.Lead.length; j++) {
          const word = line.Syllables.Lead[j];
          if (word.StartTime <= currentPosition && currentPosition <= word.EndTime) {
            word.Status = "Active";
          } else if (word.StartTime >= currentPosition) {
            word.Status = "NotSung";
          } else {
            word.Status = "Sung";
          }
        }
      } else if (start >= currentPosition) {
        line.Status = "NotSung";
        if (!line.Syllables?.Lead) continue;
        for (const word of line.Syllables.Lead) {
          word.Status = "NotSung";
        }
      } else {
        // currentPosition > end
        // Find the next chronological line to check for short gaps
        let nextLine = null;
        let minGap = Infinity;
        for (let j = 0; j < lines.length; j++) {
          const l = lines[j];
          if (l.StartTime >= end) {
            const gap = l.StartTime - end;
            if (gap < minGap) {
              minGap = gap;
              nextLine = l;
            }
          }
        }

        if (nextLine && minGap < 300 && currentPosition < nextLine.StartTime) {
          line.Status = "Active";
        } else {
          line.Status = "Sung";
        }

        if (line.Syllables?.Lead) {
          for (const word of line.Syllables.Lead) {
            word.Status = "Sung";
          }
        }
      }
    }
  } else if (lyricsType === "Line") {
    const lines = LyricsObject.Types.Line.Lines;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const start = line.StartTime;
      const end = line.EndTime;

      if (start <= currentPosition && currentPosition <= end) {
        line.Status = "Active";
        if (line.DotLine && line.Syllables?.Lead) {
          for (const dot of line.Syllables.Lead) {
            if (dot.StartTime <= currentPosition && currentPosition <= dot.EndTime) {
              dot.Status = "Active";
            } else if (dot.StartTime >= currentPosition) {
              dot.Status = "NotSung";
            } else {
              dot.Status = "Sung";
            }
          }
        }
      } else if (start >= currentPosition) {
        line.Status = "NotSung";
        if (line.DotLine && line.Syllables?.Lead) {
          for (const dot of line.Syllables.Lead) dot.Status = "NotSung";
        }
      } else {
        line.Status = "Sung";
        if (line.DotLine && line.Syllables?.Lead) {
          for (const dot of line.Syllables.Lead) dot.Status = "Sung";
        }
      }
    }
  }
}
