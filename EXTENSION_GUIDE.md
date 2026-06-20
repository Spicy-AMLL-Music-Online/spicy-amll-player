# Spicy AMLL Player Extension Guide

Welcome to the Spicy AMLL Player extension guide! This guide will teach you how to create your own extensions to enhance the player.

## Table of Contents
1. [Extension Structure](#extension-structure)
2. [API Reference](#api-reference)
3. [Examples](#examples)

---

## Extension Structure

Every extension is a zip file that contains at least two files:

```
my-extension.zip/
├── config.json
└── script.js
```

### config.json
This file describes your extension. Here's what's required:

| Field | Type | Required? | Description |
|-------|------|-----------|-------------|
| id | string | Yes | Unique identifier for your extension (no spaces, lowercase) |
| name | string | Yes | Human-readable name |
| version | string | Yes | Semantic version (e.g., "1.0.0") |
| description | string | No | Short description of your extension |
| author | string | No | Your name or handle |
| tags | string[] | No | Array of tags to categorize your extension |

Example `config.json`:
```json
{
  "id": "my-extension",
  "name": "My Awesome Extension",
  "description": "Does cool things!",
  "version": "1.0.0",
  "author": "Your Name",
  "tags": ["utility", "lyrics"]
}
```

### script.js
This is where your extension logic lives. It has access to a special context with useful objects and functions.

---

## API Reference

When your `script.js` runs, it's executed with these parameters available:

### player
The main audio player object. You can control playback, get the current track, etc.

### settingsManager
The settings manager to read/write settings.
- `settingsManager.get(key)`: Get a setting value
- `settingsManager.set(key, value)`: Set a setting value

### getCurrentLyrics()
A helper function to get the currently loaded lyrics object.

### downloadFile(content, filename, mimeType)
A helper function to download files.
- `content`: The file content (string or BlobPart)
- `filename`: The filename for download
- `mimeType`: Optional MIME type (defaults to "text/plain")

---

## Examples

Here are several example extensions to help you get started!

### Example 1: Hello World
A simple extension that logs messages to the console.

`config.json`:
```json
{
  "id": "hello-world",
  "name": "Hello World",
  "description": "A simple extension that logs a message to the console",
  "version": "1.0.0",
  "author": "Example Author",
  "tags": ["example", "utility"]
}
```

`script.js`:
```javascript
console.log('Hello from Hello World extension!');
console.log('Player object:', player);
console.log('Settings manager:', settingsManager);
```

---

### Example 2: Lyrics Downloader
Adds a button to download lyrics in TTML, plain text, or LRC format.

See `extensions-examples/lyrics-downloader` for the full code!

---

### Example 3: Custom Lyrics Provider
Adds a new lyrics provider that fetches lyrics from an external API.

`config.json`:
```json
{
  "id": "custom-lyrics-provider",
  "name": "Custom Lyrics Provider",
  "description": "Adds a custom lyrics provider to fetch lyrics from MyLyricsAPI",
  "version": "1.0.0",
  "author": "Example Author",
  "tags": ["lyrics", "provider"]
}
```

`script.js`:
```javascript
console.log('Custom Lyrics Provider extension loaded!');

// We can hook into the player's lyric fetching logic (if available)
// For now, let's add a button to manually fetch from our custom provider!

function addCustomLyricsButton() {
  if (document.getElementById('custom-lyrics-btn')) return;

  const nowBar = document.getElementById('now-bar');
  if (!nowBar) return;

  const btn = document.createElement('button');
  btn.id = 'custom-lyrics-btn';
  btn.style.cssText = `
    background: rgba(255,255,255,0.1);
    border: none;
    color: white;
    padding: 8px 16px;
    border-radius: 8px;
    cursor: pointer;
    font-family: inherit;
    font-size: 13px;
    font-weight: 500;
    transition: background 0.2s ease;
  `;
  btn.textContent = 'Fetch Custom Lyrics';
  btn.onmouseenter = () => btn.style.background = 'rgba(255,255,255,0.15)';
  btn.onmouseleave = () => btn.style.background = 'rgba(255,255,255,0.1)';
  btn.onclick = fetchCustomLyrics;

  const settingsBtn = document.getElementById('btn-options');
  if (settingsBtn && settingsBtn.parentNode) {
    settingsBtn.parentNode.insertBefore(btn, settingsBtn.nextSibling);
  }
}

async function fetchCustomLyrics() {
  const metadata = window._spicySongMetadata;
  if (!metadata || !metadata.title || !metadata.artist) {
    alert('Please load a song first!');
    return;
  }

  try {
    alert('In a real extension, this would fetch lyrics from an API!');
    // Example API call:
    // const response = await fetch(`https://api.mylyrics.com/search?q=${encodeURIComponent(metadata.title + ' ' + metadata.artist)}`);
    // const data = await response.json();
    // Then parse into lyrics format...
  } catch (e) {
    console.error('Failed to fetch lyrics:', e);
    alert('Failed to fetch lyrics');
  }
}

addCustomLyricsButton();
setInterval(addCustomLyricsButton, 1000);
```

---

### Example 4: Custom Background Changer
Changes the background based on the current song's metadata.

`config.json`:
```json
{
  "id": "custom-background",
  "name": "Custom Background Changer",
  "description": "Changes the background color based on the current song",
  "version": "1.0.0",
  "author": "Example Author",
  "tags": ["ui", "background"]
}
```

`script.js`:
```javascript
let lastSongId = null;

function checkSongChange() {
  const metadata = window._spicySongMetadata;
  if (!metadata) return;

  const currentSongId = `${metadata.title}-${metadata.artist}`;
  if (currentSongId === lastSongId) return;

  lastSongId = currentSongId;
  changeBackground();
}

function changeBackground() {
  const colors = [
    'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
    'linear-gradient(135deg, #f093fb 0%, #f5576c 100%)',
    'linear-gradient(135deg, #4facfe 0%, #00f2fe 100%)',
    'linear-gradient(135deg, #43e97b 0%, #38f9d7 100%)',
    'linear-gradient(135deg, #fa709a 0%, #fee140 100%)'
  ];
  
  const randomColor = colors[Math.floor(Math.random() * colors.length)];
  const dynamicBg = document.getElementById('dynamic-bg');
  if (dynamicBg) {
    dynamicBg.style.background = randomColor;
  }
}

setInterval(checkSongChange, 500);
```

---

### Example 5: Lyrics Highlighter
Adds a custom highlight effect to currently playing lyrics.

`config.json`:
```json
{
  "id": "lyrics-highlighter",
  "name": "Lyrics Highlighter",
  "description": "Adds a custom highlight to active lyrics",
  "version": "1.0.0",
  "author": "Example Author",
  "tags": ["ui", "lyrics"]
}
```

`script.js`:
```javascript
function addCustomStyles() {
  if (document.getElementById('lyrics-highlighter-styles')) return;
  
  const style = document.createElement('style');
  style.id = 'lyrics-highlighter-styles';
  style.textContent = `
    .active-lyric-line {
      text-shadow: 0 0 20px rgba(255, 105, 180, 0.8) !important;
      color: #ff69b4 !important;
    }
  `;
  document.head.appendChild(style);
}

addCustomStyles();
```

---

### Example 6: Sleep Timer
Adds a sleep timer to stop playback after a certain time.

`config.json`:
```json
{
  "id": "sleep-timer",
  "name": "Sleep Timer",
  "description": "Adds a sleep timer to stop playback after a set time",
  "version": "1.0.0",
  "author": "Example Author",
  "tags": ["utility", "playback"]
}
```

`script.js`:
```javascript
let sleepTimerInterval = null;
let remainingTime = 0;

function addSleepTimerButton() {
  if (document.getElementById('sleep-timer-btn')) return;

  const nowBar = document.getElementById('now-bar');
  if (!nowBar) return;

  const btn = document.createElement('button');
  btn.id = 'sleep-timer-btn';
  btn.style.cssText = `
    background: rgba(255,255,255,0.1);
    border: none;
    color: white;
    padding: 8px 16px;
    border-radius: 8px;
    cursor: pointer;
    font-family: inherit;
    font-size: 13px;
    font-weight: 500;
    transition: background 0.2s ease;
  `;
  btn.textContent = 'Sleep Timer';
  btn.onmouseenter = () => btn.style.background = 'rgba(255,255,255,0.15)';
  btn.onmouseleave = () => btn.style.background = 'rgba(255,255,255,0.1)';
  btn.onclick = showSleepTimerMenu;

  const settingsBtn = document.getElementById('btn-options');
  if (settingsBtn && settingsBtn.parentNode) {
    settingsBtn.parentNode.insertBefore(btn, settingsBtn.nextSibling);
  }
}

function showSleepTimerMenu() {
  if (document.getElementById('sleep-timer-menu')) return;

  const menu = document.createElement('div');
  menu.id = 'sleep-timer-menu';
  menu.style.cssText = `
    position: fixed;
    background: rgba(30,30,30,0.95);
    backdrop-filter: blur(20px);
    border-radius: 12px;
    padding: 16px;
    box-shadow: 0 10px 40px rgba(0,0,0,0.5);
    z-index: 100000;
    min-width: 250px;
  `;

  menu.innerHTML = `
    <h3 style="color: white; margin: 0 0 12px 0;">Sleep Timer</h3>
    <div style="margin-bottom: 12px;">
      <label style="color: rgba(255,255,255,0.7); font-size: 13px;">Minutes:</label>
      <input type="number" id="sleep-timer-minutes" value="30" style="width: 100%; padding: 8px; border-radius: 8px; border: 1px solid rgba(255,255,255,0.2); background: rgba(255,255,255,0.05); color: white; margin-top: 4px;">
    </div>
    <button id="sleep-timer-start" style="width: 100%; padding: 10px; border-radius: 8px; border: none; background: linear-gradient(135deg, #fa709a 0%, #fee140 100%); color: white; font-weight: 600; cursor: pointer; margin-bottom: 8px;">Start Timer</button>
    <button id="sleep-timer-cancel" style="width: 100%; padding: 10px; border-radius: 8px; border: 1px solid rgba(255,255,255,0.2); background: transparent; color: white; cursor: pointer;">Cancel Timer</button>
    <div id="sleep-timer-status" style="color: rgba(255,255,255,0.7); font-size: 13px; margin-top: 8px;"></div>
  `;

  document.body.appendChild(menu);

  const btn = document.getElementById('sleep-timer-btn');
  const rect = btn.getBoundingClientRect();
  menu.style.left = `${rect.left}px`;
  menu.style.top = `${rect.bottom + 8}px`;

  document.getElementById('sleep-timer-start').onclick = startSleepTimer;
  document.getElementById('sleep-timer-cancel').onclick = cancelSleepTimer;

  setTimeout(() => {
    document.addEventListener('click', function closeMenu(e) {
      if (!menu.contains(e.target) && e.target !== btn) {
        menu.remove();
        document.removeEventListener('click', closeMenu);
      }
    });
  }, 0);
}

function startSleepTimer() {
  const minutesInput = document.getElementById('sleep-timer-minutes');
  const minutes = parseInt(minutesInput.value);
  
  if (isNaN(minutes) || minutes <= 0) {
    alert('Please enter a valid number of minutes');
    return;
  }

  remainingTime = minutes * 60;
  updateSleepTimerStatus();

  if (sleepTimerInterval) clearInterval(sleepTimerInterval);
  
  sleepTimerInterval = setInterval(() => {
    remainingTime--;
    updateSleepTimerStatus();
    
    if (remainingTime <= 0) {
      cancelSleepTimer();
      if (player && player.pause) {
        player.pause();
      }
      alert('Sleep timer ended! Playback stopped.');
    }
  }, 1000);

  const menu = document.getElementById('sleep-timer-menu');
  if (menu) menu.remove();
}

function cancelSleepTimer() {
  if (sleepTimerInterval) {
    clearInterval(sleepTimerInterval);
    sleepTimerInterval = null;
  }
  remainingTime = 0;
  updateSleepTimerStatus();
}

function updateSleepTimerStatus() {
  const statusEl = document.getElementById('sleep-timer-status');
  if (statusEl) {
    if (remainingTime > 0) {
      const mins = Math.floor(remainingTime / 60);
      const secs = remainingTime % 60;
      statusEl.textContent = `Remaining: ${mins}:${String(secs).padStart(2, '0')}`;
    } else {
      statusEl.textContent = '';
    }
  }
  
  const btn = document.getElementById('sleep-timer-btn');
  if (btn) {
    if (remainingTime > 0) {
      const mins = Math.floor(remainingTime / 60);
      const secs = remainingTime % 60;
      btn.textContent = `${mins}:${String(secs).padStart(2, '0')}`;
    } else {
      btn.textContent = 'Sleep Timer';
    }
  }
}

addSleepTimerButton();
setInterval(addSleepTimerButton, 1000);
```

---

### Example 7: Keyboard Shortcuts
Adds custom keyboard shortcuts.

`config.json`:
```json
{
  "id": "keyboard-shortcuts",
  "name": "Custom Keyboard Shortcuts",
  "description": "Adds extra keyboard shortcuts",
  "version": "1.0.0",
  "author": "Example Author",
  "tags": ["utility", "keyboard"]
}
```

`script.js`:
```javascript
document.addEventListener('keydown', (e) => {
  // Example: Press 'L' to toggle lyrics
  if (e.key === 'l' || e.key === 'L') {
    // Add your logic here
    console.log('L key pressed!');
  }
  
  // Example: Press 'N' for next track
  if (e.key === 'n' || e.key === 'N') {
    const nextBtn = document.getElementById('skip-forward');
    if (nextBtn) nextBtn.click();
  }
  
  // Example: Press 'P' for previous track
  if (e.key === 'p' || e.key === 'P') {
    const prevBtn = document.getElementById('btn-backward');
    if (prevBtn) prevBtn.click();
  }
});

console.log('Custom keyboard shortcuts loaded!');
```

---

## Packing Your Extension
Once you've created your `config.json` and `script.js`, zip them together! Make sure the files are in the root of the zip (not inside a subfolder).

Then you can install it in the player from the **Extensions** tab in settings!

Have fun creating extensions! 🎵
