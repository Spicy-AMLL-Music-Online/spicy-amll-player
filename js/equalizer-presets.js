/**
 * Spicy AMLL Player — Equalizer Presets
 * Standard gain values for 10-band EQ.
 */

export const EQ_BANDS = [32, 64, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];

export const EQ_PRESETS = {
  "Flat": [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  "Bass Boost": [6, 5, 4, 3, 1, 0, 0, 0, 0, 0],
  "Treble Boost": [0, 0, 0, 0, 0, 1, 3, 5, 6, 7],
  "Vocal": [-2, -1, 0, 2, 4, 5, 4, 2, 0, -1],
  "Electronic": [5, 4, 1, 0, -2, 2, 1, 3, 5, 6],
  "Rock": [4, 3, 2, 1, -1, -1, 1, 2, 3, 4],
  "Pop": [-1, 0, 2, 4, 3, 0, -1, -1, -1, -1],
  "Classical": [4, 3, 2, 1, 0, 0, 1, 2, 3, 4],
  "Bright": [0, 0, 0, 0, 0, 1, 2, 4, 6, 8],
  "Dark": [6, 4, 2, 1, 0, -2, -3, -4, -6, -8]
};
