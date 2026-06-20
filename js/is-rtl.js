/**
 * Spicy AMLL Player WEB — RTL Detection
 * Port of isRtl.ts
 */

/**
 * Determines if text is primarily right-to-left.
 * @param {string} text The string to check
 * @returns {boolean} true if the text is RTL, false if LTR
 */
export default function isRtl(text) {
  if (!text || text.length === 0) return false;

  // RTL Unicode ranges for Arabic, Hebrew, Persian, etc.
  const rtlRegex =
    /[\u0590-\u05FF\u0600-\u06FF\u0700-\u08FF\uFB1d-\uFdfb\uFE70-\uFEFC]/;

  // Find the first strongly directional character
  for (let i = 0; i < text.length; i++) {
    const char = text[i];

    // Skip digits, spaces and common punctuation
    if (/[\d\s,.;:?!()[\]{}\"'\\/<>@#$%^&*_=+\-]/.test(char)) {
      continue;
    }

    return rtlRegex.test(char);
  }

  return false;
}
