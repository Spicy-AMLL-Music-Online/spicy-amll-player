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

class SimpleSpring { // i stole that shit from my own lyrics renderer because.. ehhhh   - nurislamaibekuly
  constructor(position, tension = 70, damping = 13) {
    this.position = position;
    this.velocity = 0;
    this.target = position;
    this.tension = tension;
    this.damping = damping;
  }

  SetGoal(target) {
    this.target = target;
  }

  Step(dt) {
    const safeDt = Math.min(dt, 0.064);
    const displacement = this.position - this.target;
    const acceleration = -this.tension * displacement - this.damping * this.velocity;
    this.velocity += acceleration * safeDt;
    this.position += this.velocity * safeDt;
    return this.position;
  }
}

function createLineSprings() {
  return {
    Y: new SimpleSpring(0, 70, 10),
    Opacity: new SimpleSpring(1, 70, 10),
    Blur: new SimpleSpring(0, 70, 10),
  };
}

function updateStaggeredTargets(arr, activeIndex, previousActiveIndex) { // hellooo staggered fucks :3
  if (activeIndex < 0) return;

  const groupIndices = [];
  let currentGroup = 0;
  for (let i = 0; i < arr.length; i++) {
    if (i > 0 && !arr[i].BGLine) {
      currentGroup++;
    }
    groupIndices[i] = currentGroup;
  }

  const activeGroup = groupIndices[activeIndex];
  const prevGroup = (previousActiveIndex !== null && previousActiveIndex !== undefined && previousActiveIndex >= 0)
    ? groupIndices[previousActiveIndex] : null;

  for (let i = 0; i < arr.length; i++) {
    const line = arr[i];
    const dist = groupIndices[i] - activeGroup;

    if (!line.AnimatorStoreLine) {
      line.AnimatorStoreLine = createLineSprings();
      line.AnimatorStoreLine.Y.position = dist * 23;
      line.AnimatorStoreLine.Opacity.position = dist === 0 ? 1 : 0.3;

      const initialBlurVal = dist === 0 ? 0 : Math.min(Math.abs(dist) * 2, 8);
      line.AnimatorStoreLine.Blur.normalGoal = initialBlurVal;

      const curScroll = isUserScrolling();
      line.AnimatorStoreLine.Blur.position = curScroll ? 0 : (dist === 0 ? 0 : 4);
      line.AnimatorStoreLine.Blur.target = curScroll ? 0 : initialBlurVal;
    }

    line.AnimatorStoreLine.baseY = dist * 23;
    line.AnimatorStoreLine.baseOpacity = dist === 0 ? 1 : 0.35;

    // Check if this line was the previously active line
    const wasPreviouslyActive = prevGroup !== null && groupIndices[i] === prevGroup && dist !== 0;

    const step = dist + 1;
    const delay = Math.max(0, step) * 80;

    const applyTargets = () => {
      if (!line.AnimatorStoreLine) return;

      line.AnimatorStoreLine.baseY = dist * 23;
      line.AnimatorStoreLine.Y.SetGoal(dist * 23);

      if (wasPreviouslyActive) {
        // Hold at full white opacity and no blur for 300ms before fading/blurring out
        line.AnimatorStoreLine.baseOpacity = 1;
        line.AnimatorStoreLine.Opacity.SetGoal(1);
        line.AnimatorStoreLine.Blur.SetGoal(0);
        if (line._opacityHoldTimeout) {
          clearTimeout(line._opacityHoldTimeout);
        }
        line._opacityHoldTimeout = setTimeout(() => {
          if (line.AnimatorStoreLine) {
            line.AnimatorStoreLine.baseOpacity = 0.35;
            if (!((isAML || isAML_lyrics) && line.BGLine)) {
              line.AnimatorStoreLine.Opacity.SetGoal(0.35);
              const finalBlur = dist === 0 ? 0 : Math.min(Math.abs(dist) * 2, 8);
              line.AnimatorStoreLine.Blur.SetGoal(isUserScrolling() ? 0 : finalBlur);
            }
          }
          line._opacityHoldTimeout = null;
        }, 300);
      } else {
        // Clear any lingering hold timeout
        if (line._opacityHoldTimeout) {
          clearTimeout(line._opacityHoldTimeout);
          line._opacityHoldTimeout = null;
        }
        const targetOp = dist === 0 ? 1 : 0.35;
        line.AnimatorStoreLine.baseOpacity = targetOp;
        line.AnimatorStoreLine.Opacity.SetGoal(targetOp);
      }

      if (!wasPreviouslyActive) {
        const blurVal = dist === 0 ? 0 : Math.min(Math.abs(dist) * 2, 8);
        line.AnimatorStoreLine.Blur.normalGoal = blurVal;
        line.AnimatorStoreLine.Blur.SetGoal(isUserScrolling() ? 0 : blurVal);
      }
    };

    if (line._staggerTimeout) {
      clearTimeout(line._staggerTimeout);
      line._staggerTimeout = null;
    }

    if (Math.abs(dist) > 10 || delay === 0) {
      applyTargets();
    } else {
      line._staggerTimeout = setTimeout(applyTargets, delay);
    }
  }
} // pls don't fire me yxqo

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

  // Trigger staggered targets if active index changed (Simple Mode OR AML OR )
  if ((isSimpleMode || isAML || isAML_lyrics) && activeIdx !== -1 && activeIdx !== lastActiveLineIdx) {
    updateStaggeredTargets(arr, activeIdx, lastActiveLineIdx);
    lastActiveLineIdx = activeIdx;
  }

  const searchIdx = activeIdx !== -1 ? activeIdx : (lastActiveLineIdx || 0);
  const offsetSearch = _isMobile ? (isSimpleMode ? 6 : 3) : (isSimpleMode ? 10 : 5);
  const startIdx = Math.max(0, searchIdx - offsetSearch);
  const endIdx = Math.min(arr.length, searchIdx + offsetSearch + (_isMobile ? 3 : 5));

  // First step all line-level staggered animations (with snapping for lines outside window)
  if (isSimpleMode || isAML || isAML_lyrics) {
    const isScrolling = isUserScrolling();
    for (let index = 0; index < arr.length; index++) {
      const line = arr[index];
      if (line.AnimatorStoreLine) {
        let curY, curOp, curBlur;
        if (line.AnimatorStoreLine.Blur.normalGoal !== undefined) {
          line.AnimatorStoreLine.Blur.SetGoal(isScrolling ? 0 : line.AnimatorStoreLine.Blur.normalGoal);
        }

        // Dynamically adjust BGLine targets in AML mode
        if ((isAML || isAML_lyrics) && line.BGLine) {
          const isBgActive = position >= line.StartTime && position <= line.EndTime;
          const baseY = line.AnimatorStoreLine.baseY !== undefined ? line.AnimatorStoreLine.baseY : (line.AnimatorStoreLine.Y.target);
          if (isBgActive) {
            line.AnimatorStoreLine.Y.SetGoal(baseY);
            line.AnimatorStoreLine.Opacity.SetGoal(1);
          } else {
            // Always faded out and up behind the main line
            line.AnimatorStoreLine.Y.SetGoal(baseY - 18);
            line.AnimatorStoreLine.Opacity.SetGoal(0);
          }
        }

        if (index >= startIdx && index < endIdx) {
          curY = line.AnimatorStoreLine.Y.Step(deltaTime);
          curOp = line.AnimatorStoreLine.Opacity.Step(deltaTime);
          curBlur = line.AnimatorStoreLine.Blur.Step(deltaTime);
          line.Snapped = false;
        } else {
          if (line.Snapped) {
            continue;
          }
          // Snap instantly if outside active window to prevent stacking
          curY = line.AnimatorStoreLine.Y.target;
          line.AnimatorStoreLine.Y.position = curY;
          line.AnimatorStoreLine.Y.velocity = 0;

          curOp = line.AnimatorStoreLine.Opacity.target;
          line.AnimatorStoreLine.Opacity.position = curOp;
          line.AnimatorStoreLine.Opacity.velocity = 0;

          curBlur = line.AnimatorStoreLine.Blur.target;
          line.AnimatorStoreLine.Blur.position = curBlur;
          line.AnimatorStoreLine.Blur.velocity = 0;
          line.Snapped = true;
        }

        setStyleIfChanged(line.HTMLElement, "transform", `translate3d(0, ${curY.toFixed(2)}px, 0)`);
        setStyleIfChanged(line.HTMLElement, "opacity", curOp.toFixed(3));
        // Skip filter update if blur is negligible (avoids expensive recomposite)
        if (curBlur > 0.1) {
          setStyleIfChanged(line.HTMLElement, "filter", `blur(${curBlur.toFixed(1)}px)`);
        } else {
          setStyleIfChanged(line.HTMLElement, "filter", 'none');
        }
      }
    }
  }

  // Sync credits translation with the last line's translation to prevent overlap
  const lastLine = arr[arr.length - 1];
  if (lastLine) {
    const creditsEl = lastLine.HTMLElement.parentElement?.querySelector(".Credits");
    if (creditsEl) {
      if ((isSimpleMode || isAML || isAML_lyrics) && lastLine.AnimatorStoreLine) {
        const curY = lastLine.AnimatorStoreLine.Y.position;
        setStyleIfChanged(creditsEl, "transform", `translate3d(0, ${curY.toFixed(2)}px, 0)`);
      } else {
        creditsEl.style.removeProperty("transform");
      }
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
        const pct = getProgressPercentage(position, word.StartTime, word.EndTime);
        const targetGradientPos = -20 + 120 * pct;

        // Smooth ease factor: ramps to 1 over ~40% of progress for a gentler rise
        const easeUpFactor = easeSinOut(Math.min(1, pct * 2.5));

        if (word.Emphasis) {
          // Emphasis: zoom 1.0 → 1.62 (peak) → 1.2 (rest), glow slightly below normal emphasis
          const bellCurve = Math.sin(pct * Math.PI);
          let zoomScale, glowAmount;
          if (wordActive) {
            // Linear ramp 1.0→1.2 + bell overshoot peaking at 1.62
            zoomScale = 1.0 + 0.2 * pct + 0.52 * bellCurve;
            glowAmount = bellCurve * 0.28;
          } else if (wordSung) {
            zoomScale = 1.2;
            glowAmount = 0;
          } else {
            zoomScale = 1;
            glowAmount = 0;
          }
          const yOffset = wordActive ? -3 * easeUpFactor : (wordSung ? -3 : 0);

          setStyleIfChanged(word.HTMLElement, "scale", `${zoomScale.toFixed(4)}`);
          setStyleIfChanged(word.HTMLElement, "transform", `translate3d(0, ${yOffset.toFixed(2)}px, 0)`);
          setStyleIfChanged(word.HTMLElement, "--text-shadow-blur-radius", `${(4 + 4 * glowAmount).toFixed(2)}px`);
          setStyleIfChanged(word.HTMLElement, "--text-shadow-opacity", `${(glowAmount * 35).toFixed(2)}%`);
        } else {
          // Normal: clean ease up by 3px, stays up when sung, no scale change, no glow
          const yOffset = wordActive ? -3 * easeUpFactor : (wordSung ? -3 : 0);

          setStyleIfChanged(word.HTMLElement, "scale", "1");
          setStyleIfChanged(word.HTMLElement, "transform", `translate3d(0, ${yOffset.toFixed(2)}px, 0)`);
          setStyleIfChanged(word.HTMLElement, "--text-shadow-blur-radius", "0px");
          setStyleIfChanged(word.HTMLElement, "--text-shadow-opacity", "0%");
        }

        setStyleIfChanged(word.HTMLElement, "--gradient-position", `${targetGradientPos.toFixed(2)}%`);

        if (word.Letters) {
          word.Letters.forEach(letter => {
            const letterPct = getProgressPercentage(position, letter.StartTime, letter.EndTime);
            const letterGradientPos = -20 + 120 * letterPct;
            const letterActive = position >= letter.StartTime && position <= letter.EndTime;
            const letterSung = position > letter.EndTime;
            const letterEase = easeSinOut(Math.min(1, letterPct * 2.5));

            if (letter.Emphasis) {
              // Emphasis letter: zoom 1.0 → 1.62 → 1.2, glow slightly below normal emphasis
              const letterBell = Math.sin(letterPct * Math.PI);
              let letterZoom, letterGlow;
              if (letterActive) {
                letterZoom = 1.0 + 0.2 * letterPct + 0.52 * letterBell;
                letterGlow = letterBell * 0.28;
              } else if (letterSung) {
                letterZoom = 1.2;
                letterGlow = 0;
              } else {
                letterZoom = 1;
                letterGlow = 0;
              }
              const letterY = letterActive ? -3 * letterEase : (letterSung ? -3 : 0);

              setStyleIfChanged(letter.HTMLElement, "scale", `${letterZoom.toFixed(4)}`);
              setStyleIfChanged(letter.HTMLElement, "transform", `translate3d(0, ${letterY.toFixed(2)}px, 0)`);
              setStyleIfChanged(letter.HTMLElement, "--text-shadow-blur-radius", `${(4 + 4 * letterGlow).toFixed(2)}px`);
              setStyleIfChanged(letter.HTMLElement, "--text-shadow-opacity", `${(letterGlow * 35).toFixed(2)}%`);
            } else {
              // Normal letter: clean ease up 3px, stays up when sung
              const letterY = letterActive ? -3 * letterEase : (letterSung ? -3 : 0);

              setStyleIfChanged(letter.HTMLElement, "scale", "1");
              setStyleIfChanged(letter.HTMLElement, "transform", `translate3d(0, ${letterY.toFixed(2)}px, 0)`);
              setStyleIfChanged(letter.HTMLElement, "--text-shadow-blur-radius", "0px");
              setStyleIfChanged(letter.HTMLElement, "--text-shadow-opacity", "0%");
            }

            setStyleIfChanged(letter.HTMLElement, "--gradient-position", `${letterGradientPos.toFixed(2)}%`);
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

  // Trigger staggered targets if active index changed (Simple Mode OR AML)
  if ((isSimpleMode || isAML) && activeIdx !== -1 && activeIdx !== lastActiveLineIdx) {
    updateStaggeredTargets(arr, activeIdx, lastActiveLineIdx);
    lastActiveLineIdx = activeIdx;
  }

  const searchIdx = activeIdx !== -1 ? activeIdx : (lastActiveLineIdx || 0);
  const offsetSearch = _isMobile ? (isSimpleMode ? 6 : 3) : (isSimpleMode ? 10 : 5);
  const startIdx = Math.max(0, searchIdx - offsetSearch);
  const endIdx = Math.min(arr.length, searchIdx + offsetSearch + (_isMobile ? 3 : 5));

  // First step all line-level staggered animations (with snapping for lines outside window)
  if (isSimpleMode || isAML) {
    const isScrolling = isUserScrolling();
    for (let index = 0; index < arr.length; index++) {
      const line = arr[index];
      if (line.AnimatorStoreLine) {
        let curY, curOp, curBlur;
        if (line.AnimatorStoreLine.Blur.normalGoal !== undefined) {
          line.AnimatorStoreLine.Blur.SetGoal(isScrolling ? 0 : line.AnimatorStoreLine.Blur.normalGoal);
        }
        if (index >= startIdx && index < endIdx) {
          curY = line.AnimatorStoreLine.Y.Step(deltaTime);
          curOp = line.AnimatorStoreLine.Opacity.Step(deltaTime);
          curBlur = line.AnimatorStoreLine.Blur.Step(deltaTime);
          line.Snapped = false;
        } else {
          if (line.Snapped) {
            continue;
          }
          // Snap instantly if outside active window to prevent stacking
          curY = line.AnimatorStoreLine.Y.target;
          line.AnimatorStoreLine.Y.position = curY;
          line.AnimatorStoreLine.Y.velocity = 0;

          curOp = line.AnimatorStoreLine.Opacity.target;
          line.AnimatorStoreLine.Opacity.position = curOp;
          line.AnimatorStoreLine.Opacity.velocity = 0;

          curBlur = line.AnimatorStoreLine.Blur.target;
          line.AnimatorStoreLine.Blur.position = curBlur;
          line.AnimatorStoreLine.Blur.velocity = 0;
          line.Snapped = true;
        }

        setStyleIfChanged(line.HTMLElement, "transform", `translate3d(0, ${curY.toFixed(2)}px, 0)`);
        setStyleIfChanged(line.HTMLElement, "opacity", curOp.toFixed(3));
        if (curBlur > 0.1) {
          setStyleIfChanged(line.HTMLElement, "filter", `blur(${curBlur.toFixed(1)}px)`);
        } else {
          setStyleIfChanged(line.HTMLElement, "filter", 'none');
        }
      }
    }
  }

  // Sync credits translation with the last line's translation to prevent overlap
  const lastLine = arr[arr.length - 1];
  if (lastLine) {
    const creditsEl = lastLine.HTMLElement.parentElement?.querySelector(".Credits");
    if (creditsEl) {
      if ((isSimpleMode || isAML) && lastLine.AnimatorStoreLine) {
        const curY = lastLine.AnimatorStoreLine.Y.position;
        setStyleIfChanged(creditsEl, "transform", `translate3d(0, ${curY.toFixed(2)}px, 0)`);
      } else {
        creditsEl.style.removeProperty("transform");
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
        const pct = getProgressPercentage(position, line.StartTime, line.EndTime);
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
}