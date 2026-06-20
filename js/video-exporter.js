/**
 * Spicy AMLL Player WEB — Video Exporter (DOM Capture Version)
 * Captures the actual page DOM for picture-perfect lyric videos.
 */

import { settingsManager } from './settings-manager.js';

export default class VideoExporter {
  constructor(audioPlayer) {
    this.audioPlayer = audioPlayer;
    this.recorder = null;
    this.chunks = [];
    this.isRecording = false;
    this.recordingOverlay = null; // We use PiP instead of DOM overlay now
    this.stream = null;

    // PiP Elements
    this.pipCanvas = document.createElement('canvas');
    this.pipCanvas.width = 400;
    this.pipCanvas.height = 120;
    this.pipVideo = document.createElement('video');
    this.pipVideo.muted = true;
    this.pipVideo.playsInline = true;
    this.pipVideo.style.display = 'none';
    document.body.appendChild(this.pipVideo);
  }

  async startExport(metadata) {
    if (this.isRecording) return;

    try {
      // 1. Enter Rendering State (Clean UI + Hide Mouse)
      document.body.classList.add('is-rendering');

      // 2. Prepare PiP Fallback (Just in case user wants to see progress)
      this.updatePipCanvas(0);
      this.pipVideo.srcObject = this.pipCanvas.captureStream();
      await this.pipVideo.play();

      // 3. Request Tab Capture with Cursor Hidden
      const displayStream = await navigator.mediaDevices.getDisplayMedia({
        video: {
          displaySurface: "browser",
          frameRate: 60,
          cursor: "never" // Primary way to hide mouse from capture
        },
        audio: false,
        preferCurrentTab: true,
        selfBrowserSurface: "include"
      });

      this.streamDest = this.audioPlayer.audioContext.createMediaStreamDestination();
      this.audioPlayer.masterGain.connect(this.streamDest);
      const audioStream = this.streamDest.stream;

      this.stream = new MediaStream([
        ...displayStream.getVideoTracks(),
        ...audioStream.getAudioTracks()
      ]);

      // 4. Request PiP Window (Needs to follow the selection gesture)
      try {
        await this.pipVideo.requestPictureInPicture();
      } catch (pipErr) {
        console.warn("PiP failed, falling back to silent recording.", pipErr);
      }

      this.recorder = new MediaRecorder(this.stream, {
        mimeType: 'video/webm;codecs=vp9',
        videoBitsPerSecond: 12000000 // 12 Mbps
      });

      this.recorder.ondataavailable = (e) => {
        if (e.data.size > 0) this.chunks.push(e.data);
      };

      this.recorder.onstop = () => {
        this.finishExport(metadata.title);
      };

      this.pipVideo.onleavepictureinpicture = () => {
        if (this.isRecording) this.stopExport();
      };
      this.stream.getVideoTracks()[0].onended = () => {
        if (this.isRecording) this.stopExport();
      };

      // UI & Starting
      this.audioPlayer.seek(0);
      this.chunks = [];
      this.isRecording = true;

      this.recorder.start();
      this.audioPlayer.play();

      this.monitorLoop();
    } catch (err) {
      console.error("Export failed:", err);
      this.stopExport();
      document.body.classList.remove('is-rendering');
      alert("Capture was cancelled or failed.");
    }
  }

  monitorLoop() {
    if (!this.isRecording) return;
    const time = this.audioPlayer.getPosition();
    const duration = this.audioPlayer.duration;
    const pct = Math.min((time / duration) * 100, 100);

    // Update PiP Canvas
    this.updatePipCanvas(pct);

    if (time >= duration || this.audioPlayer.audio.ended) {
      this.stopExport();
    } else {
      requestAnimationFrame(() => this.monitorLoop());
    }
  }

  updatePipCanvas(pct) {
    const ctx = this.pipCanvas.getContext('2d');
    const w = this.pipCanvas.width;
    const h = this.pipCanvas.height;

    // Background
    ctx.fillStyle = '#121212';
    ctx.fillRect(0, 0, w, h);

    // Pill
    const margin = 20;
    const pillH = 40;
    const pillY = h / 2 - pillH / 2;

    ctx.fillStyle = 'rgba(255,255,255,0.1)';
    ctx.beginPath();
    ctx.roundRect(margin, pillY, w - margin * 2, pillH, 20);
    ctx.fill();

    ctx.fillStyle = '#ff3b30';
    ctx.beginPath();
    ctx.roundRect(margin, pillY, (w - margin * 2) * (pct / 100), pillH, 20);
    ctx.fill();

    // Text
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 20px Outfit, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(`Recording Progress: ${Math.round(pct)}%`, w / 2, pillY - 15);
  }

  stopExport() {
    if (!this.isRecording) return;
    this.isRecording = false;
    this.audioPlayer.pause();
    this.recorder.stop();

    if (this.streamDest) {
      this.audioPlayer.masterGain.disconnect(this.streamDest);
      this.streamDest = null;
    }

    if (this.stream) {
      this.stream.getTracks().forEach(track => track.stop());
    }

    if (document.pictureInPictureElement) {
      document.exitPictureInPicture();
    }

    document.body.classList.remove('is-rendering');
  }

  finishExport(title) {
    const blob = new Blob(this.chunks, { type: 'video/webm' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${title || 'lyrics'}_spicy_render.webm`;
    a.click();
  }
}