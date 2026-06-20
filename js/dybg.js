/**
 * Spicy AMLL Player WEB — Dynamic Background WebGL Engine
 * Local version of dybg.js with robust safety guards for dimensions,
 * resource cleanup to avoid leaks, and framebuffers validation.
 */

const VS = `
attribute vec2 a_pos;
attribute vec2 a_uv;
varying vec2 v_uv;
void main(){
  v_uv = a_uv;
  gl_Position = vec4(a_pos, 0.0, 1.0);
}`;

const FS_WARP = `
precision highp float;
varying vec2 v_uv;
uniform sampler2D u_tex;
uniform float u_time;
uniform vec2 u_center;
uniform float u_angle;
uniform float u_size;
uniform vec2 u_resolution;
uniform float u_warpPhase;
uniform float u_warpSpeed;
uniform float u_warpIntensity;

void main(){
  vec2 px = v_uv * u_resolution;

  vec2 p = px - u_center;
  float cosA = cos(-u_angle);
  float sinA = sin(-u_angle);
  vec2 rot = vec2(p.x*cosA - p.y*sinA, p.x*sinA + p.y*cosA);

  vec2 uv = rot / u_size + 0.5;

  // smoother, more fluid warp for an organic look
  float localTime = u_time * u_warpSpeed + u_warpPhase;
  vec2 warp = vec2(
    sin(uv.y * 2.0 + localTime) * 0.3 + cos(uv.x * 1.5 - localTime * 0.7) * 0.2,
    cos(uv.x * 2.0 + localTime) * 0.3 + sin(uv.y * 1.5 - localTime * 0.7) * 0.2
  );
  uv += warp * u_warpIntensity;

  float d = length(p) / (u_size * 0.5);
  float alpha = smoothstep(1.2, 0.0, d);
  
  if(alpha <= 0.01){
    discard;
  }

  vec4 texColor = texture2D(u_tex, uv);

  gl_FragColor = vec4(texColor.rgb, alpha);
}`;

const FS_BLUR = `
precision highp float;
varying vec2 v_uv;
uniform sampler2D u_tex;
uniform vec2 u_res;
uniform float u_offset;
void main() {
  vec2 texel = u_offset / u_res;
  vec4 color = texture2D(u_tex, v_uv) * 0.25;
  
  color += texture2D(u_tex, v_uv + vec2(-texel.x, 0.0)) * 0.125;
  color += texture2D(u_tex, v_uv + vec2(texel.x, 0.0)) * 0.125;
  color += texture2D(u_tex, v_uv + vec2(0.0, -texel.y)) * 0.125;
  color += texture2D(u_tex, v_uv + vec2(0.0, texel.y)) * 0.125;
  
  color += texture2D(u_tex, v_uv + vec2(-texel.x, -texel.y)) * 0.0625;
  color += texture2D(u_tex, v_uv + vec2(texel.x, -texel.y)) * 0.0625;
  color += texture2D(u_tex, v_uv + vec2(-texel.x, texel.y)) * 0.0625;
  color += texture2D(u_tex, v_uv + vec2(texel.x, texel.y)) * 0.0625;
  
  gl_FragColor = color;
}`;

const FS_OUT = `
precision highp float;
varying vec2 v_uv;
uniform sampler2D u_tex;
uniform float u_saturation;
uniform float u_brightness;
uniform float u_time;
uniform vec2 u_res;
uniform float u_scale;
uniform float u_dithering;

highp float hash(highp vec3 p) {
  p = fract(p * 0.1031);
  p += dot(p, p.zyx + 31.32);
  return fract((p.x + p.y) * p.z);
}

void main() {
  vec2 uv = (v_uv - 0.5) / u_scale + 0.5;
  uv = clamp(uv, 0.0, 1.0);

  vec2 dir = uv - 0.5;
  vec2 caOffset = dir * 0.015;
  vec4 color;
  color.r = texture2D(u_tex, uv + caOffset).r;
  color.g = texture2D(u_tex, uv).g;
  color.b = texture2D(u_tex, uv - caOffset).b;
  color.a = texture2D(u_tex, uv).a;
  
  color.rgb *= u_brightness;
  float gray = dot(color.rgb, vec3(0.299, 0.587, 0.114));
  color.rgb = mix(vec3(gray), color.rgb, u_saturation);

  highp vec2 pixelPos = floor(v_uv * u_res);
  highp float noise = hash(vec3(pixelPos, floor(u_time * 60.0)));
  color.rgb += (noise - 0.5) * u_dithering;

  gl_FragColor = vec4(color.rgb, 1.0);
}`;

// Detect mobile/tablet for reduced WebGL workload
const _isMobileDybg = /Android|iPhone|iPad|iPod|Mobile|Tablet/i.test(navigator.userAgent) || window.innerWidth <= 768;

export default class Dybg {
  constructor(canvas) {
    this.canvas = canvas;
    this.gl = canvas.getContext('webgl', { premultipliedAlpha: false });
    if (!this.gl) throw new Error("WebGL not supported");

    this.BLUR_PASSES = _isMobileDybg ? 4 : 8;
    this.covers = [
      {px: 0.8, py: 0.4, angle: 4.7, speed: -0.0001, scale: 1.7, warpPhase: 5, warpSpeed: 0.000000000001},
      {px: 0.0, py: 0.78, angle: 0.0, speed:  0.001, scale: 1.8, warpPhase: 3.3, warpSpeed: 0.0000000000005},
    ];
    this.loaded = false;
    this.t = 0;
    this.startTime = 0;
    this.rafId = null;
    this._frameSkip = 0; // For mobile 30fps rendering

    this.initShaders();
    this.initBuffers();
    this.initTextures();
    this.resize();

    this.resizeListener = () => this.resize();
    window.addEventListener('resize', this.resizeListener);
  }

  compile(type, src) {
    const s = this.gl.createShader(type);
    this.gl.shaderSource(s, src);
    this.gl.compileShader(s);
    return s;
  }

  compileProgram(vsSrc, fsSrc) {
    const p = this.gl.createProgram();
    this.gl.attachShader(p, this.compile(this.gl.VERTEX_SHADER, vsSrc));
    this.gl.attachShader(p, this.compile(this.gl.FRAGMENT_SHADER, fsSrc));
    this.gl.linkProgram(p);
    return p;
  }

  initShaders() {
    this.progWarp = this.compileProgram(VS, FS_WARP);
    this.progBlur = this.compileProgram(VS, FS_BLUR);
    this.progOut  = this.compileProgram(VS, FS_OUT);

    const gl = this.gl;
    this.locs = {
      warp: {
        time: gl.getUniformLocation(this.progWarp, 'u_time'),
        center: gl.getUniformLocation(this.progWarp, 'u_center'),
        angle: gl.getUniformLocation(this.progWarp, 'u_angle'),
        size: gl.getUniformLocation(this.progWarp, 'u_size'),
        res: gl.getUniformLocation(this.progWarp, 'u_resolution'),
        tex: gl.getUniformLocation(this.progWarp, 'u_tex'),
        warpPhase: gl.getUniformLocation(this.progWarp, 'u_warpPhase'),
        warpSpeed: gl.getUniformLocation(this.progWarp, 'u_warpSpeed'),
        warpIntensity: gl.getUniformLocation(this.progWarp, 'u_warpIntensity')
      },
      blur: {
        tex: gl.getUniformLocation(this.progBlur, 'u_tex'),
        res: gl.getUniformLocation(this.progBlur, 'u_res'),
        offset: gl.getUniformLocation(this.progBlur, 'u_offset')
      },
      out: {
        tex: gl.getUniformLocation(this.progOut, 'u_tex'),
        sat: gl.getUniformLocation(this.progOut, 'u_saturation'),
        bri: gl.getUniformLocation(this.progOut, 'u_brightness'),
        time: gl.getUniformLocation(this.progOut, 'u_time'),
        res: gl.getUniformLocation(this.progOut, 'u_res'),
        scale: gl.getUniformLocation(this.progOut, 'u_scale'),
        dither: gl.getUniformLocation(this.progOut, 'u_dithering')
      }
    };
  }

  initBuffers() {
    const gl = this.gl;
    this.buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
      -1,-1, 0,0,
       1,-1, 1,0,
      -1, 1, 0,1,
       1, 1, 1,1,
    ]), gl.STATIC_DRAW);
  }

  setupQuad(prog) {
    const gl = this.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buf);
    const aPos = gl.getAttribLocation(prog, 'a_pos');
    const aUV  = gl.getAttribLocation(prog, 'a_uv');
    gl.enableVertexAttribArray(aPos);
    gl.enableVertexAttribArray(aUV);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 16, 0);
    gl.vertexAttribPointer(aUV,  2, gl.FLOAT, false, 16, 8);
  }

  initTextures() {
    const gl = this.gl;
    this.tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  }

  createFBO(w, h) {
    const gl = this.gl;
    const t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);

    const fb = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0);
    return { tex: t, fb, w, h };
  }

  resize() {
    // Avoid zero or NaN width/height to prevent incomplete framebuffer attachments
    const canvasWidth = Math.max(1, this.canvas.offsetWidth || this.canvas.width || window.innerWidth || 1);
    const canvasHeight = Math.max(1, this.canvas.offsetHeight || this.canvas.height || window.innerHeight || 1);
    
    this.canvas.width = canvasWidth;
    this.canvas.height = canvasHeight;
    
    const BLUR_BASE = _isMobileDybg ? 128 : 256;
    const maxDim = Math.max(canvasWidth, canvasHeight);
    
    // Guard division by zero and protect against NaN
    const scaleW = maxDim > 0 ? canvasWidth / maxDim : 1;
    const scaleH = maxDim > 0 ? canvasHeight / maxDim : 1;
    
    this.blurW = Math.max(1, Math.floor(BLUR_BASE * scaleW)) || 1;
    this.blurH = Math.max(1, Math.floor(BLUR_BASE * scaleH)) || 1;
    
    const gl = this.gl;
    if (this.fboBase) { gl.deleteFramebuffer(this.fboBase.fb); gl.deleteTexture(this.fboBase.tex); }
    if (this.fboBlur1) { gl.deleteFramebuffer(this.fboBlur1.fb); gl.deleteTexture(this.fboBlur1.tex); }
    if (this.fboBlur2) { gl.deleteFramebuffer(this.fboBlur2.fb); gl.deleteTexture(this.fboBlur2.tex); }
    
    this.fboBase = this.createFBO(canvasWidth, canvasHeight);
    this.fboBlur1 = this.createFBO(this.blurW, this.blurH);
    this.fboBlur2 = this.createFBO(this.blurW, this.blurH);
  }

  loadImage(imgSource) {
    return new Promise((resolve, reject) => {
      const applyTexture = (img) => {
        try {
          const gl = this.gl;
          gl.bindTexture(gl.TEXTURE_2D, this.tex);
          gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
          this.loaded = true;
          this.startTime = performance.now();
          if (!this.rafId) {
            this.draw();
          }
          resolve();
        } catch (err) {
          reject(err);
        }
      };

      if (typeof imgSource === 'string') {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = () => applyTexture(img);
        img.onerror = () => reject(new Error(`Failed to load image: ${imgSource}`));
        img.src = imgSource;
      } else if (imgSource instanceof HTMLImageElement && !imgSource.complete) {
        imgSource.onload = () => applyTexture(imgSource);
        imgSource.onerror = reject;
      } else {
        applyTexture(imgSource);
      }
    });
  }

  draw = () => {
    if(!this.loaded) return;

    // On mobile, skip every other frame (30fps) to halve GPU load
    if (_isMobileDybg) {
      this._frameSkip = (this._frameSkip + 1) % 2;
      if (this._frameSkip !== 0) {
        this.rafId = requestAnimationFrame(this.draw);
        return;
      }
    }

    this.t += _isMobileDybg ? 0.008 : 0.012;
    const W = this.canvas.width, H = this.canvas.height;
    const transition = Math.min(1.0, (performance.now() - this.startTime) / 800.0);
    const gl = this.gl;

    // Safety guard to prevent draw calls when sizes are uninitialized or zero
    if (W <= 0 || H <= 0 || !this.fboBase || !this.fboBlur1 || !this.fboBlur2) return;

    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fboBase.fb);
    gl.viewport(0, 0, W, H);
    gl.clearColor(0.05, 0.05, 0.05, 1.0);
    gl.clear(gl.COLOR_BUFFER_BIT);

    gl.useProgram(this.progWarp);
    this.setupQuad(this.progWarp);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    gl.uniform1i(this.locs.warp.tex, 0);
    gl.uniform2f(this.locs.warp.res, W, H);
    gl.uniform1f(this.locs.warp.time, this.t);
    gl.uniform1f(this.locs.warp.warpIntensity, 1.0);

    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

    this.covers.forEach(cv => {
      cv.angle += cv.speed;
      const sz = cv.scale * Math.max(W, H);
      const cx = cv.px * W;
      const cy = (1.0 - cv.py) * H;
      gl.uniform2f(this.locs.warp.center, cx, cy);
      gl.uniform1f(this.locs.warp.angle, cv.angle);
      gl.uniform1f(this.locs.warp.size, sz);
      gl.uniform1f(this.locs.warp.warpPhase, cv.warpPhase);
      gl.uniform1f(this.locs.warp.warpSpeed, cv.warpSpeed);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    });

    gl.disable(gl.BLEND);

    gl.useProgram(this.progBlur);
    this.setupQuad(this.progBlur);
    gl.viewport(0, 0, this.blurW, this.blurH);
    gl.uniform2f(this.locs.blur.res, this.blurW, this.blurH);
    gl.uniform1i(this.locs.blur.tex, 0);

    let readFBO = this.fboBase;
    let writeFBO = this.fboBlur1;

    for (let i = 0; i < this.BLUR_PASSES; i++) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, writeFBO.fb);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, readFBO.tex);
      gl.uniform1f(this.locs.blur.offset, (i * 1.5) + 1.0);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

      let temp = readFBO;
      readFBO = writeFBO;
      writeFBO = (temp === this.fboBase) ? this.fboBlur2 : temp;
    }

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, W, H);
    gl.useProgram(this.progOut);
    this.setupQuad(this.progOut);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, readFBO.tex);
    gl.uniform1i(this.locs.out.tex, 0);
    gl.uniform1f(this.locs.out.sat, 2.2);
    gl.uniform1f(this.locs.out.bri, 0.8 * transition);
    gl.uniform1f(this.locs.out.time, this.t);
    gl.uniform2f(this.locs.out.res, W, H);
    gl.uniform1f(this.locs.out.scale, 1.0);
    gl.uniform1f(this.locs.out.dither, 0.004);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

    this.rafId = requestAnimationFrame(this.draw);
  }

  stop() {
    this.loaded = false;
    if (this.rafId) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    if (this.resizeListener) {
      window.removeEventListener('resize', this.resizeListener);
      this.resizeListener = null;
    }
    const gl = this.gl;
    if (gl) {
      try {
        if (this.tex) { gl.deleteTexture(this.tex); this.tex = null; }
        if (this.buf) { gl.deleteBuffer(this.buf); this.buf = null; }
        if (this.fboBase) {
          gl.deleteFramebuffer(this.fboBase.fb);
          gl.deleteTexture(this.fboBase.tex);
          this.fboBase = null;
        }
        if (this.fboBlur1) {
          gl.deleteFramebuffer(this.fboBlur1.fb);
          gl.deleteTexture(this.fboBlur1.tex);
          this.fboBlur1 = null;
        }
        if (this.fboBlur2) {
          gl.deleteFramebuffer(this.fboBlur2.fb);
          gl.deleteTexture(this.fboBlur2.tex);
          this.fboBlur2 = null;
        }
      } catch (e) {
        console.warn("[Dybg] Error deleting WebGL resources on stop:", e);
      }
    }
  }
}
