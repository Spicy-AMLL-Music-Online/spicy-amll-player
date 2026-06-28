/**
 * Spicy AMLL Player WEB — Lyrics Animator
 * Spring-physics animation engine for word-by-word gradient and scale animation.
 * Port of LyricsAnimator.ts
 */

import Spring from './spring.js';
import Spline from './spline.js';
import { LyricsObject } from './lyrics-applyer.js';
import { isUserScrolling } from './scroll-manager.js';
import { settingsManager } from './settings-manager.js';

// Detect mobile/tablet for performance tuning
const _isMobile = /Android|iPhone|iPad|iPod|Mobile|Tablet/i.test(navigator.userAgent) || window.innerWidth <= 768;

// ── Spline Ranges ──
const ScaleRange = [
  { Time: 0, Value: 0.95 },
  { Time: 0.7, Value: 1.025 },
  { Time: 1, Value: 1 },
];
const YOffsetRange = [
  { Time: 0, Value: 1 / 100 },
  { Time: 0.9, Value: -(1 / 60) },
  { Time: 1, Value: 0 },
];
const GlowRange = [
  { Time: 0, Value: 0 },
  { Time: 0.15, Value: 1 },
  { Time: 0.6, Value: 1 },
  { Time: 1, Value: 0 },
];

const DotAnimations = {
  YOffsetDamping: 0.4,
  YOffsetFrequency: 1.25,
  ScaleDamping: 0.4,
  ScaleFrequency: 1.25,
  GlowDamping: 0.5,
  GlowFrequency: 1,
  OpacityDamping: 0.5,
  OpacityFrequency: 1,

  ScaleRange: [
    { Time: 0, Value: 0.75 },
    { Time: 0.7, Value: 1.05 },
    { Time: 1, Value: 1 },
  ],
  YOffsetRange: [
    { Time: 0, Value: 0 },
    { Time: 0.7, Value: -0.20 },
    { Time: 1, Value: 0 },
  ],
  GlowRange: [
    { Time: 0, Value: 0 },
    { Time: 0.6, Value: 1 },
    { Time: 1, Value: 1 },
  ],
  OpacityRange: [
    { Time: 0, Value: 0.35 },
    { Time: 0.6, Value: 1 },
    { Time: 1, Value: 1 },
  ],
};

function getSpline(range) {
  return new Spline(range.map(r => r.Time), range.map(r => r.Value));
}

const ScaleSpline = getSpline(ScaleRange);
const YOffsetSpline = getSpline(YOffsetRange);
const GlowSpline = getSpline(GlowRange);

const DotScaleSpline = getSpline(DotAnimations.ScaleRange);
const DotYOffsetSpline = getSpline(DotAnimations.YOffsetRange);
const DotGlowSpline = getSpline(DotAnimations.GlowRange);
const DotOpacitySpline = getSpline(DotAnimations.OpacityRange);

const YOffsetDamping = 0.4, YOffsetFrequency = 1.25;
const ScaleDamping = 0.6, ScaleFrequency = 0.7;
const GlowDamping = 0.5, GlowFrequency = 1;
const BlurMultiplier = 2.5;
const LetterGlowMultiplier_Opacity = 123.2;

const SimpleLyricsMode_LetterEffectsStrengthConfig = {
  LongerThan: 1500,
  Longer: {
    Glow: 0.4,
    YOffset: 0.45,
    Scale: 1.103,
  },
  Shorter: {
    Glow: 0.285,
    YOffset: 0.1,
    Scale: 1.09,
  },
};

let _activeLineIndex = -1;
let _tyRafId = null;

// specs.swift: mass=1, stiffness=100, damping=18
const SPRING_W0 = 10;
const SPRING_ZETA = 0.9;
const SPRING_WD = SPRING_W0 * Math.sqrt(1 - SPRING_ZETA * SPRING_ZETA);

function springPos(t, start, end) {
  const decay = Math.exp(-SPRING_ZETA * SPRING_W0 * t);
  const cosTerm = Math.cos(SPRING_WD * t);
  const sinTerm = (SPRING_ZETA / Math.sqrt(1 - SPRING_ZETA * SPRING_ZETA)) * Math.sin(SPRING_WD * t);
  return end + (start - end) * decay * (cosTerm + sinTerm);
}

function setLineAnimTargets(arr, activeIndex) {
  if (activeIndex < 0) return;
  _activeLineIndex = activeIndex;

  const scrollContainer = document.querySelector('.LyricsContent');
  if (!scrollContainer) return;

  const activeEl = arr[activeIndex]?.HTMLElement;
  if (!activeEl) return;

  const containerHeight = scrollContainer.clientHeight;
  const lineHeight = activeEl.offsetHeight;

  const currentTyVal = parseFloat(getComputedStyle(activeEl).getPropertyValue('--ty')) || 0;
  const elementRect = activeEl.getBoundingClientRect();
  const containerRect = scrollContainer.getBoundingClientRect();
  const naturalLineTop = elementRect.top - containerRect.top - currentTyVal;

  const targetTyVal = (containerHeight * 0.28) - naturalLineTop;

  const lineTotal = lineHeight + 25;
  const visibleRange = Math.ceil(containerHeight / lineTotal) + 3;
  const firstVisible = Math.max(0, activeIndex - visibleRange);

  // Build per-line delays and set stagger/blur immediately (CSS transitions handle those)
  const delays = new Array(arr.length);
  let maxDelay = 0;
  for (let i = 0; i < arr.length; i++) {
    const line = arr[i];
    const el = line.HTMLElement;
    if (!el) continue;

    line._lineIndex = i;

    const distFromActive = Math.abs(i - activeIndex);
    const isVisible = distFromActive <= visibleRange;
    const delay = isVisible ? 0.10 + (i - firstVisible) * 0.05 : 0;
    delays[i] = delay;
    if (delay > maxDelay) maxDelay = delay;
    el.style.setProperty('--stagger-delay', `${delay}s`);

    const dist = i - activeIndex;
    el.style.setProperty('--blur-amount', isVisible ? `${dist === 0 ? 0 : Math.min(Math.abs(dist) * 2, 8)}px` : '0px');

    line._baseY = targetTyVal;
  }

  // specs.swift spring per line with stagger
  if (_tyRafId) cancelAnimationFrame(_tyRafId);

  const startTy = currentTyVal;
  const endTy = targetTyVal;
  const startTime = performance.now();

  // Only animate lines within the visible range + buffer for performance
  const updateStart = Math.max(0, firstVisible);
  const updateEnd = Math.min(arr.length, firstVisible + visibleRange * 2 + 5);

  function tick() {
    const elapsed = (performance.now() - startTime) / 1000;

    for (let i = updateStart; i < updateEnd; i++) {
      const el = arr[i]?.HTMLElement;
      if (!el) continue;
      const d = delays[i];
      if (d === undefined) continue;
      const lineT = elapsed - d;
      const ty = lineT <= 0 ? startTy : springPos(lineT, startTy, endTy);
      el.style.setProperty('--ty', `${ty}px`);
    }

    // Check if spring settled within 0.5px
    const slowestT = elapsed - maxDelay;
    if (elapsed > 10 || (slowestT > 0 && Math.abs(springPos(slowestT, startTy, endTy) - endTy) < 0.5)) {
      for (let i = 0; i < arr.length; i++) {
        const el = arr[i]?.HTMLElement;
        if (el) el.style.setProperty('--ty', `${endTy}px`);
      }
      _tyRafId = null;
      return;
    }

    _tyRafId = requestAnimationFrame(tick);
  }

  _tyRafId = requestAnimationFrame(tick);
}

function easeSinOut(x) {
  return Math.sin((x * Math.PI) / 2);
}

// ── Style Cache ──
let _styleCache = new WeakMap();
const _styleQueue = new Map();

function setStyleIfChanged(el, prop, value, epsilon = 0) {
  let map = _styleCache.get(el);
  if (!map) { map = new Map(); _styleCache.set(el, map); }
  const prev = map.get(prop);
  if (prev !== undefined) {
    const parseNum = (v) => {
      const n = parseFloat(v);
      return Number.isNaN(n) ? null : n;
    };
    const a = parseNum(prev);
    const b = parseNum(value);
    if (a !== null && b !== null) {
      if (Math.abs(a - b) <= epsilon) return;
    } else {
      if (prev === value) return;
    }
  }
  queueStyle(el, prop, value);
  map.set(prop, value);
}

function queueStyle(el, prop, value) {
  let props = _styleQueue.get(el);
  if (!props) {
    props = new Map();
    _styleQueue.set(el, props);
  }
  props.set(prop, value);
}

function flushStyleBatch() {
  if (_styleQueue.size === 0) return;
  for (const [el, props] of _styleQueue) {
    for (const [prop, value] of props) {
      el.style.setProperty(prop, value);
    }
  }
  _styleQueue.clear();
}

function promoteToGPU(el) {
  el.style.willChange = "transform, opacity, scale, filter";
  el.style.backfaceVisibility = "hidden";
}

function getElementState(currentTime, startTime, endTime) {
  if (currentTime < startTime) return "NotSung";
  if (currentTime > endTime) return "Sung";
  return "Active";
}

function getProgressPercentage(currentTime, startTime, endTime) {
  if (currentTime <= startTime) return 0;
  if (currentTime >= endTime) return 1;
  return (currentTime - startTime) / (endTime - startTime);
}

function createWordSprings() {
  return {
    Scale: new Spring(ScaleSpline.at(0), ScaleFrequency, ScaleDamping),
    YOffset: new Spring(YOffsetSpline.at(0), YOffsetFrequency, YOffsetDamping),
    Glow: new Spring(GlowSpline.at(0), GlowFrequency, GlowDamping),
  };
}

function createDotSprings() {
  return {
    Scale: new Spring(DotScaleSpline.at(0), DotAnimations.ScaleFrequency, DotAnimations.ScaleDamping),
    YOffset: new Spring(DotYOffsetSpline.at(0), DotAnimations.YOffsetFrequency, DotAnimations.YOffsetDamping),
    Glow: new Spring(DotGlowSpline.at(0), DotAnimations.GlowFrequency, DotAnimations.GlowDamping),
    Opacity: new Spring(DotOpacitySpline.at(0), DotAnimations.OpacityFrequency, DotAnimations.OpacityDamping),
  };
}

function createLetterSprings() {
  return {
    Scale: new Spring(ScaleSpline.at(0), ScaleFrequency, ScaleDamping),
    YOffset: new Spring(YOffsetSpline.at(0), YOffsetFrequency, YOffsetDamping),
    Glow: new Spring(GlowSpline.at(0), GlowFrequency, GlowDamping),
  };
}

let lastActiveLineIdx = null;
let blurringLastLine = null;
let lastFrameTime = performance.now();

function applyBlur(arr, activeIndex) {
  if (!arr[activeIndex]) return;
  const max = BlurMultiplier * 5 + BlurMultiplier * 0.465;

  const startIdx = Math.max(0, activeIndex - 15);
  const endIdx = Math.min(arr.length, activeIndex + 15);

  for (let i = startIdx; i < endIdx; i++) {
    const el = arr[i].HTMLElement;
    const distance = Math.abs(i - activeIndex);
    const blurAmount = distance === 0 ? 0 : Math.min(BlurMultiplier * distance, max);
    const value = distance === 0 ? "0px" : `${blurAmount.toFixed(2)}px`;
    setStyleIfChanged(el, "--BlurAmount", value);
  }
}


function cubicBezier(p1x, p1y, p2x, p2y) {
  const cx = 3 * p1x, bx = 3 * (p2x - p1x) - cx, ax = 1 - cx - bx;
  const cy = 3 * p1y, by = 3 * (p2y - p1y) - cy, ay = 1 - cy - by;
  function sampleX(t) { return ((ax * t + bx) * t + cx) * t; }
  function sampleY(t) { return ((ay * t + by) * t + cy) * t; }
  function dX(t) { return (3 * ax * t + 2 * bx) * t + cx; }
  function solve(x) {
    let t = x;
    for (let i = 0; i < 8; i++) {
      const x2 = sampleX(t) - x;
      if (Math.abs(x2) < 1e-7) return t;
      const d = dX(t);
      if (Math.abs(d) < 1e-7) break;
      t -= x2 / d;
    }
    let l = 0, r = 1, m = x;
    while (l < r) {
      const x2 = sampleX(m);
      if (Math.abs(x2 - x) < 1e-7) return m;
      if (x > x2) l = m; else r = m;
      m = (r - l) / 2 + l;
    }
    return m;
  }
  return (x) => sampleY(solve(x));
}
const _bezIn = cubicBezier(0.2, 0.4, 0.58, 1.0);
const _bezOut = cubicBezier(0.3, 0.0, 0.58, 1.0);
const _empEasing = (t) => t < 0.5 ? _bezIn(t / 0.5) : 1 - _bezOut((t - 0.5) / 0.5);
const _empAnims = [];

function getAMLProgress(key, position, startTime, endTime) {
  const duration = endTime - startTime;
  if (duration <= 0) return position >= startTime ? 1 : 0;
  return Math.max(0, Math.min(1, (position - startTime) / duration));
}

/**
 * Main animation function — called every frame.
 * @param {number} position - Current audio position in milliseconds
 * @param {string} lyricsType - "Syllable", "Line", or "Static"
 * @param {boolean} skip - If true, only update time delta and return
 */
export function animateLyrics(position, lyricsType, skip = false) {
  const now = performance.now();
  const deltaTime = (now - lastFrameTime) / 1000;
  lastFrameTime = now;

  if (skip || !lyricsType || lyricsType === "None" || lyricsType === "Static") return;

  if (lyricsType === "Syllable") {
    animateSyllable(position, deltaTime);
  } else if (lyricsType === "Line") {
    animateLine(position, deltaTime);
  }
}

function animateSyllable(position, deltaTime) {
  const arr = LyricsObject.Types.Syllable.Lines;
  if (!arr.length) return;

  // Pass 1: Update status classes for ALL lines
  let activeIdx = -1;
  for (let i = 0; i < arr.length; i++) {
    const line = arr[i];
    const status = line.Status || (position >= line.StartTime && position <= line.EndTime ? "Active" : (position > line.EndTime ? "Sung" : "NotSung"));
    if (status === "Active") activeIdx = i;
  }

  // Keep last active line active if no line is active during a gap
  if (activeIdx === -1 && lastActiveLineIdx !== -1 && lastActiveLineIdx !== null && lastActiveLineIdx !== undefined && lastActiveLineIdx < arr.length) {
    if (position >= arr[0].StartTime) {
      activeIdx = lastActiveLineIdx;
    }
  }

  // Update status classes using overridden activeIdx
  for (let i = 0; i < arr.length; i++) {
    const line = arr[i];
    let status = line.Status || (position >= line.StartTime && position <= line.EndTime ? "Active" : (position > line.EndTime ? "Sung" : "NotSung"));
    if (i === activeIdx) {
      status = "Active";
    }

    if (line._lastAppliedStatus !== status) {
      line.HTMLElement.classList.remove("Active", "Sung", "NotSung");
      line.HTMLElement.classList.add(status);
      line._lastAppliedStatus = status;
    }
  }

  // Pass 2: Heavy Animations (Windowed Optimization)
  const isSimpleMode = settingsManager.get("simpleLyricsMode");
  const isAML = settingsManager.get("amlAnimation");
  const isAML_lyrics = settingsManager.get("amlLyricsAnimations");

  // Advance scroll focus: at half-gap for gaps > 0.5s, or immediately on sung
  let scrollIdx = activeIdx;
  if ((isSimpleMode || isAML || isAML_lyrics) && activeIdx !== -1 && activeIdx + 1 < arr.length) {
    const curLineEnd = arr[activeIdx].EndTime;
    const nextLineStart = arr[activeIdx + 1].StartTime;
    const gap = nextLineStart - curLineEnd;
    if (gap > 0.5 && position > curLineEnd + gap * 0.5) {
      scrollIdx = activeIdx + 1;
    } else if (gap <= 0.5 && position > curLineEnd) {
      scrollIdx = activeIdx + 1;
    }
  }

  // Trigger staggered targets if scroll index changed
  if ((isSimpleMode || isAML || isAML_lyrics) && scrollIdx !== -1 && scrollIdx !== lastActiveLineIdx) {
    setLineAnimTargets(arr, scrollIdx);
    lastActiveLineIdx = scrollIdx;
  }

  const searchIdx = scrollIdx !== -1 ? scrollIdx : (lastActiveLineIdx || 0);
  const offsetSearch = _isMobile ? (isSimpleMode ? 6 : 3) : (isSimpleMode ? 10 : 5);
  const startIdx = Math.max(0, searchIdx - offsetSearch);
  const endIdx = Math.min(arr.length, searchIdx + offsetSearch + (_isMobile ? 3 : 5));

  // If user is scrolling, cancel any ongoing --ty stagger animation
  if (isUserScrolling()) {
    if (_tyRafId) { cancelAnimationFrame(_tyRafId); _tyRafId = null; }
    for (const line of arr) {
      const el = line.HTMLElement;
      if (el && el.style.getPropertyValue('--ty')) {
        el.style.removeProperty('--ty');
        el.style.removeProperty('--stagger-delay');
        el.style.removeProperty('--blur-amount');
        line._baseY = 0;
      }
    }
  }

  // BG line per-frame dynamic adjustment
  for (let index = 0; index < arr.length; index++) {
    const line = arr[index];
    if (line._lineIndex === undefined) continue;
    if (!line.BGLine) continue;
    const el = line.HTMLElement;
    if (!el) continue;

    const dist = index - _activeLineIndex;
    const isBgActive = (isAML || isAML_lyrics) && position >= line.StartTime && position <= line.EndTime;
    const baseY = dist * 25;
    if (isBgActive) {
      el.style.transform = `translate3d(0, ${baseY}px, 0) scale(1)`;
      el.style.opacity = '1';
    } else {
      el.style.transform = `translate3d(0, ${baseY - 18}px, 0) scale(0.98)`;
      el.style.opacity = '0';
    }
  }

  // Credits move with container scroll, no additional transform needed
  const lastLine = arr[arr.length - 1];
  if (lastLine) {
    const creditsEl = lastLine.HTMLElement.parentElement?.querySelector(".Credits");
    if (creditsEl) {
      creditsEl.style.removeProperty("transform");
    }
  }

  for (let index = startIdx; index < endIdx; index++) {
    const line = arr[index];

    const lineActive = position >= line.StartTime && position <= line.EndTime;
    const lineSung = position > line.EndTime;

    if ((line.IsConvertedLine || line.HTMLElement.parentElement?.classList.contains("is-converted-line")) && !line.DotLine) {
      if (line.Syllables?.Lead) {
        for (let wi = 0; wi < line.Syllables.Lead.length; wi++) {
          const word = line.Syllables.Lead[wi];
          if (lineActive) {
            setStyleIfChanged(word.HTMLElement, "--gradient-position", "100%");
            setStyleIfChanged(word.HTMLElement, "scale", "1");
            setStyleIfChanged(word.HTMLElement, "transform", "none");
            setStyleIfChanged(word.HTMLElement, "--text-shadow-opacity", "0%");
            setStyleIfChanged(word.HTMLElement, "opacity", "1");
          } else {
            setStyleIfChanged(word.HTMLElement, "--gradient-position", "-20%");
            setStyleIfChanged(word.HTMLElement, "scale", "0.95");
            setStyleIfChanged(word.HTMLElement, "transform", "translateY(calc(var(--DefaultLyricsSize) * 0.01))");
            setStyleIfChanged(word.HTMLElement, "--text-shadow-opacity", "0%");
            setStyleIfChanged(word.HTMLElement, "opacity", "1");
          }
        }
      }
      continue;
    }

    if (lineActive || lineSung || isAML_lyrics) {
      if (blurringLastLine !== index) {
        if (!isAML && !isAML_lyrics) applyBlur(arr, index);
        blurringLastLine = index;
      }
    }

    if (!line.Syllables?.Lead) continue;

    for (let wi = 0; wi < line.Syllables.Lead.length; wi++) {
      const word = line.Syllables.Lead[wi];
      const wordActive = position >= word.StartTime && position <= word.EndTime;
      const wordSung = position > word.EndTime;
      const isDot = word.Dot;

      if (isAML_lyrics) {
        const pct = getAMLProgress(word.HTMLElement, position, word.StartTime, word.EndTime);

        if (!word._fadeInfo) {
          const elW = word.HTMLElement.offsetWidth;
          word._fadeInfo = {
            w: Math.max(elW, 1),
            fs: parseFloat(getComputedStyle(word.HTMLElement).fontSize),
          };
        }
        const fadePct = ((word._fadeInfo.fs * 0.5) / word._fadeInfo.w) * 100;
        const targetGradientPos = -fadePct + (100 + fadePct) * pct;

        if (settingsManager.get("hardwareAccelerationHack") && !word._gpuPromoted) {
          promoteToGPU(word.HTMLElement);
          word._gpuPromoted = true;
        }

        if (!word._amlYSpring) {
          word._amlYSpring = new Spring(0, 0.596, 0.936);
          word._amlYSpring.SetGoal(0, true);
        }
        word._amlYSpring.SetGoal((wordActive || wordSung) ? -2 : 0);
        const yOffset = word._amlYSpring.Step(deltaTime);

        setStyleIfChanged(word.HTMLElement, "scale", "1");
        setStyleIfChanged(word.HTMLElement, "transform", `translate3d(0, ${yOffset.toFixed(2)}px, 0)`);
        setStyleIfChanged(word.HTMLElement, "--text-shadow-blur-radius", "0px");
        setStyleIfChanged(word.HTMLElement, "--text-shadow-opacity", "0%");

        setStyleIfChanged(word.HTMLElement, "--gradient-position", `${targetGradientPos.toFixed(2)}%`);
        setStyleIfChanged(word.HTMLElement, "--gradient-fade-width", `${fadePct.toFixed(2)}%`);

        if (word.Letters) {
          word.Letters.forEach(letter => {
            const letterPct = getAMLProgress(letter.HTMLElement, position, letter.StartTime, letter.EndTime);

            if (!letter._fadeInfo) {
              const lW = letter.HTMLElement.offsetWidth;
              letter._fadeInfo = {
                w: Math.max(lW, 1),
                fs: parseFloat(getComputedStyle(letter.HTMLElement).fontSize),
              };
            }
            const lFadePct = ((letter._fadeInfo.fs * 0.5) / letter._fadeInfo.w) * 100;
            const letterGradientPos = -lFadePct + (100 + lFadePct) * letterPct;
            const letterActive = position >= letter.StartTime && position <= letter.EndTime;
            const letterSung = position > letter.EndTime;

            if (settingsManager.get("hardwareAccelerationHack") && !letter._gpuPromoted) {
              promoteToGPU(letter.HTMLElement);
              letter._gpuPromoted = true;
            }

            if (!letter._amlYSpring) {
              letter._amlYSpring = new Spring(0, 0.596, 0.936);
              letter._amlYSpring.SetGoal(0, true);
            }
            letter._amlYSpring.SetGoal((letterActive || letterSung) ? -2 : 0);
            const letterY = letter._amlYSpring.Step(deltaTime);

            setStyleIfChanged(letter.HTMLElement, "scale", "1");
            setStyleIfChanged(letter.HTMLElement, "transform", `translate3d(0, ${letterY.toFixed(2)}px, 0)`);
            setStyleIfChanged(letter.HTMLElement, "--text-shadow-blur-radius", "0px");
            setStyleIfChanged(letter.HTMLElement, "--text-shadow-opacity", "0%");

            setStyleIfChanged(letter.HTMLElement, "--gradient-position", `${letterGradientPos.toFixed(2)}%`);
            setStyleIfChanged(letter.HTMLElement, "--gradient-fade-width", `${lFadePct.toFixed(2)}%`);
          });
        }

        if (word.Emphasis && word.Letters) {
          if (!word._empInit) {
            word._empInit = true;
            const wordDur = Math.max(1000, word.EndTime - word.StartTime);
            let amount = wordDur / 2000;
            amount = (amount > 1 ? Math.sqrt(amount) : amount ** 3) * 0.6;
            amount = Math.min(1.2, amount);
            let blur = wordDur / 3000;
            blur = (blur > 1 ? Math.sqrt(blur) : blur ** 3) * 0.5;
            blur = Math.min(0.8, blur);
            const isLastWord = wi === line.Syllables.Lead.length - 1;
            if (isLastWord) {
              amount = Math.min(1.2, amount * 1.6);
              blur = Math.min(0.8, blur * 1.5);
            }
            const anchorCount = Math.max(1, word.Letters.length);

            word.Letters.forEach((letter, li) => {
              if (!letter.Emphasis) return;
              const de = Math.max(0, letter.StartTime - word.StartTime);
              const du = Math.max(1000, letter.EndTime - letter.StartTime);
              const delay = de + (du / 2.5 / anchorCount) * li;

              const frames = [];
              for (let j = 0; j < 32; j++) {
                const x = (j + 1) / 32;
                const ef = _empEasing(x);
                const offX = -ef * 0.03 * amount * (word.Letters.length / 2 - li);
                const offY = -ef * 0.025 * amount;
                frames.push({
                  offset: x,
                  transform: `scale(${1 + ef * 0.1 * amount}) translate(${offX}em, ${offY}em)`,
                  textShadow: `0 0 ${Math.min(0.3, blur * 0.3)}em rgba(255,255,255,${ef * blur})`,
                });
              }

              const anim = letter.HTMLElement.animate(frames, {
                duration: wordDur,
                delay,
                fill: "both",
                composite: "add",
              });
              anim.pause();
              _empAnims.push(anim);
              letter._empAnim = anim;
            });
          }

          word.Letters.forEach(letter => {
            if (letter._empAnim) {
              const t = Math.max(0, position - word.StartTime);
              letter._empAnim.currentTime = t;
              if (t > 0 && t < word.EndTime - word.StartTime) letter._empAnim.play();
              else letter._empAnim.pause();
            }
          });
        }

        continue;
      }

      if (isDot) {
        // very spicy dot
        if (!word.AnimatorStore) {
          word.AnimatorStore = createDotSprings();
          word.AnimatorStore.Scale.SetGoal(DotScaleSpline.at(0), true);
          word.AnimatorStore.YOffset.SetGoal(DotYOffsetSpline.at(0), true);
          word.AnimatorStore.Glow.SetGoal(DotGlowSpline.at(0), true);
          word.AnimatorStore.Opacity.SetGoal(DotOpacitySpline.at(0), true);
          promoteToGPU(word.HTMLElement);
        }

        const pct = getProgressPercentage(position, word.StartTime, word.EndTime);
        let targetScale, targetYOffset, targetGlow, targetOpacity;

        if (wordActive) {
          targetScale = DotScaleSpline.at(pct);
          targetYOffset = DotYOffsetSpline.at(pct);
          targetGlow = DotGlowSpline.at(pct);
          targetOpacity = DotOpacitySpline.at(pct);
        } else if (wordSung) {
          targetScale = DotScaleSpline.at(1);
          targetYOffset = DotYOffsetSpline.at(1);
          targetGlow = DotGlowSpline.at(1);
          targetOpacity = DotOpacitySpline.at(1);
        } else {
          targetScale = DotScaleSpline.at(0);
          targetYOffset = DotYOffsetSpline.at(0);
          targetGlow = DotGlowSpline.at(0);
          targetOpacity = DotOpacitySpline.at(0);
        }

        word.AnimatorStore.Scale.SetGoal(targetScale);
        word.AnimatorStore.YOffset.SetGoal(targetYOffset);
        word.AnimatorStore.Glow.SetGoal(targetGlow);
        word.AnimatorStore.Opacity.SetGoal(targetOpacity);

        const curScale = word.AnimatorStore.Scale.Step(deltaTime);
        const curYOffset = word.AnimatorStore.YOffset.Step(deltaTime);
        const curGlow = word.AnimatorStore.Glow.Step(deltaTime);
        const curOpacity = word.AnimatorStore.Opacity.Step(deltaTime);

        setStyleIfChanged(
          word.HTMLElement,
          "transform",
          `translate3d(0, calc(var(--DefaultLyricsSize) * ${curYOffset ?? 0}), 0)`,
          0.001
        );
        setStyleIfChanged(word.HTMLElement, "scale", `${curScale}`, 0.001);
        setStyleIfChanged(word.HTMLElement, "opacity", `${curOpacity}`, 0.001);
        setStyleIfChanged(
          word.HTMLElement,
          "--text-shadow-blur-radius",
          `${(3.2 + 4.8 * curGlow).toFixed(2)}px`,
          0.5
        );
        setStyleIfChanged(
          word.HTMLElement,
          "--text-shadow-opacity",
          `${(curGlow * 16).toFixed(2)}%`,
          1
        );
        continue;
      }

      if (isSimpleMode) {
        if (wordActive) {
          // Subtle glow focus for simple mode
          setStyleIfChanged(word.HTMLElement, "text-shadow", "0 0 10px color-mix(in srgb, rgba(var(--ArtworkGlowColor, 255, 255, 255), 0.264) 40%, rgba(255,255,255,0.264))", 0.1);
          setStyleIfChanged(word.HTMLElement, "opacity", "1", 0.01);
        } else {
          setStyleIfChanged(word.HTMLElement, "text-shadow", "none");
          setStyleIfChanged(word.HTMLElement, "opacity", "0.5", 0.01);
        }

        if (word.LetterGroup && word.Letters) {
          word.Letters.forEach((letter, k) => {
            const letterState = getElementState(position, letter.StartTime, letter.EndTime);
            if (letterState === "Active") {
              setStyleIfChanged(letter.HTMLElement, "text-shadow", "0 0 8px color-mix(in srgb, rgba(var(--ArtworkGlowColor, 255, 255, 255), 0.264) 40%, rgba(255,255,255,0.264))", 0.1);
              setStyleIfChanged(letter.HTMLElement, "opacity", "1", 0.01);
            } else {
              setStyleIfChanged(letter.HTMLElement, "text-shadow", "none");
              setStyleIfChanged(letter.HTMLElement, "opacity", "0.5", 0.01);
            }
          });
        }
        continue;
      }

      const isScrolling = isUserScrolling();

      if (!word.AnimatorStore) {
        word.AnimatorStore = createWordSprings();
        word.AnimatorStore.Scale.SetGoal(ScaleSpline.at(0), true);
        word.AnimatorStore.YOffset.SetGoal(YOffsetSpline.at(0), true);
        word.AnimatorStore.Glow.SetGoal(GlowSpline.at(0), true);
        promoteToGPU(word.HTMLElement);
      }

      const pct = getProgressPercentage(position, word.StartTime, word.EndTime);
      let targetScale, targetYOffset, targetGlow, targetGradientPos;

      if (wordActive) {
        targetScale = ScaleSpline.at(pct);
        targetYOffset = isScrolling ? 0 : YOffsetSpline.at(pct);
        targetGlow = GlowSpline.at(pct);
        targetGradientPos = -20 + 120 * pct;

        if (isAML) {
          targetYOffset *= 1.5;
        }
      } else if (wordSung) {
        targetScale = ScaleSpline.at(1);
        targetYOffset = isScrolling ? 0 : YOffsetSpline.at(1);
        targetGlow = GlowSpline.at(1);
        targetGradientPos = 100;
      } else {
        targetScale = ScaleSpline.at(0);
        targetYOffset = isScrolling ? 0 : YOffsetSpline.at(0);
        targetGlow = GlowSpline.at(0);
        targetGradientPos = -20;
      }

      if (word.Emphasis) {
        targetScale *= 1.1;
        targetYOffset *= 2.5;
      }

      word.AnimatorStore.Scale.SetGoal(targetScale);
      word.AnimatorStore.YOffset.SetGoal(targetYOffset);
      word.AnimatorStore.Glow.SetGoal(targetGlow);

      const curScale = word.AnimatorStore.Scale.Step(deltaTime);
      const curYOffset = word.AnimatorStore.YOffset.Step(deltaTime);
      const curGlow = word.AnimatorStore.Glow.Step(deltaTime);

      setStyleIfChanged(word.HTMLElement, "scale", `${curScale.toFixed(4)}`);
      setStyleIfChanged(word.HTMLElement, "transform",
        `translate3d(0, calc(var(--DefaultLyricsSize) * ${curYOffset.toFixed(4)}), 0)`);

      if (!word.LetterGroup) {
        setStyleIfChanged(word.HTMLElement, "--gradient-position", `${targetGradientPos.toFixed(2)}%`);
        setStyleIfChanged(word.HTMLElement, "--text-shadow-blur-radius",
          `${(4.8 + 2.4 * curGlow).toFixed(2)}px`);
        setStyleIfChanged(word.HTMLElement, "--text-shadow-opacity",
          `${(curGlow * LetterGlowMultiplier_Opacity * 0.32).toFixed(2)}%`);
      }

      if (word.LetterGroup && word.Letters) {
        let activeLetterIndex = -1;
        let activeLetterPercentage = 0;

        for (let i = 0; i < word.Letters.length; i++) {
          if (getElementState(position, word.Letters[i].StartTime, word.Letters[i].EndTime) === "Active") {
            activeLetterIndex = i;
            activeLetterPercentage = getProgressPercentage(position, word.Letters[i].StartTime, word.Letters[i].EndTime);
            break;
          }
        }

        const strength = (word.EndTime - word.StartTime) > SimpleLyricsMode_LetterEffectsStrengthConfig.LongerThan
          ? SimpleLyricsMode_LetterEffectsStrengthConfig.Longer
          : SimpleLyricsMode_LetterEffectsStrengthConfig.Shorter;

        word.Letters.forEach((letter, k) => {
          if (!letter.AnimatorStore) {
            letter.AnimatorStore = createLetterSprings();
            letter.AnimatorStore.Scale.SetGoal(ScaleSpline.at(0), true);
            letter.AnimatorStore.YOffset.SetGoal(YOffsetSpline.at(0), true);
            letter.AnimatorStore.Glow.SetGoal(GlowSpline.at(0), true);
            promoteToGPU(letter.HTMLElement);
          }

          const lstate = getElementState(position, letter.StartTime, letter.EndTime);

          let falloffY = 0;
          let falloffGlow = 0;
          if (activeLetterIndex !== -1) {
            const distance = Math.abs(k - activeLetterIndex);
            falloffY = Math.max(0, 1 / (1 + distance * 0.9));
            falloffGlow = Math.max(0, 1 / (1 + distance * 0.5));
          }

          const basePct = activeLetterIndex !== -1 ? activeLetterPercentage : (lstate === "Sung" ? 1 : 0);
          let baseScale = ScaleSpline.at(basePct) * (isSimpleMode ? strength.Scale : 1);
          let baseYOffset = YOffsetSpline.at(basePct) * (isSimpleMode ? strength.YOffset : 1);
          let baseGlow = GlowSpline.at(basePct) * (isSimpleMode ? strength.Glow : 1);

          if (isAML) {
            baseYOffset *= 1.5;
          }

          if (letter.Emphasis) {
            baseScale *= 1.1;
            baseYOffset *= 1.5;
          }

          const restingScale = ScaleSpline.at(0);
          const restingYOffset = YOffsetSpline.at(0);
          const restingGlow = GlowSpline.at(0);

          let ts = restingScale + (baseScale - restingScale) * falloffY;
          // Make non-active letters in the playing word a bit smaller
          if (activeLetterIndex !== -1 && k !== activeLetterIndex) {
            ts *= 0.92;
          }
          let ty = restingYOffset + (baseYOffset - restingYOffset) * falloffY;
          let tg = restingGlow + (baseGlow - restingGlow) * falloffGlow;

          if (isScrolling) ty = 0;

          let tgp = -20;
          if (lstate === "Sung") {
            tgp = 100;
          } else if (lstate === "Active") {
            tgp = -20 + 120 * easeSinOut(activeLetterPercentage);
          }

          letter.AnimatorStore.Scale.SetGoal(ts);
          letter.AnimatorStore.YOffset.SetGoal(ty);
          letter.AnimatorStore.Glow.SetGoal(tg);

          const cs = letter.AnimatorStore.Scale.Step(deltaTime);
          const cy = letter.AnimatorStore.YOffset.Step(deltaTime);
          const cg = letter.AnimatorStore.Glow.Step(deltaTime);

          setStyleIfChanged(letter.HTMLElement, "scale", `${cs.toFixed(4)}`);
          setStyleIfChanged(letter.HTMLElement, "transform",
            `translate3d(0, calc(var(--DefaultLyricsSize) * ${(cy * 2.5).toFixed(4)}), 0)`);



          setStyleIfChanged(letter.HTMLElement, "--gradient-position", `${tgp.toFixed(2)}%`);

          setStyleIfChanged(letter.HTMLElement, "--text-shadow-blur-radius",
            `${(3.2 + 16 * cg).toFixed(2)}px`);
          setStyleIfChanged(letter.HTMLElement, "--text-shadow-opacity",
            `${(cg * LetterGlowMultiplier_Opacity * 0.8).toFixed(2)}%`);
        });
      }
    }
  }
  flushStyleBatch();
}

function animateLine(position, deltaTime) {
  const arr = LyricsObject.Types.Line.Lines;
  if (!arr.length) return;

  const isSimpleMode = settingsManager.get("simpleLyricsMode");
  const isAML = settingsManager.get("amlAnimation");
  let activeIdx = -1;
  for (let i = 0; i < arr.length; i++) {
    const line = arr[i];
    const isAct = position >= line.StartTime && position <= line.EndTime;
    if (isAct) activeIdx = i;
  }

  // Keep last active line active if no line is active during a gap
  if (activeIdx === -1 && lastActiveLineIdx !== -1 && lastActiveLineIdx !== null && lastActiveLineIdx !== undefined && lastActiveLineIdx < arr.length) {
    if (position >= arr[0].StartTime) {
      activeIdx = lastActiveLineIdx;
    }
  }

  // Update status classes using overridden activeIdx
  for (let i = 0; i < arr.length; i++) {
    const line = arr[i];
    const isAct = i === activeIdx;
    const isSung = position > line.EndTime && i !== activeIdx;
    const status = isAct ? "Active" : (isSung ? "Sung" : "NotSung");

    if (line._lastAppliedStatus !== status) {
      line.HTMLElement.classList.remove("Active", "Sung", "NotSung");
      line.HTMLElement.classList.add(status);
      line._lastAppliedStatus = status;
    }
  }

  // Advance scroll focus: at half-gap for gaps > 0.5s, or immediately on sung
  let scrollIdx = activeIdx;
  if ((isSimpleMode || isAML) && activeIdx !== -1 && activeIdx + 1 < arr.length) {
    const curLineEnd = arr[activeIdx].EndTime;
    const nextLineStart = arr[activeIdx + 1].StartTime;
    const gap = nextLineStart - curLineEnd;
    if (gap > 0.5 && position > curLineEnd + gap * 0.5) {
      scrollIdx = activeIdx + 1;
    } else if (gap <= 0.5 && position > curLineEnd) {
      scrollIdx = activeIdx + 1;
    }
  }

  // Trigger staggered targets if scroll index changed
  if ((isSimpleMode || isAML) && scrollIdx !== -1 && scrollIdx !== lastActiveLineIdx) {
    setLineAnimTargets(arr, scrollIdx);
    lastActiveLineIdx = scrollIdx;
  }

  const searchIdx = scrollIdx !== -1 ? scrollIdx : (lastActiveLineIdx || 0);
  const offsetSearch = _isMobile ? (isSimpleMode ? 6 : 3) : (isSimpleMode ? 10 : 5);
  const startIdx = Math.max(0, searchIdx - offsetSearch);
  const endIdx = Math.min(arr.length, searchIdx + offsetSearch + (_isMobile ? 3 : 5));

  // Credits move with container scroll, no additional transform needed
  const lastLine = arr[arr.length - 1];
  if (lastLine) {
    const creditsEl = lastLine.HTMLElement.parentElement?.querySelector(".Credits");
    if (creditsEl) {
      creditsEl.style.removeProperty("transform");
    }
  }

  // If user is scrolling, cancel any ongoing --ty stagger animation
  if (isUserScrolling()) {
    if (_tyRafId) { cancelAnimationFrame(_tyRafId); _tyRafId = null; }
    for (const line of arr) {
      const el = line.HTMLElement;
      if (el && el.style.getPropertyValue('--ty')) {
        el.style.removeProperty('--ty');
        el.style.removeProperty('--stagger-delay');
        el.style.removeProperty('--blur-amount');
        line._baseY = 0;
      }
    }
  }

  for (let index = startIdx; index < endIdx; index++) {
    const line = arr[index];

    const lineActive = position >= line.StartTime && position <= line.EndTime;
    const lineSung = position > line.EndTime;

    if (lineActive) {
      if (blurringLastLine !== index) {
        if (!isAML) applyBlur(arr, index);
        blurringLastLine = index;
      }

      line.HTMLElement.classList.add("Active");
      line.HTMLElement.classList.remove("NotSung", "Sung");
    }

    const wordEl = line.HTMLElement.querySelector('.word');

    if (wordEl) {
      if (lineActive) {
        const pct = isAML ? getAMLProgress(line.HTMLElement, position, line.StartTime, line.EndTime) : getProgressPercentage(position, line.StartTime, line.EndTime);
        const gradientPos = -20 + 120 * pct;
        if (isSimpleMode) {
          setStyleIfChanged(wordEl, "text-shadow", "0 0 10px color-mix(in srgb, rgba(var(--ArtworkGlowColor, 255, 255, 255), 0.264) 40%, rgba(255,255,255,0.264))", 0.1);
          setStyleIfChanged(wordEl, "opacity", "1", 0.01);
        } else {
          setStyleIfChanged(wordEl, "--gradient-position", `${gradientPos.toFixed(2)}%`);
          if (wordEl.style.textShadow) {
            wordEl.style.removeProperty("text-shadow");
          }
        }
      } else if (lineSung) {
        if (isSimpleMode) {
          setStyleIfChanged(wordEl, "text-shadow", "none");
          setStyleIfChanged(wordEl, "opacity", "0.5", 0.01);
        } else {
          setStyleIfChanged(wordEl, "--gradient-position", "100%");
          if (wordEl.style.textShadow) {
            wordEl.style.removeProperty("text-shadow");
          }
        }
      } else {
        if (isSimpleMode) {
          setStyleIfChanged(wordEl, "text-shadow", "none");
          setStyleIfChanged(wordEl, "opacity", "0.5", 0.01);
        } else {
          setStyleIfChanged(wordEl, "--gradient-position", "-20%");
          if (wordEl.style.textShadow) {
            wordEl.style.removeProperty("text-shadow");
          }
        }
      }
    }

    // dot animation
    if (line.DotLine && line.Syllables?.Lead) {
      for (let i = 0; i < line.Syllables.Lead.length; i++) {
        const dot = line.Syllables.Lead[i];

        if (!dot.AnimatorStore) {
          dot.AnimatorStore = createDotSprings();
          dot.AnimatorStore.Scale.SetGoal(DotScaleSpline.at(0), true);
          dot.AnimatorStore.YOffset.SetGoal(DotYOffsetSpline.at(0), true);
          dot.AnimatorStore.Glow.SetGoal(DotGlowSpline.at(0), true);
          dot.AnimatorStore.Opacity.SetGoal(DotOpacitySpline.at(0), true);
          promoteToGPU(dot.HTMLElement);
        }

        const dotState = getElementState(position, dot.StartTime, dot.EndTime);
        const dotPercentage = getProgressPercentage(position, dot.StartTime, dot.EndTime);

        let targetScale, targetYOffset, targetGlow, targetOpacity;

        if (dotState === "Active") {
          targetScale = DotScaleSpline.at(dotPercentage);
          targetYOffset = DotYOffsetSpline.at(dotPercentage);
          targetGlow = DotGlowSpline.at(dotPercentage);
          targetOpacity = DotOpacitySpline.at(dotPercentage);
        } else if (dotState === "NotSung") {
          targetScale = DotScaleSpline.at(0);
          targetYOffset = DotYOffsetSpline.at(0);
          targetGlow = DotGlowSpline.at(0);
          targetOpacity = DotOpacitySpline.at(0);
        } else {
          // Sung
          targetScale = DotScaleSpline.at(1);
          targetYOffset = DotYOffsetSpline.at(1);
          targetGlow = DotGlowSpline.at(1);
          targetOpacity = DotOpacitySpline.at(1);
        }

        dot.AnimatorStore.Scale.SetGoal(targetScale);
        dot.AnimatorStore.YOffset.SetGoal(targetYOffset);
        dot.AnimatorStore.Glow.SetGoal(targetGlow);
        dot.AnimatorStore.Opacity.SetGoal(targetOpacity);

        const currentScale = dot.AnimatorStore.Scale.Step(deltaTime);
        const currentYOffset = dot.AnimatorStore.YOffset.Step(deltaTime);
        const currentGlow = dot.AnimatorStore.Glow.Step(deltaTime);
        const currentOpacity = dot.AnimatorStore.Opacity.Step(deltaTime);

        setStyleIfChanged(
          dot.HTMLElement,
          "transform",
          `translate3d(0, calc(var(--DefaultLyricsSize) * ${currentYOffset ?? 0}), 0)`,
          0.001
        );
        setStyleIfChanged(dot.HTMLElement, "scale", `${currentScale}`, 0.001);
        setStyleIfChanged(dot.HTMLElement, "opacity", `${currentOpacity}`, 0.001);
        setStyleIfChanged(
          dot.HTMLElement,
          "--text-shadow-blur-radius",
          `${(3.2 + 4.8 * currentGlow).toFixed(2)}px`,
          0.5
        );
        setStyleIfChanged(
          dot.HTMLElement,
          "--text-shadow-opacity",
          `${(currentGlow * 16).toFixed(2)}%`,
          1
        );
      }
    }
  }
  flushStyleBatch();
}

/**
 * Reset animator state (call when loading new lyrics).
 */
export function resetAnimator() {
  lastActiveLineIdx = null;
  blurringLastLine = null;
  lastFrameTime = performance.now();
  _styleCache = new WeakMap();
  if (_tyRafId) { cancelAnimationFrame(_tyRafId); _tyRafId = null; }
  _empAnims.forEach(a => a.cancel());
  _empAnims.length = 0;
}