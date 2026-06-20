/**
 * text-transformers.js
 * Implements meme formats and text mutations.
 */

// --- Gibberish (Wenomechainsama) Logic ---

const WordReplacements = [
  [/\bi'm\b/gi, "am"],
  [/\byou're\b/gi, "yur"],
  [/\bthe\b/gi, "da"],
  [/\byou\b/gi, "yu"],
  [/\bthrough\b/gi, "tru"],
  [/\bwith\b/gi, "wi"],
  [/\bwhat\b/gi, "wa"],
  [/\bwhen\b/gi, "wen"],
  [/\beverything\b/gi, "evrtin"],
  [/\bbeautiful\b/gi, "byutifo"],
  [/\bbecause\b/gi, "bikos"],
  [/\bwanna\b/gi, "wana"],
  [/\bgonna\b/gi, "gona"],
  [/\bheart\b/gi, "hat"],
  [/\bworld\b/gi, "wald"],
  [/\bgirl\b/gi, "gal"],
  [/\bonly\b/gi, "onli"],
  [/\breally\b/gi, "rili"],
  [/\bevery\b/gi, "evri"],
  [/\bmyself\b/gi, "masef"],
  [/\blike\b/gi, "laik"],
  [/\bjust\b/gi, "jas"],
];

const PhoneticRules = [
  [/ough/g, "o"],
  [/ight/g, "ai"],
  [/tion/g, "shun"],
  [/ture/g, "cha"],
  [/ph/g, "f"],
  [/th/g, "t"],
  [/ness$/g, "nes"],
  [/ment$/g, "men"],
  [/ing$/g, "in"],
  [/ee/g, "i"],
  [/oo/g, "u"],
  [/ea/g, "e"],
  [/([bcdfghjklmnpqrstvwxyz])\1/g, "$1"],
];

function rotateVowels(text) {
  const map = { a: "u", e: "o", i: "a", o: "e", u: "i" };
  let result = "";
  let hitFirst = false;
  for (const ch of text) {
    const lch = ch.toLowerCase();
    if ("aeiou".includes(lch)) {
      if (!hitFirst) {
        hitFirst = true;
        result += ch;
      } else {
        const trans = map[lch];
        result += (ch === lch ? trans : trans.toUpperCase());
      }
    } else {
      result += ch;
    }
  }
  return result;
}

export function gibberishify(text) {
  if (!text) return text;
  let res = text.toLowerCase();

  // Word dict
  for (const [reg, rep] of WordReplacements) {
    res = res.replace(reg, rep);
  }

  // Phonetic
  const words = res.split(/\s+/).map(w => {
    let word = w;
    for (const [reg, rep] of PhoneticRules) {
      word = word.replace(reg, rep);
    }
    return word;
  });

  res = words.join("");
  res = rotateVowels(res);
  
  // Collapse doubles again
  res = res.replace(/([bcdfghjklmnpqrstvwxyz])\1/g, "$1");
  return res;
}

// --- Weeb Format Logic ---

const WeebSuffixes = ["~", " nya!", " desu~", " (・`ω´・)", " (｡♥‿♥｡)", " (✿◠‿◠)"];

export function weebify(text) {
  if (!text) return text;
  let res = text;
  
  // Basic replacements
  res = res.replace(/r/g, "w").replace(/l/g, "w").replace(/R/g, "W").replace(/L/g, "W");
  res = res.replace(/no/g, "nyo").replace(/No/g, "Nyo");
  res = res.replace(/na/g, "nya").replace(/Na/g, "Nya");

  // Random suffix
  const suffix = WeebSuffixes[Math.floor(Math.random() * WeebSuffixes.length)];
  return res + suffix;
}

export function uppercase(text) {
  if (!text) return text;
  return text.toUpperCase();
}

export function lowercase(text) {
  if (!text) return text;
  return text.toLowerCase();
}
