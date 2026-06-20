/**
 * Spicy AMLL Player WEB — Video Renderer
 * Implementation of a canvas-based rendering engine for exporting lyric videos.
 */

import Spring from './spring.js';
import Spline from './spline.js';
import { LyricsObject } from './lyrics-applyer.js';

// --- Replicate spline ranges from animator.js ---
const ScaleSpline = new Spline([0, 0.7, 1], [0.95, 1.025, 1]);
const YOffsetSpline = new Spline([0, 0.9, 1], [1 / 100, -(1 / 60), 0]);
const GlowSpline = new Spline([0, 0.15, 0.6, 1], [0, 1, 1, 0]);
const DotScaleSpline = new Spline([0, 0.7, 1], [0.75, 1.05, 1]);
const DotOpacitySpline = new Spline([0, 0.6, 1], [0.35, 1, 1]);

export default class VideoRenderer {
  constructor() {
    this.albumArt = null;
    this.blurredBg = null;
    this.state = {
      lines: [], // Cached state for springs
    };
  }

  /**
   * Initialize assets for the renderer.
   */
  async init(albumArtUrl) {
    if (!albumArtUrl) return;
    this.albumArt = await this.loadImage(albumArtUrl);
  }

  loadImage(url) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = url;
    });
  }

  /**
   * Main draw call for a single frame.
   * @param {CanvasRenderingContext2D} ctx 
   * @param {number} time - current position in ms
   * @param {number} width 
   * @param {number} height 
   * @param {object} metadata - {album, artist, title}
   * @param {object} options - {orientation: 'vertical'|'horizontal'}
   */
  drawFrame(ctx, time, width, height, metadata, options = {}) {
    const isVertical = options.orientation === 'vertical';

    // 1. Draw Background (Blurred Cover Art)
    this.drawBackground(ctx, width, height);

    // 2. Draw Album Art & Metadata
    const align = options.align || 'left';
    if (isVertical) {
      this.drawVerticalLayout(ctx, time, width, height, metadata, align);
    } else {
      this.drawHorizontalLayout(ctx, time, width, height, metadata, align);
    }
  }

  drawBackground(ctx, width, height) {
    if (!this.albumArt) {
      ctx.fillStyle = '#121212';
      ctx.fillRect(0, 0, width, height);
      return;
    }

    ctx.save();
    // Fill with dark first
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, width, height);

    // Draw blurred art
    ctx.globalAlpha = 0.6;
    ctx.filter = 'blur(60px) saturate(1.8) brightness(0.7)';

    // Cover fill
    const scale = Math.max(width / this.albumArt.width, height / this.albumArt.height);
    const x = (width / 2) - (this.albumArt.width / 2) * scale;
    const y = (height / 2) - (this.albumArt.height / 2) * scale;
    ctx.drawImage(this.albumArt, x, y, this.albumArt.width * scale, this.albumArt.height * scale);

    ctx.restore();

    // Vignette
    const gradient = ctx.createRadialGradient(width / 2, height / 2, 0, width / 2, height / 2, Math.max(width, height) / 1.25);
    gradient.addColorStop(0, 'rgba(0,0,0,0)');
    gradient.addColorStop(1, 'rgba(0,0,0,0.4)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, width, height);
  }

  drawVerticalLayout(ctx, time, width, height, metadata, align) {
    const margin = 50;
    const headerY = height * 0.08;
    const artSize = 120;

    // Album Art (Side by side with metadata)
    this.drawRoundedImage(ctx, this.albumArt, margin, headerY, artSize, artSize, 12);

    // Metadata (Title & Artist)
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';

    // Title
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 42px Outfit, sans-serif';
    ctx.fillText(metadata.title || 'Unknown Title', margin + artSize + 30, headerY + artSize / 2 - 15);

    // Artist
    ctx.fillStyle = 'rgba(255,255,255,0.6)';
    ctx.font = '500 32px Outfit, sans-serif';
    ctx.fillText(metadata.artist || 'Unknown Artist', margin + artSize + 30, headerY + artSize / 2 + 25);

    // Lyrics Area (Aligned based on setting)
    const lyricsY = headerY + artSize + 80;
    this.drawLyrics(ctx, time, margin, lyricsY, width - 2 * margin, height - lyricsY - 200, align);

    // Progress Bar (Slim line)
    this.drawProgressBar(ctx, time, margin, height - 120, width - 2 * margin);
  }

  drawProgressBar(ctx, time, x, y, width) {
    const duration = this.audioPlayer?.duration || 1;
    const pct = Math.min(1, time / duration);

    ctx.save();
    ctx.fillStyle = 'rgba(255,255,255,0.2)';
    ctx.roundRect(x, y, width, 4, 2);
    ctx.fill();

    ctx.fillStyle = 'rgba(255,255,255,0.6)';
    ctx.roundRect(x, y, width * pct, 4, 2);
    ctx.fill();
    ctx.restore();
  }

  drawHorizontalLayout(ctx, time, width, height, metadata, align) {
    // Keep sidebar-ish for horizontal or adapt as needed
    // Mirroring mobile design for horizontal too but wider
    const artSize = height * 0.4;
    const margin = 80;
    const artX = margin;
    const artY = margin;

    this.drawRoundedImage(ctx, this.albumArt, artX, artY, artSize, artSize, 20);

    ctx.textAlign = 'left';
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 36px Outfit, sans-serif';
    ctx.fillText(metadata.title || 'Unknown Title', artX + artSize + 40, artY + artSize / 2 - 10);

    ctx.fillStyle = 'rgba(255,255,255,0.6)';
    ctx.font = '500 24px Outfit, sans-serif';
    ctx.fillText(metadata.artist || 'Unknown Artist', artX + artSize + 40, artY + artSize / 2 + 30);

    const lyricsX = artX;
    const lyricsY = artY + artSize + 60;
    this.drawLyrics(ctx, time, lyricsX, lyricsY, width - 2 * margin, height - lyricsY - 100, align);
  }

  drawRoundedImage(ctx, img, x, y, w, h, radius) {
    if (!img) return;
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(x + radius, y);
    ctx.lineTo(x + w - radius, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + radius);
    ctx.lineTo(x + w, y + h - radius);
    ctx.quadraticCurveTo(x + w, y + h, x + w - radius, y + h);
    ctx.lineTo(x + radius, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - radius);
    ctx.lineTo(x, y + radius);
    ctx.quadraticCurveTo(x, y, x + radius, y);
    ctx.closePath();
    ctx.clip();

    // Drop shadow (simulated with black rect behind clip)
    ctx.drawImage(img, x, y, w, h);
    ctx.restore();

    // Actual Shadow
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.5)';
    ctx.shadowBlur = 40;
    ctx.shadowOffsetY = 15;
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, radius);
    ctx.stroke(); // transparent stroke but shows shadow
    ctx.restore();
  }

  drawLyrics(ctx, time, x, y, width, height, align) {
    const lines = LyricsObject.Types.Syllable.Lines.length > 0
      ? LyricsObject.Types.Syllable.Lines
      : (LyricsObject.Types.Line.Lines.length > 0 ? LyricsObject.Types.Line.Lines : LyricsObject.Types.Static.Lines);


    if (!lines.length) return;

    // Find active line
    let activeIdx = -1;
    for (let i = 0; i < lines.length; i++) {
      if (time >= lines[i].StartTime && time <= lines[i].EndTime) {
        activeIdx = i;
        break;
      }
      if (time < lines[i].StartTime) break;
    }

    const fontSize = 36;
    const lineHeight = fontSize * 1.3;
    const startY = y + height / 2; // Center the active line

    // Smooth scroll simulation
    // We target the active line for the center
    let scrollOffset = 0;
    if (activeIdx !== -1) {
      scrollOffset = activeIdx * lineHeight;
    } else {
      // Find nearest next line
      for (let i = 0; i < lines.length; i++) {
        if (time < lines[i].StartTime) {
          const prev = i > 0 ? (i - 1) : 0;
          scrollOffset = prev * lineHeight;
          break;
        }
      }
    }

    ctx.save();
    // Clip lyrics area
    ctx.beginPath();
    ctx.rect(x, y, width, height);
    ctx.clip();

    ctx.translate(0, startY - scrollOffset);

    lines.forEach((line, i) => {
      const lineY = i * lineHeight;
      const opacity = activeIdx === i ? 1 : 0.4;
      const isPast = time > line.EndTime;

      ctx.save();
      ctx.globalAlpha = opacity;
      ctx.textAlign = align;
      ctx.font = `bold ${fontSize}px Outfit, sans-serif`;

      const lineText = this.getLineText(line);
      let textX = x;
      if (align === 'center') textX = x + width / 2;
      else if (align === 'right') textX = x + width;

      if (activeIdx === i && line.Syllables?.Lead) {
        this.drawSyllableLine(ctx, line, time, textX, lineY, fontSize, align);
      } else {
        ctx.fillStyle = isPast ? '#fff' : 'rgba(255,255,255,0.7)';
        ctx.fillText(lineText, textX, lineY);
      }
      ctx.restore();
    });

    ctx.restore();
  }

  getLineText(line) {
    if (line.Syllables?.Lead) {
      return line.Syllables.Lead.map(w => w.Text).join('');
    }
    return line.LineText || '';
  }

  drawSyllableLine(ctx, line, time, x, y, fontSize, align) {
    // Replicate the gradient filling word by word
    let currentX = x;
    if (align === 'center') {
      const totalWidth = ctx.measureText(this.getLineText(line)).width;
      currentX = x - totalWidth / 2;
    } else if (align === 'right') {
      const totalWidth = ctx.measureText(this.getLineText(line)).width;
      currentX = x - totalWidth;
    }

    line.Syllables.Lead.forEach(word => {
      const wordWidth = ctx.measureText(word.Text).width;
      const pct = Math.max(0, Math.min(1, (time - word.StartTime) / (word.EndTime - word.StartTime)));

      ctx.save();
      if (time >= word.StartTime) {
        // Draw active/past word with gradient fill
        const grad = ctx.createLinearGradient(currentX, 0, currentX + wordWidth, 0);
        const gradPos = Math.max(0, Math.min(1, pct * 1.5 - 0.25)); // Slightly aggressive transition
        grad.addColorStop(0, '#fff');
        grad.addColorStop(gradPos, '#fff');
        grad.addColorStop(Math.min(1, gradPos + 0.1), 'rgba(255,255,255,0.4)');

        ctx.fillStyle = grad;
      } else {
        ctx.fillStyle = 'rgba(255,255,255,0.4)';
      }

      ctx.fillText(word.Text, currentX, y);
      ctx.restore();

      currentX += wordWidth;
    });
  }
}
