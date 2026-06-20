/**
 * Spicy AMLL Player — Media Session & Wake Lock Integration
 * Manages navigator.mediaSession (for native OS media controls)
 * and navigator.wakeLock (to keep the screen on during playback).
 */

export class MediaSessionManager {
  constructor(player, nextTrackFn, prevTrackFn) {
    this.player = player;
    this.wakeLock = null;
    
    // Setup action handlers for system play/pause/prev/next buttons
    if ('mediaSession' in navigator) {
      navigator.mediaSession.setActionHandler('play', () => {
        this.player.play();
      });
      navigator.mediaSession.setActionHandler('pause', () => {
        this.player.pause();
      });
      if (prevTrackFn) {
        navigator.mediaSession.setActionHandler('previoustrack', prevTrackFn);
      }
      if (nextTrackFn) {
        navigator.mediaSession.setActionHandler('nexttrack', nextTrackFn);
      }
    }

    // Attach to player events for WakeLock and playbackState
    this.player.onPlay = this._wrapCallback(this.player.onPlay, async () => {
      this.updatePlaybackState('playing');
      await this.requestWakeLock();
    });

    this.player.onPause = this._wrapCallback(this.player.onPause, () => {
      this.updatePlaybackState('paused');
      this.releaseWakeLock();
    });

    this.player.onEnded = this._wrapCallback(this.player.onEnded, () => {
      this.updatePlaybackState('paused');
      this.releaseWakeLock();
    });

    // Re-request wake lock if visibility changes (browser requirement)
    document.addEventListener('visibilitychange', async () => {
      if (this.wakeLock !== null && document.visibilityState === 'visible' && this.player.isPlaying) {
        await this.requestWakeLock();
      }
    });
  }

  // Helper to wrap existing player event callbacks so we don't overwrite them
  _wrapCallback(originalCallback, newCallback) {
    return (...args) => {
      newCallback();
      if (originalCallback) originalCallback(...args);
    };
  }

  /**
   * Update the system MediaMetadata (Title, Artist, Album, Image)
   */
  updateMetadata(title, artist, album, artUrl) {
    if (!('mediaSession' in navigator)) return;

    navigator.mediaSession.metadata = new MediaMetadata({
      title: title || 'Unknown Title',
      artist: artist || 'Unknown Artist',
      album: album || 'Unknown Album',
      artwork: artUrl ? [
        { src: artUrl, sizes: '512x512', type: 'image/jpeg' }
      ] : []
    });
  }

  updatePlaybackState(state) {
    if ('mediaSession' in navigator) {
      navigator.mediaSession.playbackState = state; // 'playing' or 'paused'
    }
  }

  /**
   * Keep the screen awake during playback
   */
  async requestWakeLock() {
    if (!('wakeLock' in navigator)) return;
    try {
      this.wakeLock = await navigator.wakeLock.request('screen');
    } catch (err) {
      console.log('[MediaSessionManager] Wake Lock request failed:', err.name, err.message);
    }
  }

  releaseWakeLock() {
    if (this.wakeLock !== null) {
      this.wakeLock.release().then(() => {
        this.wakeLock = null;
      });
    }
  }
}
