/**
 * Spicy AMLL Player WEB — Scroll Manager
 * Tracks user-initiated scrolling so auto-positioning (via --ty) can yield.
 */

let userScrollTimeout = null;
let userIsScrolling = false;
let lastUserScrollTime = 0;

const USER_SCROLL_COOLDOWN = 3000;

export function initScrollManager(lyricsContent) {
  lyricsContent.style.scrollBehavior = 'auto';

  const markUserScroll = () => {
    userIsScrolling = true;
    lastUserScrollTime = performance.now();
    lyricsContent.classList.add('HideLineBlur');
    clearTimeout(userScrollTimeout);

    userScrollTimeout = setTimeout(() => {
      userIsScrolling = false;
      lyricsContent.classList.remove('HideLineBlur');
    }, USER_SCROLL_COOLDOWN);
  };

  lyricsContent.addEventListener('wheel', markUserScroll, { passive: true });
  lyricsContent.addEventListener('touchstart', markUserScroll, { passive: true });
  lyricsContent.addEventListener('touchmove', markUserScroll, { passive: true });
  lyricsContent.addEventListener('mousedown', markUserScroll, { passive: true });
}

export function scrollToActiveLine(_lyricsContent, _force = false) {
  // Lines animate position via --ty + CSS transition — no scroll needed
}

export function queueForceScroll() {
  // Lines handle their own positioning — no-op
}

export function resetScrollManager() {
  userIsScrolling = false;
  lastUserScrollTime = 0;
  clearTimeout(userScrollTimeout);
}

export function isUserScrolling() {
  return userIsScrolling;
}
