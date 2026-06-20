/**
 * Spicy AMLL Player WEB — Scroll Manager
 * Auto-scrolls the lyrics container to keep the active line centered.
 * Ported from revancedv2's ScrollToActiveLine.ts with proper bounce prevention.
 */

import Spring from './spring.js';

let userScrollTimeout = null;
let userIsScrolling = false;
let lastActiveElement = null;
let lastScrollTime = 0;
let forceScrollQueued = false;
let lastPosition = 0;
let lastUserScrollTime = 0;

const USER_SCROLL_COOLDOWN = 3000; // Increased to 3s for better free scrolling
const SNAP_BACK_THRESHOLD = 3000;  // 3s before force-snapping back if away

// Reset state on window focus/resize to prevent stale scroll positions
window.addEventListener('focus', resetScrollManager);
window.addEventListener('resize', resetScrollManager);

// Visibility change handler — prevents bounce when tabbing out/in
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') {
    forceScrollQueued = true;
    userIsScrolling = false;
    clearTimeout(userScrollTimeout);
  }
});

/**
 * Initialize scroll manager on a lyrics content element.
 */
export function initScrollManager(lyricsContent) {
  // Prevent CSS smooth scrolling from fighting our JS spring physics
  lyricsContent.style.scrollBehavior = 'auto';

  const markUserScroll = () => {
    userIsScrolling = true;
    lastUserScrollTime = performance.now(); // Record user scroll interaction
    lyricsContent.classList.add('HideLineBlur');
    clearTimeout(userScrollTimeout);

    // Cancel any active spring animation immediately when the user interacts
    if (springState.rafId) {
      cancelAnimationFrame(springState.rafId);
      springState.rafId = null;
    }

    userScrollTimeout = setTimeout(() => {
      userIsScrolling = false;
      lyricsContent.classList.remove('HideLineBlur');
    }, USER_SCROLL_COOLDOWN);
  };

  // Detect various user interactions
  lyricsContent.addEventListener('wheel', markUserScroll, { passive: true });
  lyricsContent.addEventListener('touchstart', markUserScroll, { passive: true });
  lyricsContent.addEventListener('touchmove', markUserScroll, { passive: true });
  lyricsContent.addEventListener('mousedown', markUserScroll, { passive: true });
}

// Spring physics state
const scrollSpring = new Spring(0, 2.1, 0.82); // Frequency 2.1Hz, Damping 0.82 (Equivalent to Tension 180, Damping 22)
const springState = {
  rafId: null,
  lastTime: null,
  precision: 0.5,
};

/**
 * Smoothly scroll an element into the center of the container using spring physics.
 */
/**
 * Computes the scroll offset of `element` relative to `container`.
 * Uses getBoundingClientRect() so it works regardless of positioning context —
 * the offsetParent chain approach fails on desktop when lyricsContent is not
 * a positioned element and therefore never appears as an offsetParent.
 */
function getOffsetTopRelativeTo(element, container) {
  const elementRect = element.getBoundingClientRect();
  const containerRect = container.getBoundingClientRect();
  let offset = elementRect.top - containerRect.top + container.scrollTop;

  // Subtract current transform Y translation from lyrics-animator staggered springs
  // to get the stable, untransformed layout top of the line.
  if (element.AnimatorStoreLine && typeof element.AnimatorStoreLine.Y?.position === 'number') {
    offset -= element.AnimatorStoreLine.Y.position;
  }

  return offset;
}

function scrollIntoCenter(container, element, instant = false) {
  if (!container || !element) return;

  const containerHeight = container.clientHeight;
  const elementOffsetTop = getOffsetTopRelativeTo(element, container);
  const elementHeight = element.offsetHeight;

  const targetScroll = elementOffsetTop - (containerHeight * 0.38) + (elementHeight / 2);
  const clampedTarget = Math.max(0, Math.min(targetScroll, container.scrollHeight - containerHeight));

  if (instant) {
    if (springState.rafId) {
      cancelAnimationFrame(springState.rafId);
      springState.rafId = null;
    }
    container._isInternalScroll = true;
    container.scrollTop = clampedTarget;
    scrollSpring.SetGoal(clampedTarget, true);
    requestAnimationFrame(() => { container._isInternalScroll = false; });
  } else {
    scrollSpring.SetGoal(clampedTarget);
    
    if (!springState.rafId) {
      springState.lastTime = null;
      scrollSpring.position = container.scrollTop;
      scrollSpring.velocity = 0;
      springState.rafId = requestAnimationFrame((t) => tickSpring(t, container));
    }
  }
}

function tickSpring(timestamp, container) {
  if (!container) {
    springState.rafId = null;
    return;
  }

  if (!springState.lastTime) {
    springState.lastTime = timestamp;
    springState.rafId = requestAnimationFrame((t) => tickSpring(t, container));
    return;
  }

  const dt = (timestamp - springState.lastTime) / 1000;
  springState.lastTime = timestamp;

  scrollSpring.Step(dt);

  container._isInternalScroll = true;
  container.scrollTop = scrollSpring.position;

  const settled =
    Math.abs(scrollSpring.velocity) < springState.precision &&
    Math.abs(scrollSpring.position - scrollSpring.goal) < springState.precision;

  if (settled) {
    container.scrollTop = scrollSpring.goal;
    scrollSpring.SetGoal(scrollSpring.goal, true);
    springState.rafId = null;
    requestAnimationFrame(() => { container._isInternalScroll = false; });
  } else {
    springState.rafId = requestAnimationFrame((t) => tickSpring(t, container));
  }
}


/**
 * Check if an element is in viewport.
 */
function isElementInViewport(container, element) {
  const elementTop = getOffsetTopRelativeTo(element, container);
  const elementBottom = elementTop + element.clientHeight;
  const viewportTop = container.scrollTop;
  const viewportBottom = viewportTop + container.clientHeight;
  return elementBottom > viewportTop && elementTop < viewportBottom;
}

/**
 * Scroll to the currently active line.
 */
export function scrollToActiveLine(lyricsContent, force = false) {
  const now = performance.now();

  if (forceScrollQueued || force) {
    forceScrollQueued = false;
    userIsScrolling = false;
    lastUserScrollTime = 0; // Reset user scroll timer
    const activeLine = lyricsContent.querySelector('.line.Active:not(.bg-line)');
    if (activeLine) {
      lastActiveElement = activeLine;
      scrollIntoCenter(lyricsContent, activeLine, force ? false : true);
    }
    return;
  }

  // If the user has scrolled manually recently, don't snap back yet
  if (now - lastUserScrollTime < SNAP_BACK_THRESHOLD) {
    return;
  }

  const activeLine = lyricsContent.querySelector('.line.Active:not(.bg-line)');
  if (!activeLine) return;

  if (activeLine === lastActiveElement) return;

  lastActiveElement = activeLine;
  lastScrollTime = now;

  const prevSibling = activeLine.previousElementSibling;
  const isAfterDotLine = prevSibling?.classList.contains('musical-line');

  if (isAfterDotLine) {
    setTimeout(() => {
      // Re-verify that user hasn't scrolled during the timeout delay
      if (performance.now() - lastUserScrollTime >= SNAP_BACK_THRESHOLD) {
        scrollIntoCenter(lyricsContent, activeLine, false);
      }
    }, 240);
  } else {
    scrollIntoCenter(lyricsContent, activeLine, false);
  }
}

/**
 * Queue a force scroll for the next frame (e.g., after seeking).
 */
export function queueForceScroll() {
  forceScrollQueued = true;
}

/**
 * Reset scroll manager state.
 */
export function resetScrollManager() {
  userIsScrolling = false;
  lastActiveElement = null;
  lastScrollTime = 0;
  lastUserScrollTime = 0;
  forceScrollQueued = false;
  clearTimeout(userScrollTimeout);
}

/**
 * Check if the user is currently scrolling.
 * @returns {boolean}
 */
export function isUserScrolling() {
  return userIsScrolling;
}
