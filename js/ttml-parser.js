/**
 * Spicy AMLL Player — TTML Parser
 * Exact port of ParseTTML.ts
 * Parses Apple Music-style TTML files into structured lyrics data.
 */

import { settingsManager } from "./settings-manager.js";

const WRITER_KEY_MATCH = /(songwriter|writers?|written[\s_-]*by|lyricist|composer)/i;
const LEADING_BG_BRACKET = /^[([{]\s*/;
const TRAILING_BG_BRACKET = /\s*[)\]}]$/;

function getAttr(element, ...names) {
  if (!element) return null;
  for (const name of names) {
    const direct = element.getAttribute(name);
    if (direct !== null) return direct;
  }
  for (const attr of Array.from(element.attributes)) {
    if (names.includes(attr.name) || names.includes(attr.localName)) {
      return attr.value;
    }
  }
  return null;
}

function findElements(root, ...tagNames) {
  const normalized = tagNames.map(n => n.toLowerCase());
  return Array.from(root.querySelectorAll("*")).filter(el => {
    const tag = el.tagName.toLowerCase();
    const local = el.localName.toLowerCase();
    return normalized.includes(tag) || normalized.includes(local);
  });
}

function parseTimestamp(value) {
  if (!value) return null;
  const time = value.trim();
  if (!time) return null;

  const hmsMatch = time.match(/^(?:(\d{2,3}):)?(\d{1,2}):(\d{1,2})(?:[.:](\d+))?$/);
  if (hmsMatch) {
    const hours = parseInt(hmsMatch[1] ?? "0", 10);
    const minutes = parseInt(hmsMatch[2], 10);
    const seconds = parseInt(hmsMatch[3], 10);
    const fraction = hmsMatch[4] ? parseFloat(`0.${hmsMatch[4]}`) : 0;
    const parsedTime = (hours * 60 + minutes) * 60 + seconds + fraction;
    return Math.max(0, parsedTime - 0.2);
  }

  const secondsMatch = time.match(/^(\d+(?:\.\d+)?)(s)?$/);
  if (secondsMatch) return Math.max(0, parseFloat(secondsMatch[1]) - 0.2);

  const msMatch = time.match(/^(\d+(?:\.\d+)?)ms$/);
  if (msMatch) return Math.max(0, (parseFloat(msMatch[1]) / 1000) - 0.2);

  return null;
}

function getNodeText(node) {
  return node.textContent ?? "";
}

function isSkippableWhitespace(node) {
  if (node.nodeType !== Node.TEXT_NODE) return false;
  const text = node.textContent ?? "";
  if (text.trim()) return false;
  return /[\r\n\t]/.test(text);
}

function getNextMeaningfulNode(nodes, index) {
  for (let i = index + 1; i < nodes.length; i++) {
    if (isSkippableWhitespace(nodes[i])) continue;
    return nodes[i];
  }
  return null;
}

function hasExplicitSpaceBeforeNextMeaningfulNode(nodes, index) {
  for (let i = index + 1; i < nodes.length; i++) {
    const node = nodes[i];
    if (node.nodeType === Node.TEXT_NODE) {
      const text = node.textContent ?? "";
      if (/[ ]/.test(text)) return true;
      if (isSkippableWhitespace(node)) continue;
    }
    if (!isSkippableWhitespace(node)) return false;
  }
  return false;
}

function hasSpaceBetween(node1, node2) {
  let curr = node1.nextSibling;
  while (curr && curr !== node2) {
    if (curr.nodeType === Node.TEXT_NODE) {
      if (/\s/.test(curr.textContent ?? "")) {
        return true;
      }
    }
    curr = curr.nextSibling;
  }
  return false;
}

function isPartOfWord(nodes, index) {
  const current = nodes[index];
  const next = getNextMeaningfulNode(nodes, index);
  if (!current || !next) return false;

  const currentRawText = getNodeText(current);
  const nextRawText = getNodeText(next);

  // If the current node has a trailing space or the next node has a leading space, they are not part of the same word.
  if (/\s$/.test(currentRawText) || /^\s/.test(nextRawText)) {
    return false;
  }

  const currentText = currentRawText.trim();
  const nextText = nextRawText.trim();
  if (!currentText || !nextText) return false;

  // Check if there is any whitespace (space, newline, tab) between the original DOM nodes
  if (hasSpaceBetween(current, next)) return false;

  if (hasExplicitSpaceBeforeNextMeaningfulNode(nodes, index)) return false;
  return true;
}

function readITunesMetadata(root) {
  const translations = new Map();
  const transliterations = new Map();
  const transliterationPieces = new Map();

  for (const node of findElements(root, "itunesmetadata")) {
    for (const text of findElements(node, "text")) {
      const key = getAttr(text, "for");
      if (!key) continue;
      const parent = text.parentElement?.tagName;
      const textValue = text.textContent?.trim() ?? "";

      if ((parent === "translations" || parent === "translation") && textValue) {
        translations.set(key, textValue);
      }
      if (parent === "transliterations" || parent === "transliteration") {
        if (textValue) transliterations.set(key, textValue);
        const pieces = Array.from(text.children)
          .filter(c => c.tagName === "span")
          .map(c => c.textContent?.trim() ?? "")
          .filter(Boolean);
        if (pieces.length > 0) transliterationPieces.set(key, pieces);
      }
    }
  }
  return { translations, transliterations, transliterationPieces };
}

export function parseSongwriterString(text) {
  const writers = new Map();
  // Split by ;, or "and" (with surrounding spaces)
  const parts = text.split(/[,;]|\band\b/i).map(e => e.trim()).filter(Boolean);
  for (const part of parts) {
    const normalized = part.toLowerCase();
    if (!writers.has(normalized)) writers.set(normalized, part);
  }
  return Array.from(writers.values());
}

function parseSongwriters(root) {
  const writers = new Map();
  const addWriterParts = (text) => {
    parseSongwriterString(text).forEach(w => {
      const normalized = w.toLowerCase();
      if (!writers.has(normalized)) writers.set(normalized, w);
    });
  };

  for (const meta of findElements(root, "amll:meta", "meta")) {
    const key = getAttr(meta, "key", "name", "property", "type") ?? meta.parentElement?.tagName ?? "";
    const rawValue = getAttr(meta, "value", "content") ?? meta.textContent?.trim() ?? "";
    if (!key || !rawValue || !WRITER_KEY_MATCH.test(key)) continue;
    addWriterParts(rawValue);
  }

  for (const node of findElements(root, "songwriter", "songwriters", "writer", "writers", "composer", "lyricist")) {
    if (node.children.length > 0) continue;
    const text = node.textContent?.trim() ?? "";
    if (!text) continue;
    addWriterParts(text);
  }
  return Array.from(writers.values());
}

function parseAgents(root) {
  const agents = new Map();
  for (const agent of findElements(root, "ttm:agent", "agent")) {
    const id = getAttr(agent, "xml:id", "id");
    if (!id) continue;
    agents.set(id, id === "v2" || id === "v2000");
  }
  return agents;
}

function collectPlainText(nodes) {
  return nodes.map(n => getNodeText(n)).join("").replace(/\s+/g, " ").trim();
}

function buildTextFromSyllables(syllables) {
  let text = "";
  syllables.forEach((s, i) => {
    text += s.Text;
    if (i < syllables.length - 1 && !s.IsPartOfWord) text += " ";
  });
  return text.trim();
}

function applyRomanizedPieces(syllables, pieces) {
  if (!pieces || pieces.length === 0 || syllables.length === 0) return;
  const finalPieces = [...pieces];
  if (finalPieces.length > syllables.length) {
    const overflow = finalPieces.splice(syllables.length - 1).join(" ");
    finalPieces.push(overflow);
  }
  syllables.forEach((s, i) => {
    if (i < finalPieces.length && finalPieces[i]) s.RomanizedText = finalPieces[i];
  });
}

function parseSyllableNodes(nodes, lineStart, lineEnd) {
  const syllables = [];
  nodes.forEach((node, index) => {
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    if (node.tagName !== "span") return;
    const text = node.textContent ?? "";
    if (!text.trim()) return;
    const role = getAttr(node, "ttm:role", "role");
    if (role === "x-translation" || role === "x-roman") return;

    const startTime = parseTimestamp(getAttr(node, "begin")) ?? lineStart;
    const endTime = parseTimestamp(getAttr(node, "end")) ?? lineEnd;
    const shouldTrim = settingsManager.get("trimSyllableSpaces");
    syllables.push({
      Text: shouldTrim ? text.trim() : text,
      StartTime: startTime,
      EndTime: endTime,
      IsPartOfWord: isPartOfWord(nodes, index),
    });
  });
  return syllables;
}

function parseBackground(element, lineStart, lineEnd) {
  const childNodes = Array.from(element.childNodes).filter(n => !isSkippableWhitespace(n));
  const syllables = parseSyllableNodes(childNodes, lineStart, lineEnd);
  if (syllables.length === 0) return null;

  // Remove parentheses from background syllables
  syllables.forEach(s => {
    s.Text = s.Text.replace(/\(|\)/g, "").trim();
  });

  return {
    StartTime: syllables[0].StartTime,
    EndTime: syllables[syllables.length - 1].EndTime,
    Syllables: syllables.filter(s => s.Text),
  };
}

function parseParagraph(paragraph, div, body, oppositeAgents, transliterations, transliterationPieces, translations) {
  const paragraphStart = parseTimestamp(getAttr(paragraph, "begin")) ?? 0;
  const paragraphEnd = parseTimestamp(getAttr(paragraph, "end")) ?? paragraphStart;
  const agentId = getAttr(paragraph, "ttm:agent", "agent") ??
    getAttr(div, "ttm:agent", "agent") ??
    getAttr(body, "ttm:agent", "agent");
  const oppositeAligned = agentId ? oppositeAgents.get(agentId) === true : false;
  const lineKey = getAttr(paragraph, "itunes:key");
  const songPart = div ? getAttr(div, "itunes:songPart", "songPart") : null;

  let leadRomanizedText = lineKey ? transliterations.get(lineKey) : undefined;
  let leadTranslatedText = lineKey ? translations.get(lineKey) : undefined;

  const childNodes = Array.from(paragraph.childNodes).filter(n => !isSkippableWhitespace(n));
  const leadSyllables = [];
  const plainNodes = [];
  const background = [];

  childNodes.forEach((node, index) => {
    if (node.nodeType === Node.TEXT_NODE) {
      plainNodes.push(node);
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    if (node.tagName !== "span") { plainNodes.push(node); return; }

    const role = getAttr(node, "ttm:role", "role");
    const rawText = node.textContent ?? "";
    const shouldTrim = settingsManager.get("trimSyllableSpaces");
    const text = shouldTrim ? rawText.trim() : rawText;

    if (role === "x-translation") {
      if (!leadTranslatedText && text) leadTranslatedText = text.trim();
      return;
    }
    if (role === "x-roman") {
      if (!leadRomanizedText && text) leadRomanizedText = text.trim();
      return;
    }
    if (role === "x-bg") {
      const bg = parseBackground(node, paragraphStart, paragraphEnd);
      if (bg) background.push(bg);
      return;
    }

    const startTime = parseTimestamp(getAttr(node, "begin"));
    const endTime = parseTimestamp(getAttr(node, "end"));

    if (startTime !== null || endTime !== null) {
      leadSyllables.push({
        Text: text,
        StartTime: startTime ?? paragraphStart,
        EndTime: endTime ?? paragraphEnd,
        IsPartOfWord: isPartOfWord(childNodes, index),
      });
      return;
    }
    plainNodes.push(node);
  });

  applyRomanizedPieces(leadSyllables, lineKey ? transliterationPieces.get(lineKey) : undefined);

  // Detect syllable sequences in brackets (e.g. starting with '(' and ending with ')')
  let bgStartIdx = -1;
  let bgEndIdx = -1;

  for (let i = 0; i < leadSyllables.length; i++) {
    const text = leadSyllables[i].Text.trim();
    if (text.startsWith('(')) {
      bgStartIdx = i;
    }
    if (bgStartIdx !== -1 && text.endsWith(')')) {
      bgEndIdx = i;
      
      const bgSyllables = leadSyllables.slice(bgStartIdx, bgEndIdx + 1);
      
      // Clean parentheses from first and last syllables in the sequence
      if (bgSyllables.length > 0) {
        bgSyllables[0].Text = bgSyllables[0].Text.replace(/^\(/, '').trim();
        const last = bgSyllables[bgSyllables.length - 1];
        last.Text = last.Text.replace(/\)$/, '').trim();
      }
      
      const filteredBg = bgSyllables.filter(s => s.Text);
      if (filteredBg.length > 0) {
        background.push({
          StartTime: filteredBg[0].StartTime,
          EndTime: filteredBg[filteredBg.length - 1].EndTime,
          Syllables: filteredBg,
        });
      }
      
      // Remove these syllables from leadSyllables
      leadSyllables.splice(bgStartIdx, bgEndIdx - bgStartIdx + 1);
      
      // Adjust index to account for splice
      i = bgStartIdx - 1;
      bgStartIdx = -1;
      bgEndIdx = -1;
    }
  }

  let leadText = leadSyllables.length > 0
    ? buildTextFromSyllables(leadSyllables)
    : collectPlainText(plainNodes);

  // Auto-detect background vocal if remaining lead text is wrapped in parentheses
  if (leadText.startsWith('(') && leadText.endsWith(')')) {
    const bgSyllables = leadSyllables.length > 0 ? leadSyllables : [{
      Text: leadText,
      StartTime: paragraphStart,
      EndTime: paragraphEnd,
      IsPartOfWord: false
    }];

    // Clean parentheses from syllables
    bgSyllables.forEach(s => {
      s.Text = s.Text.replace(/\(|\)/g, "").trim();
    });

    const filteredBg = bgSyllables.filter(s => s.Text);
    if (filteredBg.length > 0) {
      background.push({
        StartTime: filteredBg[0].StartTime,
        EndTime: filteredBg[filteredBg.length - 1].EndTime,
        Syllables: filteredBg,
      });
      leadSyllables.length = 0;
      leadText = "";
    }
  }

  if (!leadText && background.length === 0) return null;

  const timedEntries = leadSyllables.length > 0
    ? leadSyllables.map(s => ({ StartTime: s.StartTime, EndTime: s.EndTime }))
    : background.flatMap(g => g.Syllables.map(s => ({ StartTime: s.StartTime, EndTime: s.EndTime })));

  const lineStart = timedEntries.length > 0
    ? Math.min(...timedEntries.map(e => e.StartTime))
    : paragraphStart;
  const lineEnd = timedEntries.length > 0
    ? Math.max(...timedEntries.map(e => e.EndTime))
    : paragraphEnd;

  return {
    leadText,
    leadRomanizedText,
    leadTranslatedText,
    leadSyllables,
    background,
    startTime: lineStart,
    endTime: lineEnd,
    oppositeAligned,
    ...(songPart ? { SongPart: songPart } : {}),
  };
}

/**
 * Splits a single syllable entry that contains multiple words into
 * individual word entries with evenly distributed timings.
 * Used to force word-sync animation on lines that only have one <span>.
 */
function splitSingleSyllableIntoWords(syllable) {
  const words = syllable.Text.split(/\s+/).filter(w => w.length > 0);
  if (words.length <= 1) return [syllable];

  const totalDuration = syllable.EndTime - syllable.StartTime;
  const wordDuration = totalDuration / words.length;

  return words.map((word, i) => ({
    Text: word,
    StartTime: syllable.StartTime + (i * wordDuration),
    EndTime: syllable.StartTime + ((i + 1) * wordDuration),
    IsPartOfWord: false,
  }));
}

function buildSyllableLyrics(lines, songwriters, language) {
  return {
    Type: "Syllable",
    ...(language ? { Language: language } : {}),
    ...(songwriters.length > 0 ? { SongWriters: songwriters } : {}),
    StartTime: lines[0]?.startTime ?? 0,
    Content: lines.map(line => {
      let leadSyllables = line.leadSyllables.length > 0
        ? line.leadSyllables
        : [{
          Text: line.leadText,
          ...(line.leadRomanizedText ? { RomanizedText: line.leadRomanizedText } : {}),
          StartTime: line.startTime,
          EndTime: line.endTime,
          IsPartOfWord: false,
        }];

      // Force word-sync: split single-syllable lines into individual words
      if (leadSyllables.length === 1 && leadSyllables[0].Text.includes(' ')) {
        leadSyllables = splitSingleSyllableIntoWords(leadSyllables[0]);
      }

      return {
        Type: "Vocal",
        OppositeAligned: line.oppositeAligned,
        ...(line.SongPart ? { SongPart: line.SongPart } : {}),
        ...(line.leadTranslatedText ? { TranslatedText: line.leadTranslatedText } : {}),
        Lead: {
          StartTime: line.startTime,
          EndTime: line.endTime,
          Syllables: leadSyllables,
        },
        ...(line.background.length > 0 ? { Background: line.background } : {}),
      };
    }),
  };
}

function buildLineLyrics(lines, songwriters, language) {
  return {
    Type: "Line",
    ...(language ? { Language: language } : {}),
    ...(songwriters.length > 0 ? { SongWriters: songwriters } : {}),
    StartTime: lines[0]?.startTime ?? 0,
    Content: lines.map(line => ({
      Type: "Vocal",
      Text: line.leadText,
      ...(line.SongPart ? { SongPart: line.SongPart } : {}),
      ...(line.leadRomanizedText ? { RomanizedText: line.leadRomanizedText } : {}),
      ...(line.leadTranslatedText ? { TranslatedText: line.leadTranslatedText } : {}),
      StartTime: line.startTime,
      EndTime: line.endTime,
      OppositeAligned: line.oppositeAligned,
      ...(line.background && line.background.length > 0 ? { Background: line.background } : {}),
    })).filter(line => line.Text),
  };
}

function buildStaticLyrics(lines, songwriters, language) {
  return {
    Type: "Static",
    ...(language ? { Language: language } : {}),
    ...(songwriters.length > 0 ? { SongWriters: songwriters } : {}),
    Lines: lines.map(line => ({
      Text: line.leadText,
      ...(line.leadRomanizedText ? { RomanizedText: line.leadRomanizedText } : {}),
      ...(line.leadTranslatedText ? { TranslatedText: line.leadTranslatedText } : {}),
    })).filter(line => line.Text),
  };
}

/**
 * Parse a TTML string into structured lyrics data.
 * @param {string} ttml - Raw TTML XML string
 * @returns {object} Parsed lyrics object with Type, Content, etc.
 */
export default function parseTTMLToLyrics(ttml) {
  const doc = new DOMParser().parseFromString(ttml, "text/xml");
  const parserError = doc.querySelector("parsererror");
  if (parserError) {
    throw new Error(parserError.textContent?.trim() || "Invalid TTML");
  }

  const tt = doc.documentElement;
  if (!tt || tt.tagName !== "tt") {
    throw new Error("Invalid TTML: missing <tt> root element");
  }

  const songwriters = parseSongwriters(tt);
  const oppositeAgents = parseAgents(tt);
  const { translations, transliterations, transliterationPieces } = readITunesMetadata(tt);
  
  // Explicitly check if the provider marked this as static/unsynced
  const isExplicitlyStatic = getAttr(tt, "itunes:timing", "timing") === "None";

  const language = getAttr(tt, "xml:lang", "lang");

  const body = Array.from(tt.children).find(c => c.tagName === "body");
  if (!body) throw new Error("Invalid TTML: missing <body>");

  const parsedLines = [];
  const divs = Array.from(body.children).filter(c => c.tagName === "div");
  const containers = divs.length > 0 ? divs : [body];

  for (const div of containers) {
    const paragraphs = Array.from(div.children).filter(c => c.tagName === "p");
    for (const paragraph of paragraphs) {
      const parsed = parseParagraph(
        paragraph,
        div === body ? null : div,
        body,
        oppositeAgents,
        transliterations,
        transliterationPieces,
        translations
      );
      if (parsed) parsedLines.push(parsed);
    }
  }

  if (parsedLines.length === 0) {
    throw new Error("No lyric lines found in TTML");
  }

  const hasSyllableTimings = parsedLines.some(l => l.leadSyllables.length > 0);
  const hasLineTimings = parsedLines.some(l => l.startTime > 0 || l.endTime > 0);

  if (!isExplicitlyStatic) {
    if (hasSyllableTimings) return buildSyllableLyrics(parsedLines, songwriters, language);
    if (hasLineTimings) return buildLineLyrics(parsedLines, songwriters, language);
  }
  return buildStaticLyrics(parsedLines, songwriters, language);
}

/**
 * Escapes special XML characters in a string.
 */
function escapeXml(unsafe) {
  return unsafe.replace(/[<>&"']/g, m => {
    switch (m) {
      case '<': return '&lt;';
      case '>': return '&gt;';
      case '&': return '&amp;';
      case '"': return '&quot;';
      case "'": return '&apos;';
      default: return m;
    }
  });
}

/**
 * Formats a number of seconds into a TTML timestamp (HH:MM:SS.mmm).
 * @param {number} seconds 
 * @returns {string}
 */
function formatTimestamp(seconds) {
  if (seconds === null || seconds === undefined) return "00:00:00.000";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const ms = Math.round((seconds % 1) * 1000);
  return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}.${ms.toString().padStart(3, '0')}`;
}

/**
 * Converts structured lyrics data back into a TTML XML string.
 * @param {object} data - Structured lyrics data
 * @returns {string} TTML XML string
 */
export function generateTTML(data) {
  let xml = `<?xml version="1.0" encoding="utf-8"?>\n`;
  const langAttr = data.Language ? ` xml:lang="${escapeXml(data.Language)}"` : '';
  const timing = (data.Type === "Static") ? "None" : "Word";
  xml += `<tt xmlns="http://www.w3.org/ns/ttml" xmlns:ttm="http://www.w3.org/ns/ttml#metadata" xmlns:itunes="http://music.apple.com/lyric-ttml-internal" xmlns:amll="http://apple.com/itunes/amll" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" itunes:timing="${timing}"${langAttr}>\n`;

  // Head section
  xml += `  <head>\n`;
  xml += `    <metadata>\n`;

  // Standard Apple Music agents
  xml += `      <ttm:agent xml:id="v1" type="person" />\n`;
  const hasDuet = data.Content && data.Content.some(line => line.OppositeAligned);
  if (hasDuet) {
    xml += `      <ttm:agent xml:id="v2" type="person" />\n`;
  }
  xml += `      <ttm:agent xml:id="v1000" type="group" />\n`;

  xml += `      <iTunesMetadata xmlns="http://music.apple.com/lyric-ttml-internal">\n`;
  xml += `        <translations/>\n`;
  if (data.SongWriters && data.SongWriters.length > 0) {
    xml += `        <songwriters>\n`;
    data.SongWriters.forEach(writer => {
      xml += `          <songwriter>${escapeXml(writer)}</songwriter>\n`;
    });
    xml += `        </songwriters>\n`;
  }
  xml += `      </iTunesMetadata>\n`;
  xml += `    </metadata>\n`;
  xml += `  </head>\n`;

  // Calculate body duration
  let maxEndTime = 0;
  if (data.Content && data.Content.length > 0) {
    const lastLine = data.Content[data.Content.length - 1];
    if (data.Type === "Syllable") {
      maxEndTime = lastLine.Lead?.EndTime || 0;
    } else if (data.Type === "Line") {
      maxEndTime = lastLine.EndTime || 0;
    }
  }
  const bodyDur = maxEndTime > 0 ? ` dur="${formatTimestamp(maxEndTime)}"` : '';

  // Body section
  xml += `  <body${bodyDur} ttm:agent="v1000">\n`;

  // Group lines into divs based on SongPart and OppositeAligned/Duet
  const divs = [];
  let currentDiv = null;

  if (data.Type === "Syllable" || data.Type === "Line") {
    data.Content.forEach((line) => {
      const lineStart = data.Type === "Syllable" ? line.Lead.StartTime : line.StartTime;
      const lineEnd = data.Type === "Syllable" ? line.Lead.EndTime : line.EndTime;
      const songPart = line.SongPart || null;
      const agent = line.OppositeAligned ? 'v2' : 'v1';

      let startNewDiv = !currentDiv;
      if (currentDiv) {
        const prevLine = currentDiv.lines[currentDiv.lines.length - 1];
        const prevLineEnd = data.Type === "Syllable" ? prevLine.Lead.EndTime : prevLine.EndTime;

        if (currentDiv.songPart !== songPart) startNewDiv = true;
        if (currentDiv.agent !== agent) startNewDiv = true;
        if (lineStart - prevLineEnd > 10) startNewDiv = true; // start new div if time gap > 10 seconds
      }

      if (startNewDiv) {
        if (currentDiv) {
          divs.push(currentDiv);
        }
        currentDiv = {
          songPart,
          agent,
          begin: lineStart,
          end: lineEnd,
          lines: []
        };
      }

      currentDiv.lines.push(line);
      currentDiv.end = lineEnd;
    });
    if (currentDiv) {
      divs.push(currentDiv);
    }
  }

  if (divs.length > 0) {
    divs.forEach(div => {
      const divBegin = formatTimestamp(div.begin);
      const divEnd = formatTimestamp(div.end);
      const songPartAttr = div.songPart ? ` itunes:songPart="${escapeXml(div.songPart)}"` : '';
      xml += `    <div begin="${divBegin}" end="${divEnd}" ttm:agent="${div.agent}"${songPartAttr}>\n`;

      div.lines.forEach((line) => {
        const globalIndex = data.Content.indexOf(line);
        const key = `L${globalIndex + 1}`;
        const begin = formatTimestamp(data.Type === "Syllable" ? line.Lead.StartTime : line.StartTime);
        const end = formatTimestamp(data.Type === "Syllable" ? line.Lead.EndTime : line.EndTime);
        const agent = line.OppositeAligned ? 'v2' : 'v1';

        xml += `      <p begin="${begin}" end="${end}" itunes:key="${key}" ttm:agent="${agent}">\n`;

        if (data.Type === "Syllable") {
          line.Lead.Syllables.forEach(s => {
            const sBegin = formatTimestamp(s.StartTime);
            const sEnd = formatTimestamp(s.EndTime);
            xml += `<span begin="${sBegin}" end="${sEnd}">${escapeXml(s.Text).trim()}</span> `;
          });
          xml += `\n`;

          if (line.Background) {
            line.Background.forEach(bg => {
              xml += `        <span ttm:role="x-bg">\n`;
              bg.Syllables.forEach(s => {
                const sBegin = formatTimestamp(s.StartTime);
                const sEnd = formatTimestamp(s.EndTime);
                xml += `<span begin="${sBegin}" end="${sEnd}">${escapeXml(s.Text).trim()}</span> `;
              });
              xml += `\n`;
              xml += `        </span>\n`;
            });
          }
        } else {
          // Line type
          xml += `${escapeXml(line.Text)}`;
          if (line.Background) {
            line.Background.forEach(bg => {
              xml += ` <span ttm:role="x-bg">(${escapeXml(bg.Syllables.map(s => s.Text).join(""))})</span>`;
            });
          }
        }
        xml += `      </p>\n`;
      });

      xml += `    </div>\n`;
    });
  } else {
    // Static or empty
    xml += `    <div>\n`;
    if (data.Lines) {
      data.Lines.forEach(line => {
        xml += `      <p>${escapeXml(line.Text)}</p>\n`;
      });
    }
    xml += `    </div>\n`;
  }

  xml += `  </body>\n`;
  xml += `</tt>`;

  return xml;
}