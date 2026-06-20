import Kawarp from 'https://esm.sh/@kawarp/core@1.2.0';

let _kawarp = null;
let _resizeHandler = null;
let _videoUpdateTimer = null;

// Hidden canvas for frame capture (reused)
const _sourceCanvas = document.createElement('canvas');
const _sourceCtx = _sourceCanvas.getContext('2d', { alpha: false });
_sourceCanvas.width = 128; // Low resolution for background motion is enough
_sourceCanvas.height = 128;

const KawarpOptionsStatic = {
  warpIntensity: 1,
  blurPasses: 8,
  animationSpeed: 1.5,
  saturation: 1.5,
  dithering: 0.008,
  transitionDuration: 500,
  tintIntensity: 0,
  scale: 1,
};

/**
 * Spicy AMLL Player WEB — Dynamic Background
 * Extracts colors from images and creates animated backgrounds.
 */

/**
 * Extract dominant colors from an image element or URL.
 * @param {string} imageUrl
 * @returns {Promise<{vibrant: number[], dark: number[], muted: number[]}>}
 */
export async function extractColors(imageUrl) {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      const size = 64;
      canvas.width = size;
      canvas.height = size;
      ctx.drawImage(img, 0, 0, size, size);

      const imageData = ctx.getImageData(0, 0, size, size).data;
      const colors = [];

      for (let i = 0; i < imageData.length; i += 16) {
        colors.push([imageData[i], imageData[i + 1], imageData[i + 2]]);
      }

      // Sort by saturation * brightness to find vibrant colors
      colors.sort((a, b) => {
        const satA = getColorSaturation(a);
        const satB = getColorSaturation(b);
        return satB - satA;
      });

      resolve({
        vibrant: colors[0] || [80, 80, 80],
        dark: darkenColor(colors[Math.floor(colors.length * 0.6)] || [30, 30, 30], 0.4),
        muted: colors[Math.floor(colors.length * 0.3)] || [60, 60, 60],
      });
    };
    img.onerror = () => {
      resolve({
        vibrant: [80, 80, 80],
        dark: [20, 20, 20],
        muted: [50, 50, 50],
      });
    };
    img.src = imageUrl;
  });
}

function getColorSaturation(rgb) {
  const r = rgb[0] / 255, g = rgb[1] / 255, b = rgb[2] / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return 0;
  const d = max - min;
  return l > 0.5 ? d / (2 - max - min) : d / (max + min);
}

function darkenColor(rgb, amount) {
  return rgb.map(c => Math.floor(c * amount));
}

/**
 * Apply Kawarp animated background to the page.
 * @param {HTMLElement} bgContainer - The .spicy-dynamic-bg element
 * @param {HTMLElement|string} img - The image/video element or URL
 */
export async function applyLegacyBackground(bgContainer, img) {
  stopKawarp();

  if (_resizeHandler) {
    window.removeEventListener("resize", _resizeHandler);
    _resizeHandler = null;
  }

  bgContainer.innerHTML = "";
  bgContainer.className = "spicy-dynamic-bg KawarpBackground";

  const canvas = document.createElement("canvas");
  canvas.style.width = "100%";
  canvas.style.height = "100%";

  const targetWidth = 384;
  const aspect = window.innerWidth > 0 ? (window.innerHeight / window.innerWidth) : 0.5625;
  canvas.width = targetWidth;
  canvas.height = Math.max(1, Math.round(targetWidth * aspect));
  bgContainer.appendChild(canvas);

  const isPlaying = window.spicyPlayer ? window.spicyPlayer.isPlaying : false;
  const initialSpeed = isPlaying ? 1.5 : 0.15;

  _kawarp = new Kawarp(canvas, {
    ...KawarpOptionsStatic,
    animationSpeed: initialSpeed
  });
  _kawarp.start();

  const loadSource = async () => {
    if (!_kawarp) return;
    if (img instanceof HTMLVideoElement) {
      if (img.readyState >= 2 && img.videoWidth > 0 && img.videoHeight > 0) {
        _sourceCanvas.width = img.videoWidth;
        _sourceCanvas.height = img.videoHeight;
        _sourceCtx.drawImage(
          img,
          0,
          0,
          _sourceCanvas.width,
          _sourceCanvas.height
        );
        _kawarp.gl.bindTexture(_kawarp.gl.TEXTURE_2D, _kawarp.sourceTexture);
        _kawarp.gl.texImage2D(_kawarp.gl.TEXTURE_2D, 0, _kawarp.gl.RGBA, _kawarp.gl.RGBA, _kawarp.gl.UNSIGNED_BYTE, _sourceCanvas);
        _kawarp.reblurCurrentImage();
      }
    } else if (typeof img === 'string') {
      try {
        await _kawarp.loadImage(img);
      } catch (err) {
        console.warn("Kawarp failed to load image URL:", img, err);
      }
    } else {
      _kawarp.loadImageElement(img);
    }
  };

  await loadSource();

  if (img instanceof HTMLVideoElement) {
    const updateFrame = () => {
      if (!_kawarp) return;

      if (img.readyState >= 2 && img.videoWidth > 0 && img.videoHeight > 0) {
        if (_sourceCanvas.width !== img.videoWidth || _sourceCanvas.height !== img.videoHeight) {
          _sourceCanvas.width = img.videoWidth;
          _sourceCanvas.height = img.videoHeight;
        }
        _sourceCtx.drawImage(
          img,
          0,
          0,
          _sourceCanvas.width,
          _sourceCanvas.height
        );
        _kawarp.gl.bindTexture(_kawarp.gl.TEXTURE_2D, _kawarp.sourceTexture);
        _kawarp.gl.texImage2D(_kawarp.gl.TEXTURE_2D, 0, _kawarp.gl.RGBA, _kawarp.gl.RGBA, _kawarp.gl.UNSIGNED_BYTE, _sourceCanvas);
        _kawarp.reblurCurrentImage();
      }

      _videoUpdateTimer = setTimeout(updateFrame, 100);
    };

    _videoUpdateTimer = setTimeout(updateFrame, 100);
  }

  _resizeHandler = () => {
    const nextAspect = window.innerWidth > 0 ? (window.innerHeight / window.innerWidth) : 0.5625;
    canvas.width = targetWidth;
    canvas.height = Math.max(1, Math.round(targetWidth * nextAspect));
    _kawarp?.resize?.();
  };

  window.addEventListener("resize", _resizeHandler);
}

export function stopKawarp() {
  if (_videoUpdateTimer) {
    clearTimeout(_videoUpdateTimer);
    _videoUpdateTimer = null;
  }
  if (_kawarp) {
    try {
      _kawarp.dispose();
    } catch (e) {
      console.warn("[Kawarp] Error disposing:", e);
    }
    _kawarp = null;
  }
}

export function setKawarpPlaybackState(isPlaying) {
  if (_kawarp) {
    _kawarp.setOptions({
      animationSpeed: isPlaying ? 1.5 : 0.15
    });
  }
}

/**
 * Apply a simple color gradient background.
 * @param {HTMLElement} bgContainer
 * @param {{vibrant: number[], dark: number[]}} colors
 */
export function applyColorBackground(bgContainer, colors) {
  stopKawarp();
  bgContainer.className = "spicy-dynamic-bg ColorBackground";
  bgContainer.style.setProperty('--MinContrastColor', colors.dark.join(', '));
  bgContainer.style.setProperty('--HighContrastColor', colors.vibrant.map(c => Math.floor(c * 0.3)).join(', '));
}

/**
 * Create a default dark background when no image is available.
 * @param {HTMLElement} bgContainer
 */
export function applyDefaultBackground(bgContainer) {
  stopKawarp();
  bgContainer.className = "spicy-dynamic-bg ColorBackground";
  bgContainer.style.setProperty('--MinContrastColor', '18, 18, 18');
  bgContainer.style.setProperty('--HighContrastColor', '8, 8, 8');
}