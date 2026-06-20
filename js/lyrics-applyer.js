/**
 * Spicy AMLL Player — Lyrics Applyer
 * Builds DOM elements from parsed TTML data.
 * Port of Applyer/Synced/Syllable.ts + Line.ts
 */

import isRtl from './is-rtl.js';
import { settingsManager } from './settings-manager.js';
import { gibberishify, weebify, uppercase, lowercase } from './text-transformers.js';

const LYRICS_BETWEEN_SHOW = 3;
const INTERLUDE_EARLIER_BY = 0;
const IDLE_LYRICS_SCALE = 0.95;

function transformText(text) {
  const format = settingsManager.get("memeFormat");
  if (format === "Gibberish (Wenomechainsama)") return gibberishify(text);
  if (format === "Weeb (・`ω´・)") return weebify(text);
  if (format === "UPPERCASE") return uppercase(text);
  if (format === "lowercase") return lowercase(text);
  return text;
}

/**
 * Convert time from seconds to milliseconds.
 */
function convertTime(t) {
  return t * 1000;
}

function getLastBaseArabicChar(str) {
  if (!str) return null;
  const diacriticsRegex = /[\u0610-\u061A\u064B-\u065F\u0670\u06D6-\u06DC\u06DF-\u06E8\u06EA-\u06EC\u06ED]/;
  for (let i = str.length - 1; i >= 0; i--) {
    const char = str[i];
    if (!diacriticsRegex.test(char)) {
      return char;
    }
  }
  return null;
}

function getFirstBaseArabicChar(str) {
  if (!str) return null;
  const diacriticsRegex = /[\u0610-\u061A\u064B-\u065F\u0670\u06D6-\u06DC\u06DF-\u06E8\u06EA-\u06EC\u06ED]/;
  for (let i = 0; i < str.length; i++) {
    const char = str[i];
    if (!diacriticsRegex.test(char)) {
      return char;
    }
  }
  return null;
}

function canConnectLeft(str) {
  const lastChar = getLastBaseArabicChar(str);
  if (!lastChar) return false;
  const isArabicLetter = /[\u0621-\u064A\u0671-\u06D3\u06D5]/.test(lastChar);
  if (!isArabicLetter) return false;
  const NON_CONNECTORS = /[ءآأؤإادذرزوة\u0621\u0622\u0623\u0624\u0625\u0627\u062f\u0630\u0631\u0632\u0648\u0629]/;
  return !NON_CONNECTORS.test(lastChar);
}

function canConnectRight(str) {
  const firstChar = getFirstBaseArabicChar(str);
  if (!firstChar) return false;
  const isArabicLetter = /[\u0621-\u064A\u0671-\u06D3\u06D5]/.test(firstChar);
  if (!isArabicLetter) return false;
  return firstChar !== 'ء' && firstChar !== '\u0621';
}

function preprocessArabicSyllables(syllables) {
  if (!syllables || syllables.length <= 1) return syllables;
  const diacriticsRegex = /[\u0610-\u061A\u064B-\u065F\u0670\u06D6-\u06DC\u06DF-\u06E8\u06EA-\u06EC\u06ED]/;
  
  const result = [];
  for (let i = 0; i < syllables.length; i++) {
    result.push({ ...syllables[i] });
  }

  for (let i = 0; i < result.length - 1; i++) {
    const cur = result[i];
    const next = result[i + 1];
    
    if (!cur.IsPartOfWord) continue;
    
    const curText = cur.Text ?? "";
    const nextText = next.Text ?? "";
    
    const lastChar = getLastBaseArabicChar(curText);
    const firstChar = getFirstBaseArabicChar(nextText);
    
    if (lastChar === 'ل' && firstChar === 'ا') {
      let alefIndex = -1;
      for (let j = 0; j < nextText.length; j++) {
        if (nextText[j] === 'ا') {
          alefIndex = j;
          break;
        }
      }
      
      if (alefIndex !== -1) {
        let len = 1;
        while (alefIndex + len < nextText.length && diacriticsRegex.test(nextText[alefIndex + len])) {
          len++;
        }
        
        const extracted = nextText.substring(alefIndex, alefIndex + len);
        cur.Text = curText + extracted;
        next.Text = nextText.substring(0, alefIndex) + nextText.substring(alefIndex + len);
      }
    }
  }
  
  return result;
}

/**
 * Checks if a word is eligible for letter-by-letter emphasis.
 * Restricted to LTR languages and depends on character length vs duration.
 */
function isLetterCapable(text, duration) {
  // If the text contains spaces, it's a multi-word phrase, not a single capable syllable/word.
  if (text.trim().includes(" ")) return false;

  const isSimpleMode = settingsManager.get("simpleLyricsMode");
  const letterLength = text.split("").length;

  if (isSimpleMode) return false; // FUCKKKK
  if (settingsManager.get("amlLyricsAnimations")) return false;

  if (isRtl(text)) return false;

  // New sensitivity: 0.9s and 8+ letters
  if (duration >= 900 && letterLength >= 8) {
    return true;
  }

  // Fallback to complex duration formula for other words
  const baseMinDuration = isSimpleMode ? 1050 : 1000;
  const complexMinDuration = baseMinDuration + ((letterLength - 1) * 25);

  return duration >= complexMinDuration;
}

/**
 * Splits a word into individual letters and sets up timing for each.
 */
function applyEmphasis(letters, wordElem, lead, isBgWord = false) {
  const isSimpleMode = settingsManager.get("simpleLyricsMode");

  // Official subtractions from Emphasize.ts
  // In simple mode: shift start 21ms earlier and trim less off the end (40ms vs 250ms)
  const subStart = isSimpleMode ? 21 : 0;
  const subEnd = isSimpleMode ? 40 : 250;

  const startTime = convertTime(lead.StartTime) - subStart;
  const endTime = convertTime(lead.EndTime) - subEnd;
  const totalDuration = endTime - startTime;
  const letterDuration = totalDuration / letters.length;

  const letterDataArr = [];

  letters.forEach((letter, index) => {
    const letterElem = document.createElement("span");
    letterElem.textContent = letter;
    letterElem.classList.add("letter", "Emphasis");

    const letterStartTime = startTime + (index * letterDuration);
    const letterEndTime = letterStartTime + letterDuration;

    if (index === letters.length - 1) {
      letterElem.classList.add("LastLetterInWord");
    }

    if (!settingsManager.get("simpleLyricsMode") && !settingsManager.get("amlLyricsAnimations")) {
      letterElem.style.setProperty("--gradient-position", "-20%");
      letterElem.style.scale = IDLE_LYRICS_SCALE.toString();
      letterElem.style.transform = `translateY(calc(var(--DefaultLyricsSize) * 0.02))`;
    }

    letterDataArr.push({
      HTMLElement: letterElem,
      StartTime: letterStartTime,
      EndTime: letterEndTime,
      TotalTime: letterDuration,
      Emphasis: true,
      BGLetter: isBgWord
    });

    wordElem.appendChild(letterElem);
  });

  wordElem.classList.add("letterGroup");
  return letterDataArr;
}

/**
 * Global lyrics object tracking all line/word references.
 */
export const LyricsObject = {
  Types: {
    Syllable: { Lines: [] },
    Line: { Lines: [] },
    Static: { Lines: [] },
  },
  RawData: null, // Stores the original parsed data
};

let currentLineIndex = -1;

function setWordArrayInCurrentLine() {
  currentLineIndex = LyricsObject.Types.Syllable.Lines.length - 1;
  if (currentLineIndex >= 0) {
    LyricsObject.Types.Syllable.Lines[currentLineIndex].Syllables = { Lead: [] };
  }
}

function setWordArrayInCurrentLine_LINE() {
  currentLineIndex = LyricsObject.Types.Line.Lines.length - 1;
  if (currentLineIndex >= 0) {
    LyricsObject.Types.Line.Lines[currentLineIndex].Syllables = { Lead: [] };
  }
}

export function clearLyricsArrays() {
  LyricsObject.Types.Syllable.Lines = [];
  LyricsObject.Types.Line.Lines = [];
  LyricsObject.Types.Static.Lines = [];
  currentLineIndex = -1;
}

/**
 * Apply Syllable-synced lyrics to the DOM.
 * @param {object} data - Parsed TTML data with Type="Syllable"
 * @param {HTMLElement} lyricsContentEl - The .LyricsContent element
 * @returns {HTMLElement} The scroll container element
 */
export function applySyllableLyrics(data, lyricsContentEl) {
  const showRomanized = settingsManager.get("showRomanized");
  const showTranslation = settingsManager.get("showTranslation");
  LyricsObject.RawData = data;
  clearLyricsArrays();

  const container = document.createElement("div");
  container.classList.add("SpicyLyricsScrollContainer");
  container.setAttribute("data-lyrics-type", "Syllable");
  if (data.IsConvertedLine) {
    container.classList.add("is-converted-line");
  }
  if (settingsManager.get("simpleLyricsMode")) {
    container.classList.add("sl-simple-mode");
  }

  // Leading interlude dots
  if (data.StartTime >= LYRICS_BETWEEN_SHOW) {
    createMusicalLine(container, 0, convertTime(data.StartTime + INTERLUDE_EARLIER_BY),
      data.Content[0]?.OppositeAligned, "Syllable");
  }

  data.Content.forEach((line, index, arr) => {
    const lineElem = document.createElement("div");
    lineElem.classList.add("line");
    if (data.IsConvertedLine) {
      lineElem.classList.add("is-converted-line");
    }
    lineElem.setAttribute("dir", "auto");

    const nextLineStartTime = arr[index + 1]?.Lead.StartTime ?? 0;
    const lineEndTimeAndNextDist = nextLineStartTime !== 0 ? nextLineStartTime - line.Lead.EndTime : 0;
    const lineEndTime = line.Lead.EndTime;

    LyricsObject.Types.Syllable.Lines.push({
      HTMLElement: lineElem,
      StartTime: convertTime(line.Lead.StartTime),
      EndTime: convertTime(lineEndTime),
      TotalTime: convertTime(lineEndTime) - convertTime(line.Lead.StartTime),
      IsConvertedLine: data.IsConvertedLine,
    });
    setWordArrayInCurrentLine();

    if (line.OppositeAligned) lineElem.classList.add("OppositeAligned");

    container.appendChild(lineElem);

    let currentWordGroup = null;

    // Build words/syllables
    let syllablesToRender = preprocessArabicSyllables(line.Lead.Syllables);
    if (showTranslation && line.TranslatedText) {
      const words = line.TranslatedText.split(" ");
      const totalTime = line.Lead.EndTime - line.Lead.StartTime;
      const wordTime = totalTime / words.length;

      syllablesToRender = words.map((w, index) => ({
        Text: w,
        StartTime: line.Lead.StartTime + (index * wordTime),
        EndTime: line.Lead.StartTime + ((index + 1) * wordTime),
        IsPartOfWord: false
      }));
    }

    syllablesToRender.forEach((lead, iL, aL) => {
      const rawText = ((!showTranslation && showRomanized && lead.RomanizedText !== undefined) ? lead.RomanizedText : lead.Text) ?? "";
      const displayText = settingsManager.get("trimSyllableSpaces") ? rawText.trim() : rawText;
      const totalDuration = convertTime(lead.EndTime) - convertTime(lead.StartTime);
      const isEmphasized = isLetterCapable(displayText, totalDuration);

      let word;
      let lettersData = null;

      if (isEmphasized) {
        word = document.createElement("div");
        const transformedText = transformText(displayText);
        const letters = transformedText.split("");
        lettersData = applyEmphasis(letters, word, lead, false);
      } else {
        word = document.createElement("span");
        // Add ZWJ for Arabic cursive connections across syllable splits selectively
        let visualText = transformText(displayText);
        if (isRtl(displayText)) {
          const ZWJ = '\u200D';
          const prevText = iL > 0 ? ((!showTranslation && showRomanized && aL[iL - 1].RomanizedText !== undefined) ? aL[iL - 1].RomanizedText : aL[iL - 1].Text) ?? "" : "";
          const nextText = iL < aL.length - 1 ? ((!showTranslation && showRomanized && aL[iL + 1].RomanizedText !== undefined) ? aL[iL + 1].RomanizedText : aL[iL + 1].Text) ?? "" : "";
          
          if (iL > 0 && aL[iL - 1]?.IsPartOfWord && canConnectLeft(prevText) && canConnectRight(displayText)) {
            visualText = ZWJ + visualText;
          }
          if (lead.IsPartOfWord && canConnectLeft(displayText) && canConnectRight(nextText)) {
            visualText = visualText + ZWJ;
          }
        }
        word.textContent = visualText;
        if (!settingsManager.get("simpleLyricsMode") && !settingsManager.get("amlLyricsAnimations")) {
          word.style.setProperty("--gradient-position", "-20%");
          word.style.setProperty("--text-shadow-opacity", "0%");
          word.style.setProperty("--text-shadow-blur-radius", "4px");
          word.style.scale = IDLE_LYRICS_SCALE.toString();
          word.style.transform = "translateY(calc(var(--DefaultLyricsSize) * 0.01))";
        } else {
          // Clear any stale inline styles from a previous non-simple render
          word.style.removeProperty("--gradient-position");
          word.style.removeProperty("--text-shadow-opacity");
          word.style.removeProperty("--text-shadow-blur-radius");
          word.style.removeProperty("scale");
          word.style.removeProperty("transform");
        }
        word.classList.add("word");
      }

      if (isRtl(displayText) && !lineElem.classList.contains("rtl")) {
        lineElem.classList.add("rtl");
      }

      const ci = LyricsObject.Types.Syllable.Lines.length - 1;
      if (LyricsObject.Types.Syllable.Lines[ci]?.Syllables?.Lead) {
        const syllableObj = {
          HTMLElement: word,
          Text: displayText,
          StartTime: convertTime(lead.StartTime),
          EndTime: convertTime(lead.EndTime),
          TotalTime: totalDuration,
        };
        if (isEmphasized) {
          syllableObj.LetterGroup = true;
          syllableObj.Letters = lettersData;
        }
        LyricsObject.Types.Syllable.Lines[ci].Syllables.Lead.push(syllableObj);
      }

      if (iL === aL.length - 1) {
        word.classList.add("LastWordInLine");
      } else if (lead.IsPartOfWord) {
        word.classList.add("PartOfWord");
      }

      // Always group syllables that are part of a word to prevent awkward line breaks
      if (lead.IsPartOfWord) {
        if (!currentWordGroup) {
          currentWordGroup = document.createElement("span");
          currentWordGroup.classList.add("word-group");
          currentWordGroup.style.display = "inline-block";
          currentWordGroup.style.whiteSpace = "nowrap";
          lineElem.appendChild(currentWordGroup);
        }
        currentWordGroup.appendChild(word);
      } else {
        if (currentWordGroup) {
          currentWordGroup.appendChild(word);
          currentWordGroup = null;
        } else {
          lineElem.appendChild(word);
        }
      }
    });

    // Background vocals
    if (line.Background) {
      line.Background.forEach(bg => {
        const bgLine = document.createElement("div");
        bgLine.classList.add("line", "bg-line");
        bgLine.setAttribute("dir", "auto");

        LyricsObject.Types.Syllable.Lines.push({
          HTMLElement: bgLine,
          StartTime: convertTime(bg.StartTime),
          EndTime: convertTime(bg.EndTime),
          TotalTime: convertTime(bg.EndTime) - convertTime(bg.StartTime),
          BGLine: true,
          IsConvertedLine: data.IsConvertedLine,
        });
        setWordArrayInCurrentLine();

        if (line.OppositeAligned) bgLine.classList.add("OppositeAligned");
        container.appendChild(bgLine);

        let currentBGWordGroup = null;

        let bgSyllablesToRender = preprocessArabicSyllables(bg.Syllables);
        bgSyllablesToRender.forEach((bw, bI, bA) => {
          const rawBgText = ((showRomanized && bw.RomanizedText !== undefined) ? bw.RomanizedText : bw.Text) ?? "";
          const displayBgText = settingsManager.get("trimSyllableSpaces") ? rawBgText.trim() : rawBgText;
          const totalDuration = convertTime(bw.EndTime) - convertTime(bw.StartTime);
          const isEmphasized = isLetterCapable(displayBgText, totalDuration);

          let bwE;
          let lettersData = null;

          if (isEmphasized) {
            bwE = document.createElement("div");
            const transformedBgText = transformText(displayBgText);
            const letters = transformedBgText.split("");
            lettersData = applyEmphasis(letters, bwE, bw, true);
          } else {
            bwE = document.createElement("span");
            // Add ZWJ for Arabic cursive connections across syllable splits selectively
            let visualBgText = transformText(displayBgText);
            if (isRtl(displayBgText)) {
              const ZWJ = '\u200D';
              const prevText = bI > 0 ? ((showRomanized && bA[bI - 1].RomanizedText !== undefined) ? bA[bI - 1].RomanizedText : bA[bI - 1].Text) ?? "" : "";
              const nextText = bI < bA.length - 1 ? ((showRomanized && bA[bI + 1].RomanizedText !== undefined) ? bA[bI + 1].RomanizedText : bA[bI + 1].Text) ?? "" : "";

              if (bI > 0 && bA[bI - 1]?.IsPartOfWord && canConnectLeft(prevText) && canConnectRight(displayBgText)) {
                visualBgText = ZWJ + visualBgText;
              }
              if (bw.IsPartOfWord && canConnectLeft(displayBgText) && canConnectRight(nextText)) {
                visualBgText = visualBgText + ZWJ;
              }
            }
            bwE.textContent = visualBgText;
            if (!settingsManager.get("simpleLyricsMode") && !settingsManager.get("amlLyricsAnimations")) {
              bwE.style.setProperty("--gradient-position", "0%");
              bwE.style.setProperty("--text-shadow-opacity", "0%");
              bwE.style.setProperty("--text-shadow-blur-radius", "4px");
              bwE.style.scale = IDLE_LYRICS_SCALE.toString();
              bwE.style.transform = "translateY(calc(var(--font-size) * 0.01))";
            } else {
              bwE.style.removeProperty("--gradient-position");
              bwE.style.removeProperty("--text-shadow-opacity");
              bwE.style.removeProperty("--text-shadow-blur-radius");
              bwE.style.removeProperty("scale");
              bwE.style.removeProperty("transform");
            }
            bwE.classList.add("word");
          }

          if (isRtl(displayBgText) && !bgLine.classList.contains("rtl")) {
            bgLine.classList.add("rtl");
          }

          const ci = LyricsObject.Types.Syllable.Lines.length - 1;
          if (LyricsObject.Types.Syllable.Lines[ci]?.Syllables?.Lead) {
            const syllableObj = {
              HTMLElement: bwE,
              Text: displayBgText,
              StartTime: convertTime(bw.StartTime),
              EndTime: convertTime(bw.EndTime),
              TotalTime: totalDuration,
              BGWord: true,
            };
            if (isEmphasized) {
              syllableObj.LetterGroup = true;
              syllableObj.Letters = lettersData;
            }
            LyricsObject.Types.Syllable.Lines[ci].Syllables.Lead.push(syllableObj);
          }

          bwE.classList.add("bg-word", "word");

          if (bI === bA.length - 1) {
            bwE.classList.add("LastWordInLine");
          } else if (bw.IsPartOfWord) {
            bwE.classList.add("PartOfWord");
          }

          const prevBG = bA[bI - 1];
          if (bw.IsPartOfWord || (prevBG?.IsPartOfWord && currentBGWordGroup)) {
            if (!currentBGWordGroup) {
              const group = document.createElement("span");
              group.classList.add("word-group");
              group.style.display = "inline-block";
              group.style.whiteSpace = "nowrap";
              bgLine.appendChild(group);
              currentBGWordGroup = group;
            }
            currentBGWordGroup.appendChild(bwE);
            if (!bw.IsPartOfWord && prevBG?.IsPartOfWord) currentBGWordGroup = null;
          } else {
            currentBGWordGroup = null;
            bgLine.appendChild(bwE);
          }
        });
      });
    }

    // Interlude dots between lines
    if (arr[index + 1] && arr[index + 1].Lead.StartTime - line.Lead.EndTime >= LYRICS_BETWEEN_SHOW) {
      createMusicalLine(container,
        convertTime(line.Lead.EndTime),
        convertTime(arr[index + 1].Lead.StartTime + INTERLUDE_EARLIER_BY),
        arr[index + 1].OppositeAligned, "Syllable");
    }
  });

  // Credits
  renderCredits(data, container);

  // Add spacer for centering
  const spacer = document.createElement("div");
  spacer.classList.add("lyrics-spacer");
  container.appendChild(spacer);

  lyricsContentEl.innerHTML = "";
  lyricsContentEl.appendChild(container);

  return container;
}


/**
 * Estimates the 'rhythmic weight' of a word based on character count,
 * ignoring punctuation to provide more natural timing.
 */
function getTextWeight(text) {
  const compact = text.replace(/[.,!?;:'"()[\]{}\-—–…@#$%^&*~`]/g, "").replace(/\s/g, "");
  return Math.max(1, compact.length || text.trim().length);
}

/**
 * Converts Line-synced lyrics to Syllable-synced by estimating word durations.
 * Distributes line duration proportionally based on character weight.
 * Preserves original spacing and punctuation into the syllable tokens.
 */
export function convertToSyllable(data) {
  try {
    const processTextSegment = (text, startTime, endTime) => {
      if (!text || typeof text !== "string") return [];
      const rawWords = text.split(/\s+/).filter(Boolean);
      if (rawWords.length === 0) return [];

      const totalDuration = (endTime && endTime > startTime) ? endTime - startTime : 1.5;
      const weights = rawWords.map(w => getTextWeight(w));
      const totalWeight = weights.reduce((sum, w) => sum + w, 0);

      let currentCursor = startTime;
      let currentPosInLine = 0;

      return rawWords.map((word, i) => {
        const weight = weights[i];
        const wordDuration = (weight / totalWeight) * totalDuration;
        const start = currentCursor;
        const end = currentCursor + wordDuration;
        currentCursor = end;

        // Find the exact text in the line for spacing/punctuation accuracy
        const foundIdx = text.indexOf(word, currentPosInLine);
        let capturedText = word;

        if (foundIdx !== -1) {
          // Find where the next word starts to capture the "gap" (spaces/punctuation)
          const nextWord = rawWords[i + 1];
          let nextIdx = nextWord ? text.indexOf(nextWord, foundIdx + word.length) : text.length;

          // If we found the next word, capture everything from current word start to next word start
          if (nextIdx !== -1) {
            capturedText = text.substring(foundIdx, nextIdx);
            currentPosInLine = nextIdx;
          } else {
            // Last word, capture everything to the end
            capturedText = text.substring(foundIdx);
            currentPosInLine = text.length;
          }
        }

        return {
          Text: settingsManager.get("trimSyllableSpaces") ? capturedText.trim() : capturedText,
          StartTime: start,
          EndTime: end,
          IsPartOfWord: false
        };
      });
    };

    const syllableData = {
      ...data,
      Type: "Syllable",
      IsConvertedLine: !settingsManager.get("forceWordSync"),
      Content: data.Content.map(line => {
        if (!line) return null;
        const textVal = line.Text || "";
        const leadSyllables = processTextSegment(textVal, line.StartTime, line.EndTime);
        if (leadSyllables.length === 0) return null;

        const res = {
          OppositeAligned: !!line.OppositeAligned,
          Lead: {
            StartTime: line.StartTime,
            EndTime: line.EndTime,
            Syllables: leadSyllables
          }
        };

        // Preserve translated and romanized text
        if (line.TranslatedText) res.TranslatedText = line.TranslatedText;
        if (line.RomanizedText) res.RomanizedText = line.RomanizedText;

        // Handle background vocals if they exist in the line data
        if (line.Background && Array.isArray(line.Background) && line.Background.length > 0) {
          res.Background = line.Background.map(bg => {
            if (!bg) return null;
            const bgText = bg.Text || bg.Syllables?.map(s => s.Text).join("") || "";
            return {
              StartTime: bg.StartTime,
              EndTime: bg.EndTime,
              Syllables: processTextSegment(bgText, bg.StartTime, bg.EndTime)
            };
          }).filter(Boolean);
        }

        return res;
      }).filter(Boolean)
    };
    return syllableData;
  } catch (err) {
    console.error("[SpicyPlayer] convertToSyllable failed:", err);
    return data;
  }
}

/**
 * Apply Line-synced lyrics to the DOM.
 */
export function applyLineLyrics(data, lyricsContentEl) {
  return applySyllableLyrics(convertToSyllable(data), lyricsContentEl);
}


/**
 * Apply Static lyrics to the DOM.
 */
export function applyStaticLyrics(data, lyricsContentEl) {
  const showRomanized = settingsManager.get("showRomanized");
  const showTranslation = settingsManager.get("showTranslation");
  LyricsObject.RawData = data;
  clearLyricsArrays();

  const container = document.createElement("div");
  container.classList.add("SpicyLyricsScrollContainer");
  container.setAttribute("data-lyrics-type", "Static");

  data.Lines.forEach(line => {
    const displayText = (showTranslation && line.TranslatedText !== undefined) ? line.TranslatedText : (showRomanized && line.RomanizedText !== undefined) ? line.RomanizedText : line.Text;
    const lineElem = document.createElement("div");
    lineElem.classList.add("line", "static");
    lineElem.setAttribute("dir", "auto");
    if (isRtl(displayText)) lineElem.classList.add("rtl");

    const wordElem = document.createElement("span");
    wordElem.classList.add("word");
    wordElem.textContent = transformText(displayText);
    lineElem.appendChild(wordElem);

    LyricsObject.Types.Static.Lines.push({ HTMLElement: lineElem });
    container.appendChild(lineElem);
  });

  // Credits
  renderCredits(data, container);

  // Add spacer for centering
  const spacer = document.createElement("div");
  spacer.classList.add("lyrics-spacer");
  container.appendChild(spacer);

  lyricsContentEl.innerHTML = "";
  lyricsContentEl.appendChild(container);
  return container;
}

/**
 * Renders credits for songwriters and TTML makers.
 */
function renderCredits(data, container) {
  const hasSongWriters = data.SongWriters && data.SongWriters.length > 0;
  const hasMaker = data.makerHandle && data.makerId;

  if (!hasSongWriters && !hasMaker) return;

  const creditsContainer = document.createElement("div");
  creditsContainer.classList.add("Credits");

  if (hasSongWriters) {
    const songwriters = document.createElement("div");
    songwriters.classList.add("CreditLine", "Songwriters");
    songwriters.textContent = "Written by: " + data.SongWriters.join(", ");
    creditsContainer.appendChild(songwriters);
  }

  if (hasMaker) {
    const makerSection = document.createElement("div");
    makerSection.classList.add("MakerSection");
    makerSection.style.cssText = `
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      width: 100%;
      text-align: center;
    `;

    const communityHeader = document.createElement("div");
    communityHeader.classList.add("CreditNotice");
    communityHeader.textContent = "These lyrics have been provided by our community";
    makerSection.appendChild(communityHeader);

    const makerCredits = document.createElement("div");
    makerCredits.classList.add("CreditLine", "TTMLMaker");
    makerCredits.style.cssText = `
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 8px;
      margin-top: 8px;
      width: 100%;
    `;

    const label = document.createElement("span");
    label.textContent = "Made and Uploaded by";
    label.style.cssText = `
      font-size: 0.85rem;
      opacity: 0.6;
      font-weight: 500;
    `;
    makerCredits.appendChild(label);

    const badgeContainer = document.createElement("a");
    badgeContainer.href = `https://api.spicyamll.online/user/@${data.makerHandle}`;
    badgeContainer.target = "_blank";
    badgeContainer.classList.add("maker-link");
    badgeContainer.style.cssText = `
      display: flex;
      align-items: center;
      gap: 12px;
      background: rgba(255, 255, 255, 0.05);
      border: 1px solid rgba(255, 255, 255, 0.1);
      padding: 8px 16px;
      border-radius: 16px;
      text-decoration: none;
      color: white;
      cursor: pointer;
      transition: all 0.2s ease;
      backdrop-filter: blur(10px);
      -webkit-backdrop-filter: blur(10px);
    `;
    badgeContainer.addEventListener("mouseover", () => {
      badgeContainer.style.background = "rgba(255, 255, 255, 0.1)";
      badgeContainer.style.borderColor = "rgba(255, 255, 255, 0.2)";
      badgeContainer.style.transform = "translateY(-1px)";
    });
    badgeContainer.addEventListener("mouseout", () => {
      badgeContainer.style.background = "rgba(255, 255, 255, 0.05)";
      badgeContainer.style.borderColor = "rgba(255, 255, 255, 0.1)";
      badgeContainer.style.transform = "translateY(0)";
    });
    badgeContainer.addEventListener("click", (e) => {
      e.preventDefault();
      showUserProfileIframe(data.makerHandle);
    });

    // PFP
    const avatar = document.createElement("img");
    avatar.src = data.makerAvatar || "https://discord.com/assets/embed/avatars/0.png";
    avatar.onerror = () => {
      avatar.src = "https://cdn.discordapp.com/embed/avatars/0.png";
    };
    avatar.style.cssText = `
      width: 32px;
      height: 32px;
      border-radius: 50%;
      object-fit: cover;
      border: 1px solid rgba(255, 255, 255, 0.2);
    `;
    badgeContainer.appendChild(avatar);

    // Text container (Name + Username)
    const textCol = document.createElement("div");
    textCol.style.cssText = `
      display: flex;
      flex-direction: column;
      align-items: flex-start;
      gap: 2px;
    `;

    // Display Name
    const nameEl = document.createElement("span");
    nameEl.textContent = data.makerDisplayName || data.makerNickname || data.makerHandle;
    nameEl.style.cssText = `
      font-size: 0.95rem;
      font-weight: 600;
      color: #ffffff;
    `;
    textCol.appendChild(nameEl);

    // Username (not the nickname) under the name in small text
    const handleEl = document.createElement("span");
    handleEl.textContent = `@${data.makerHandle}`;
    handleEl.style.cssText = `
      font-size: 0.75rem;
      opacity: 0.5;
      font-weight: 400;
    `;
    textCol.appendChild(handleEl);

    badgeContainer.appendChild(textCol);
    makerCredits.appendChild(badgeContainer);
    makerSection.appendChild(makerCredits);

    creditsContainer.appendChild(makerSection);
  }

  container.appendChild(creditsContainer);
}

function showUserProfileIframe(username) {
  let existingModal = document.getElementById("spicy-profile-modal");
  if (existingModal) existingModal.remove();

  const modal = document.createElement("div");
  modal.id = "spicy-profile-modal";
  modal.style.cssText = `
    position: fixed;
    top: 0;
    left: 0;
    width: 100vw;
    height: 100vh;
    background: rgba(0, 0, 0, 0.7);
    backdrop-filter: blur(12px);
    -webkit-backdrop-filter: blur(12px);
    z-index: 99999;
    display: flex;
    justify-content: center;
    align-items: center;
    opacity: 0;
    transition: opacity 0.3s ease;
  `;

  const card = document.createElement("div");
  card.style.cssText = `
    position: relative;
    width: 90%;
    max-width: 500px;
    height: 80vh;
    background: #0f0f0f;
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 28px;
    overflow: hidden;
    box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.75);
    transform: scale(0.9);
    transition: transform 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);
  `;

  const closeBtn = document.createElement("button");
  closeBtn.innerHTML = "&times;";
  closeBtn.style.cssText = `
    position: absolute;
    top: 16px;
    right: 16px;
    background: rgba(255, 255, 255, 0.15);
    border: none;
    color: white;
    font-size: 24px;
    width: 40px;
    height: 40px;
    border-radius: 50%;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: all 0.2s ease;
    z-index: 10;
  `;
  closeBtn.addEventListener("mouseover", () => {
    closeBtn.style.background = "rgba(255, 255, 255, 0.3)";
  });
  closeBtn.addEventListener("mouseout", () => {
    closeBtn.style.background = "rgba(255, 255, 255, 0.15)";
  });
  closeBtn.addEventListener("click", () => {
    modal.style.opacity = "0";
    card.style.transform = "scale(0.9)";
    setTimeout(() => modal.remove(), 300);
  });

  const iframe = document.createElement("iframe");
  iframe.src = `https://api.spicyamll.online/user/@${username}`;
  iframe.style.cssText = `
    width: 100%;
    height: 100%;
    border: none;
    background: transparent;
  `;

  card.appendChild(closeBtn);
  card.appendChild(iframe);
  modal.appendChild(card);
  document.body.appendChild(modal);

  requestAnimationFrame(() => {
    modal.style.opacity = "1";
    card.style.transform = "scale(1)";
  });

  modal.addEventListener("click", (e) => {
    if (e.target === modal) {
      modal.style.opacity = "0";
      card.style.transform = "scale(0.9)";
      setTimeout(() => modal.remove(), 300);
    }
  });
}

/**
 * Creates musical interlude dots.
 */
function createMusicalLine(container, startTime, endTime, oppositeAligned, lyricsType) {
  const musicalLine = document.createElement("div");
  musicalLine.classList.add("line", "musical-line");

  const totalTime = endTime - startTime;
  const lineData = {
    HTMLElement: musicalLine,
    StartTime: startTime,
    EndTime: endTime,
    TotalTime: totalTime,
    DotLine: true,
  };

  if (lyricsType === "Syllable") {
    LyricsObject.Types.Syllable.Lines.push(lineData);
    setWordArrayInCurrentLine();
  } else {
    LyricsObject.Types.Line.Lines.push(lineData);
    setWordArrayInCurrentLine_LINE();
  }

  if (oppositeAligned) musicalLine.classList.add("OppositeAligned");

  const dotGroup = document.createElement("div");
  dotGroup.classList.add("dotGroup");

  const dotTime = totalTime / 3;
  const ci = lyricsType === "Syllable"
    ? LyricsObject.Types.Syllable.Lines.length - 1
    : LyricsObject.Types.Line.Lines.length - 1;
  const targetLines = lyricsType === "Syllable"
    ? LyricsObject.Types.Syllable.Lines
    : LyricsObject.Types.Line.Lines;

  for (let d = 0; d < 3; d++) {
    const dot = document.createElement("span");
    dot.classList.add("word", "dot");
    dot.textContent = "•";

    if (targetLines[ci]?.Syllables?.Lead) {
      targetLines[ci].Syllables.Lead.push({
        HTMLElement: dot,
        StartTime: startTime + dotTime * d,
        EndTime: d === 2 ? endTime - 400 : startTime + dotTime * (d + 1),
        TotalTime: dotTime,
        Dot: true,
      });
    }
    dotGroup.appendChild(dot);
  }

  musicalLine.appendChild(dotGroup);
  container.appendChild(musicalLine);
}