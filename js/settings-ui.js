import { settingsManager, LYRICS_SOURCE_PROVIDER_DEFINITIONS } from "./settings-manager.js";
import { EQ_BANDS, EQ_PRESETS } from "./equalizer-presets.js";
import { generateTTML } from "./ttml-parser.js";
import { LyricsObject, convertToSyllable } from "./lyrics-applyer.js";
import { GeniusService } from "./genius-service.js";
import { getQueue, getCurrentIndex } from "./router.js";
import { escapeHTML } from "./security-utils.js";
import extensionManager from "./extensions.js";

/**
 * settings-ui.js
 * Handles the creation and management of the settings modal.
 */

const TABS = [
  { 
    id: "appearance", 
    label: "Appearance", 
    icon: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22C17.5228 22 22 17.5228 22 12C22 6.47715 17.5228 2 12 2C6.47715 2 2 6.47715 2 12C2 14.725 3.09 17.2 4.86 19A2 2 0 0 1 5.5 20.8V21a1 1 0 0 0 1 1h5.8Z"/><circle cx="7.5" cy="10.5" r="1.5" fill="currentColor"/><circle cx="11.5" cy="7.5" r="1.5" fill="currentColor"/><circle cx="16.5" cy="9.5" r="1.5" fill="currentColor"/></svg>` 
  },
  { 
    id: "playback", 
    label: "Playback & Audio", 
    icon: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>` 
  },
  { 
    id: "lyrics", 
    label: "Lyrics & Sources", 
    icon: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/><path d="M8 7h8M8 11h8"/></svg>` 
  },
  { 
    id: "extensions", 
    label: "Extensions", 
    icon: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/></svg>` 
  },
  { 
    id: "advanced", 
    label: "Advanced & Tools", 
    icon: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>` 
  },
  {
    id: "developer",
    label: "Developer",
    icon: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>`
  }
];

class SettingsUI {
  constructor() {
    this.modal = null;
    this.overlay = null;
    this.activeTab = "appearance";
  }

  async show() {
    if (document.querySelector(".SpicyLyricsSettingsOverlay")) return;

    this.overlay = document.createElement("div");
    this.overlay.className = "SpicyLyricsSettingsOverlay";
    this.overlay.onclick = () => this.hide();

    this.modal = document.createElement("div");
    this.modal.className = "SpicyLyricsSettingsContainer";
    this.modal.onclick = (e) => e.stopPropagation();

    // Header
    const header = document.createElement("div");
    header.className = "SpicyLyricsSettingsHeader";
    header.innerHTML = `
      <span>Player Settings</span>
      <button class="SpicyLyricsSettingsHeaderClose">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="18" height="18">
          <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
        </svg>
      </button>
    `;
    header.querySelector(".SpicyLyricsSettingsHeaderClose").onclick = () => this.hide();
    this.modal.appendChild(header);

    // Tabbed Layout Container
    const mainBody = document.createElement("div");
    mainBody.className = "SpicyLyricsSettingsMainBody";

    // Sidebar
    const sidebar = document.createElement("div");
    sidebar.className = "SpicyLyricsSettingsSidebar";

    // Content Scroll Area
    const content = document.createElement("div");
    content.className = "SpicyLyricsSettingsContent";

    const panels = {};
    TABS.forEach(tab => {
      const panel = document.createElement("div");
      panel.className = `SpicyLyricsSettingsPanel panel-${tab.id}`;
      panel.style.display = tab.id === this.activeTab ? "block" : "none";
      content.appendChild(panel);
      panels[tab.id] = panel;
    });

    // Sidebar Tabs
    TABS.forEach(tab => {
      const btn = document.createElement("button");
      btn.className = `sl-sidebar-tab ${tab.id === this.activeTab ? "active" : ""}`;
      btn.innerHTML = `${tab.icon} <span>${tab.label}</span>`;
      btn.dataset.tabId = tab.id;

      if (tab.id === "developer") {
        btn.style.display = settingsManager.get("developerMode") ? "flex" : "none";
      }

      btn.onclick = async () => {
        this.activeTab = tab.id;
        sidebar.querySelectorAll(".sl-sidebar-tab").forEach(b => b.classList.remove("active"));
        btn.classList.add("active");
        Object.keys(panels).forEach(id => {
          panels[id].style.display = id === tab.id ? "block" : "none";
        });

        // If tab is extensions, re-render!
        if (tab.id === "extensions") {
          panels.extensions.innerHTML = '';
          await this.renderExtensions(panels.extensions);
        }
      };
      sidebar.appendChild(btn);
    });

    mainBody.appendChild(sidebar);
    mainBody.appendChild(content);
    this.modal.appendChild(mainBody);

    // Render inside active panels
    this.renderAppearance(panels.appearance);
    this.renderPlayback(panels.playback);
    this.renderLyrics(panels.lyrics);
    await this.renderExtensions(panels.extensions); // await renderExtensions!
    this.renderAdvanced(panels.advanced);
    this.renderDeveloper(panels.developer);

    this.overlay.appendChild(this.modal);
    document.body.appendChild(this.overlay);

    // Trigger open animation
    setTimeout(() => {
      this.overlay.classList.add("active");
      this.modal.classList.add("active");
    }, 10);
  }

  hide() {
    if (!this.overlay) return;
    this.overlay.classList.remove("active");
    this.modal.classList.remove("active");
    setTimeout(() => {
      if (this.overlay) {
        this.overlay.remove();
        this.overlay = null;
        this.modal = null;
      }
    }, 300);
  }

  createCard(container) {
    const card = document.createElement("div");
    card.className = "sl-settings-card";
    container.appendChild(card);
    return card;
  }

  addGroup(container, title) {
    const h = document.createElement("h3");
    h.className = "sl-settings-group";
    h.textContent = title;
    container.appendChild(h);
  }

  addRow(container, label, description, control, extraClass = "", hidden = false) {
    const row = document.createElement("div");
    row.className = `sl-settings-row ${extraClass}`;
    if (hidden) row.style.display = "none";

    const meta = document.createElement("div");
    meta.className = "sl-settings-meta";

    const lbl = document.createElement("span");
    lbl.className = "sl-settings-label";
    lbl.textContent = label;
    meta.appendChild(lbl);

    if (description) {
      const desc = document.createElement("span");
      desc.className = "sl-settings-description";
      desc.textContent = description;
      meta.appendChild(desc);
    }

    row.appendChild(meta);
    row.appendChild(control);
    container.appendChild(row);
    return row;
  }

  addToggle(container, label, description, key, callback) {
    const wrap = document.createElement("label");
    wrap.className = "sl-toggle";
    const input = document.createElement("input");
    input.type = "checkbox";
    input.checked = settingsManager.get(key);
    input.onchange = () => {
      settingsManager.set(key, input.checked);
      if (callback) callback(input.checked);
    };
    const knob = document.createElement("span");
    wrap.appendChild(input);
    wrap.appendChild(knob);
    this.addRow(container, label, description, wrap);
  }

  addInput(container, label, description, key, extraClass = "", hidden = false) {
    const input = document.createElement("input");
    input.type = "text";
    input.className = "sl-input";
    input.value = settingsManager.get(key);
    input.oninput = () => {
      settingsManager.set(key, input.value);
    };
    this.addRow(container, label, description, input, extraClass, hidden);
  }

  addSlider(container, label, description, key, min, max, step, formatCallback) {
    const currentVal = settingsManager.get(key) ?? min;

    const wrap = document.createElement("div");
    wrap.className = "sl-slider-wrap";

    const valueLabel = document.createElement("span");
    valueLabel.className = "sl-slider-value";
    valueLabel.textContent = formatCallback ? formatCallback(currentVal) : currentVal;

    const slider = document.createElement("input");
    slider.type = "range";
    slider.className = "sl-range-slider";
    slider.min = min;
    slider.max = max;
    slider.step = step;
    slider.value = currentVal;

    slider.oninput = () => {
      const v = parseFloat(slider.value);
      valueLabel.textContent = formatCallback ? formatCallback(v) : v;
      settingsManager.set(key, v);
    };

    wrap.appendChild(valueLabel);
    wrap.appendChild(slider);
    this.addRow(container, label, description, wrap);
  }

  addDropdown(container, label, description, key, options) {
    const sel = document.createElement("select");
    sel.className = "sl-select";
    options.forEach(opt => {
      const o = document.createElement("option");
      o.value = opt;
      o.textContent = opt;
      if (opt === settingsManager.get(key)) o.selected = true;
      sel.appendChild(o);
    });
    sel.onchange = () => {
      settingsManager.set(key, sel.value);
    };
    this.addRow(container, label, description, sel);
  }

  renderAppearance(container) {
    this.addGroup(container, "Typography");
    const fontCard = this.createCard(container);
    this.addToggle(fontCard, "Custom Font", "Use a custom font face instead of the default typography.", "customFontEnabled", (val) => {
      const fontInputRow = container.querySelector(".font-input-row");
      if (fontInputRow) fontInputRow.style.display = val ? "flex" : "none";
    });
    this.addInput(fontCard, "Font name / URL", "Specify local font name or web font stylesheet link.", "customFont", "font-input-row", !settingsManager.get("customFontEnabled"));


    this.addGroup(container, "Lyrics Layout & Style");
    const lyricsStyleCard = this.createCard(container);
    this.addToggle(lyricsStyleCard, "Right Align Lyrics", "Align lyric lines to the right edge of the screen.", "rightAlignLyrics");
    this.addToggle(lyricsStyleCard, "AML Lyrics Style", "Enable dynamic Apple Music-style lyrics animations.", "amlLyricsAnimations");
    this.addDropdown(lyricsStyleCard, "Meme Format Override", "Apply funny formatting to current lyrics.", "memeFormat", ["Off", "UPPERCASE", "lowercase", "Weeb (・`ω´・)", "Gibberish (Wenomechainsama)"]);
    this.addToggle(lyricsStyleCard, "Simple Lyrics Mode", "Use a lighter, simplified renderer for lyrics rendering.", "simpleLyricsMode");
    this.addToggle(lyricsStyleCard, "AML Stagger Scrolling", "Make lyric lines scroll up smoothly with staggered spacing.", "amlAnimation");

    this.addGroup(container, "Credits & Info");
    const creditsCard = this.createCard(container);
    this.addDropdown(creditsCard, "Release Year Position", "Where to display the album/track release year.", "releaseYearPosition", ["Off", "Before Artist", "After Artist"]);
    this.addToggle(creditsCard, "Show Songwriters", "Display songwriter credits at the end of the song.", "showSongwriters");

    this.addGroup(container, "Word-Sync Alignment");
    const syncCard = this.createCard(container);
    this.addToggle(syncCard, "Force Word Sync", "Force syllabic word synchronization on loaded tracks.", "forceWordSync");
    this.addToggle(syncCard, "Fix Syllable Spacing", "Trim trailing and leading spaces from individual syllables.", "trimSyllableSpaces");
  }

  renderPlayback(container) {
    this.addGroup(container, "Aesthetic Badges");
    const badgeCard = this.createCard(container);
    this.addToggle(badgeCard, "Dolby Atmos Icon", "Display Dolby Atmos badge in the playbar.", "dolbyAtmos");
    this.addToggle(badgeCard, "AirPods Icon", "Show AirPods indicator instead of standard audio badge.", "airPodsIcon");
    this.addInput(badgeCard, "Bluetooth Device Name", "Custom name next to the AirPods status icon.", "bluetoothDeviceName");
    this.addToggle(badgeCard, "Hide Lyrics Provider Box", "Hide the lyrics source attribution badge.", "hideLyricsProvider");

    this.addGroup(container, "Backgrounds & Videos");
    const bgCard = this.createCard(container);
    this.addToggle(bgCard, "Animated Art Video", "Play animated album cover art videos when available.", "coverArtAnimation");

    this.addGroup(container, "Audio Engine Settings");
    const audioCard = this.createCard(container);
    this.addSlider(audioCard, "Crossfade duration", "Blend tracks smoothly at transition points.", "crossfadeDuration", 0, 10, 0.5, (v) => {
      return v === 0 ? "Off" : `${v}s`;
    });

    this.addGroup(container, "Sleek Mixing Board (Equalizer)");
    const eqCard = this.createCard(container);
    this.renderEqualizerInline(eqCard);
  }

  renderEqualizerInline(container) {
    const presetRow = document.createElement("div");
    presetRow.className = "sl-eq-preset-row";
    presetRow.innerHTML = `<span class="sl-eq-preset-label">EQ Preset:</span>`;
    
    const sel = document.createElement("select");
    sel.className = "sl-select";
    
    Object.keys(EQ_PRESETS).forEach(p => {
      const o = document.createElement("option");
      o.value = p; o.textContent = p;
      sel.appendChild(o);
    });
    presetRow.appendChild(sel);
    container.appendChild(presetRow);

    const slidersContainer = document.createElement("div");
    slidersContainer.className = "sl-eq-sliders-container";
    container.appendChild(slidersContainer);

    const currentGains = settingsManager.get("eqGains") || [0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
    const sliders = [];

    EQ_BANDS.forEach((freq, i) => {
      const col = document.createElement("div");
      col.className = "sl-eq-band-col";

      const valLabel = document.createElement("span");
      valLabel.className = "sl-eq-val-label";
      const val = currentGains[i] ?? 0;
      valLabel.textContent = val > 0 ? `+${val}` : val;

      const slider = document.createElement("input");
      slider.type = "range";
      slider.className = "sl-eq-slider";
      slider.setAttribute("orient", "vertical");
      slider.min = "-12";
      slider.max = "12";
      slider.step = "1";
      slider.value = val;

      const freqLabel = document.createElement("span");
      freqLabel.className = "sl-eq-freq-label";
      freqLabel.textContent = freq >= 1000 ? `${freq / 1000}k` : freq;

      slider.oninput = () => {
        valLabel.textContent = slider.value > 0 ? `+${slider.value}` : slider.value;
        const newGains = [...(settingsManager.get("eqGains") || [0, 0, 0, 0, 0, 0, 0, 0, 0, 0])];
        newGains[i] = parseInt(slider.value, 10);
        settingsManager.set("eqGains", newGains);
      };

      sliders.push(slider);
      col.appendChild(valLabel);
      col.appendChild(slider);
      col.appendChild(freqLabel);
      slidersContainer.appendChild(col);
    });

    sel.onchange = () => {
      const preset = EQ_PRESETS[sel.value];
      if (preset) {
        settingsManager.set("eqGains", [...preset]);
        preset.forEach((gain, i) => {
          if (sliders[i]) {
            sliders[i].value = gain;
            const label = sliders[i].previousSibling;
            if (label) label.textContent = gain > 0 ? `+${gain}` : gain;
          }
        });
      }
    };
  }

  renderLyrics(container) {
    this.addGroup(container, "Preferred Language");
    const langCard = this.createCard(container);
    this.addDropdown(langCard, "Preferred Language", "Fallback language used during track search queries.", "language", ["en-US", "zh-CN", "ja-JP", "es-ES", "ko-KR", "fr-FR"]);

    this.addGroup(container, "Lyrics Providers");
    const providerCard = this.createCard(container);

    const providerBtn = document.createElement("button");
    providerBtn.className = "sl-btn";
    providerBtn.textContent = "Manage Provider Order";
    providerBtn.onclick = () => this.showProviderManager();

    this.addRow(providerCard, "Provider Priority", "Reorder or disable search priority for lyrics sources.", providerBtn);
    this.addToggle(providerCard, "Ignore Musixmatch Word Sync", "Skip unstable word-sync lines from Musixmatch.", "ignoreMusixmatchWordSync");
    this.addToggle(providerCard, "Prioritize Apple Music Quality", "Pre-fetch premium Apple Music synced tracks.", "prioritizeAppleMusicQuality");
  }

  showExtensionGuide() {
    const guideOverlay = document.createElement('div');
    guideOverlay.className = 'SpicyLyricsSettingsOverlay';
    guideOverlay.onclick = () => guideOverlay.remove();

    const guideModal = document.createElement('div');
    guideModal.className = 'SpicyLyricsSettingsContainer';
    guideModal.style.maxWidth = '900px';
    guideModal.style.width = '100%';
    guideModal.onclick = (e) => e.stopPropagation();

    const header = document.createElement('div');
    header.className = 'SpicyLyricsSettingsHeader';
    header.innerHTML = `
      <span>Extension Guide</span>
      <button class="SpicyLyricsSettingsHeaderClose">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="18" height="18">
          <line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line>
        </svg>
      </button>
    `;
    header.querySelector('.SpicyLyricsSettingsHeaderClose').onclick = () => guideOverlay.remove();
    guideModal.appendChild(header);

    const contentScroll = document.createElement('div');
    contentScroll.className = 'SpicyLyricsSettingsContent'; // Use the existing content class that already scrolls!
    contentScroll.style.padding = '24px 28px';

    contentScroll.innerHTML = `
      <div style="color: white; line-height: 1.7;">
        <h1 style="color: white; margin-top: 0;">Spicy AMLL Player Extension Guide</h1>
        
        <h2 style="color: #ff69b4;">Extension Structure</h2>
        <p>Every extension is a zip file with at least two files:</p>
        <pre style="background: rgba(0,0,0,0.3); padding: 12px; border-radius: 8px; overflow-x: auto;">
my-extension.zip/
├── config.json
└── script.js</pre>

        <h3 style="color: #ff69b4;">config.json</h3>
        <p>Describes your extension:</p>
        <pre style="background: rgba(0,0,0,0.3); padding: 12px; border-radius: 8px;">
{
  "id": "my-extension",
  "name": "My Awesome Extension",
  "description": "Does cool things!",
  "version": "1.0.0",
  "author": "Your Name",
  "tags": ["utility", "lyrics"]
}</pre>

        <h3 style="color: #ff69b4;">script.js</h3>
        <p>Your extension's code! It has access to:</p>
        <ul style="margin-left: 20px;">
          <li><code style="background: rgba(0,0,0,0.3); padding: 2px 6px; border-radius: 4px;">player</code>: The audio player object</li>
          <li><code style="background: rgba(0,0,0,0.3); padding: 2px 6px; border-radius: 4px;">settingsManager</code>: Read/write settings</li>
          <li><code style="background: rgba(0,0,0,0.3); padding: 2px 6px; border-radius: 4px;">getCurrentLyrics()</code>: Get currently loaded lyrics</li>
          <li><code style="background: rgba(0,0,0,0.3); padding: 2px 6px; border-radius: 4px;">downloadFile()</code>: Helper to download files</li>
        </ul>

        <h2 style="color: #ff69b4; margin-top: 24px;">Examples</h2>
        <p>Check out the <code style="background: rgba(0,0,0,0.3); padding: 2px 6px; border-radius: 4px;">extensions-examples/</code> folder for 7 ready-to-use examples:</p>
        <ul style="margin-left: 20px;">
          <li>Hello World (simple example)</li>
          <li>Lyrics Downloader</li>
          <li>Custom Lyrics Provider</li>
          <li>Custom Background Changer</li>
          <li>Lyrics Highlighter</li>
          <li>Sleep Timer</li>
          <li>Keyboard Shortcuts</li>
          <li>Playlist Exporter</li>
        </ul>

        <h2 style="color: #ff69b4; margin-top: 24px;">Packing Your Extension</h2>
        <p>Zip your <code style="background: rgba(0,0,0,0.3); padding: 2px 6px; border-radius: 4px;">config.json</code> and <code style="background: rgba(0,0,0,0.3); padding: 2px 6px; border-radius: 4px;">script.js</code> together (make sure they're in the root of the zip, not a subfolder)!</p>

        <p style="margin-top: 24px; opacity: 0.8;">For the full guide, see <code style="background: rgba(0,0,0,0.3); padding: 2px 6px; border-radius: 4px;">EXTENSION_GUIDE.md</code> in the project folder!</p>
      </div>
    `;

    guideModal.appendChild(contentScroll);
    guideOverlay.appendChild(guideModal);
    document.body.appendChild(guideOverlay);

    setTimeout(() => {
      guideOverlay.classList.add('active');
      guideModal.classList.add('active');
    }, 10);
  }

  async renderExtensions(container) {
    this.addGroup(container, "Install Extensions");
    const installCard = this.createCard(container);

    const guideBtn = document.createElement('button');
    guideBtn.className = 'sl-btn';
    guideBtn.style.marginBottom = '16px';
    guideBtn.style.width = '100%';
    guideBtn.textContent = '📚 How do I make an extension?';
    guideBtn.onclick = () => this.showExtensionGuide();
    installCard.appendChild(guideBtn);

    const uploadArea = document.createElement('div');
    uploadArea.className = 'am-upload-area';
    uploadArea.style.padding = '20px';
    uploadArea.style.background = 'rgba(255,255,255,0.05)';
    uploadArea.style.borderRadius = '12px';
    uploadArea.style.border = '2px dashed rgba(255,255,255,0.2)';
    uploadArea.innerHTML = `
      <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55C7.79 13, 6 14.79, 6 17s1.79 4, 4 4, 4-1.79, 4-4V7h4V3h-6z"/>
      </svg>
      <p style="margin-top: 12px; margin-bottom: 8px;">Drop extension zip here, or click to browse</p>
      <p style="font-size: 12px; opacity: 0.6;">Extensions must contain config.json and script.js</p>
      <input type="file" id="extension-upload" accept=".zip" style="display: none;"/>
    `;
    uploadArea.onclick = () => document.getElementById('extension-upload').click();
    uploadArea.ondragover = (e) => { e.preventDefault(); uploadArea.style.borderColor = "rgba(255,255,255,0.5)"; };
    uploadArea.ondragleave = (e) => { e.preventDefault(); uploadArea.style.borderColor = "rgba(255,255,255,0.2)"; };
    uploadArea.ondrop = async (e) => {
      e.preventDefault();
      uploadArea.style.borderColor = "rgba(255,255,255,0.2)";
      if (e.dataTransfer.files.length > 0) {
        await this.handleExtensionUpload(e.dataTransfer.files[0], container);
      }
    };
    const fileInput = uploadArea.querySelector('#extension-upload');
    fileInput.onchange = async (e) => {
      if (e.target.files.length > 0) {
        await this.handleExtensionUpload(e.target.files[0], container);
      }
    };
    installCard.appendChild(uploadArea);

    this.addGroup(container, "Installed Extensions");
    const listContainer = this.createCard(container);
    listContainer.id = "extensions-list";

    // Load extensions from storage before rendering!
    await extensionManager.loadFromStorage();
    console.log('[Extensions UI] Loaded extensions:', extensionManager.extensions);
    this.renderExtensionsList(listContainer);
  }

  async handleExtensionUpload(file, container) {
    try {
      await extensionManager.loadExtensionFromZip(file);
      const listContainer = container.querySelector('#extensions-list');
      this.renderExtensionsList(listContainer);
    } catch (err) {
      console.error(err);
      alert('Failed to install extension: ' + err.message);
    }
  }

  renderExtensionsList(container) {
    container.innerHTML = '';

    if (extensionManager.extensions.length === 0) {
      container.innerHTML = `<p style="padding: 20px; text-align: center; opacity: 0.6;">No extensions installed yet</p>`;
      return;
    }

    extensionManager.extensions.forEach((ext, i) => {
      const extCard = document.createElement('div');
      extCard.className = 'sl-settings-row';
      extCard.style.padding = '15px';
      extCard.style.background = 'rgba(255,255,255,0.05)';
      extCard.style.borderRadius = '8px';
      extCard.style.marginBottom = '8px';

      extCard.innerHTML = `
        <div style="flex: 1;">
          <div style="font-weight: 600; font-size: 14px;">${escapeHTML(ext.name)} <span style="font-weight: normal; opacity: 0.6; font-size: 12px;">v${escapeHTML(ext.version)}</span></div>
          ${ext.description ? `<div style="font-size: 12px; opacity: 0.6; margin-top: 4px;">${escapeHTML(ext.description)}</div>` : ''}
          ${ext.author ? `<div style="font-size: 11px; opacity: 0.5; margin-top: 2px;">by ${escapeHTML(ext.author)}</div>` : ''}
          ${ext.tags && ext.tags.length > 0 ? `<div style="margin-top: 6px;">${ext.tags.map(tag => `<span style="display: inline-block; padding: 2px 8px; background: rgba(255,255,255,0.1); border-radius: 100px; font-size: 11px; margin-right: 4px; margin-top: 2px;">${escapeHTML(tag)}</span>`).join('')}</div>` : ''}
        </div>
        <div style="display: flex; gap: 8px; align-items: center;">
          <label class="sl-toggle" style="margin-right: 8px;">
            <input type="checkbox" ${ext.enabled ? 'checked' : ''} />
            <span></span>
          </label>
          <button class="sl-btn-small" style="padding: 4px 12px; font-size: 12px;">Remove</button>
        </div>
      `;

      const toggle = extCard.querySelector('input[type="checkbox"]');
      toggle.onchange = async () => {
        ext.enabled = toggle.checked;
        await extensionManager.saveExtension(ext);
        if (ext.enabled) {
          extensionManager._executeExtension(ext);
        }
      };

      const removeBtn = extCard.querySelector('button');
      removeBtn.onclick = async () => {
        if (confirm('Are you sure you want to remove this extension?')) {
          await extensionManager.deleteExtension(ext.id);
          this.renderExtensionsList(container);
        }
      };

      container.appendChild(extCard);
    });
  }

  renderAdvanced(container) {
    this.addGroup(container, "Render Performance");
    const perfCard = this.createCard(container);
    this.addToggle(perfCard, "GPU Acceleration Hack", "Enable translate3d layer compositions to reduce animation stutter.", "hardwareAccelerationHack");

    this.addGroup(container, "Canvas Backdrop");
    const bgCard = this.createCard(container);
    this.addToggle(bgCard, "Disable Canvas Background", "Turn off CPU/GPU dynamic canvas backdrop animations.", "hide_npv_bg");
    this.addDropdown(bgCard, "Static Background Type", "Fallback background style when dynamic background is off.", "staticBackgroundType", ["Auto", "Album Art"]);

    this.addGroup(container, "Lyrics Export Utilities");
    const exportCard = this.createCard(container);

    const exportTTMLBtn = document.createElement("button");
    exportTTMLBtn.className = "sl-btn";
    exportTTMLBtn.textContent = "Export Word-Sync TTML";
    exportTTMLBtn.onclick = () => this.handleTTMLExport(exportTTMLBtn);
    this.addRow(exportCard, "TTML Export", "Convert current song lyrics into Word-Sync TTML format.", exportTTMLBtn);

    const exportBtn = document.createElement("button");
    exportBtn.className = "sl-btn sl-btn-accent";
    exportBtn.textContent = "Start Video Render";
    exportBtn.onclick = () => {
      this.hide();
      window.dispatchEvent(new CustomEvent("spicy-export-video"));
    };
    this.addRow(exportCard, "Export Video Movie", "Beta utility to export full synchronized song videos.", exportBtn);

    this.addGroup(container, "Developer Mode");
    const devCard = this.createCard(container);
    this.addToggle(devCard, "Developer Mode", "Enable developer tools, custom timings, and testing utilities.", "developerMode", (val) => {
      const devTabBtn = this.modal.querySelector('.sl-sidebar-tab[data-tab-id="developer"]');
      if (devTabBtn) {
        devTabBtn.style.display = val ? "flex" : "none";
      }
    });
  }

  async handleTTMLExport(btn) {
    const originalText = btn.textContent;
    btn.textContent = "Processing...";
    btn.disabled = true;

    try {
      const data = LyricsObject.RawData;
      if (!data) {
        alert("No lyrics loaded to export.");
        return;
      }

      // 1. Determine Track Metadata for filename
      const queue = await getQueue();
      const index = getCurrentIndex();
      const track = queue[index] || { name: "Lyrics", artist: "Unknown" };
      const filename = `${track.name} - ${track.artist}.ttml`.replace(/[<>:"/\\|?*]/g, "");

      let exportData = { ...data };

      // 2. Fetch Genius Songwriters if missing
      if (!exportData.SongWriters || exportData.SongWriters.length === 0) {
        const writers = await GeniusService.fetchCredits({ title: track.name, artist: track.artist });
        if (writers && writers.length > 0) {
          exportData.SongWriters = writers;
        }
      }

      // 3. Convert to Word-Sync if it's currently Line-Sync
      if (exportData.Type === "Line") {
        console.log("[Export] Converting Line lyrics to Syllable (guessing durations)...");
        exportData = convertToSyllable(exportData);
      }

      // 4. Generate TTML
      const ttml = generateTTML(exportData);

      // 5. Trigger Download
      const blob = new Blob([ttml], { type: "application/ttml+xml" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      btn.textContent = "✓ Exported!";
      setTimeout(() => {
        btn.textContent = originalText;
        btn.disabled = false;
      }, 2000);

    } catch (err) {
      console.error("[Export] Failed:", err);
      alert("Export failed: " + err.message);
      btn.textContent = "Error";
      setTimeout(() => {
        btn.textContent = originalText;
        btn.disabled = false;
      }, 2000);
    }
  }

  showProviderManager() {
    const pmOverlay = document.createElement("div");
    pmOverlay.className = "SpicyLyricsSettingsOverlay active";
    pmOverlay.style.zIndex = "10001";
    pmOverlay.onclick = () => pmOverlay.remove();

    const pmModal = document.createElement("div");
    pmModal.className = "SpicyLyricsSettingsContainer active";
    pmModal.style.width = "90%";
    pmModal.style.maxWidth = "500px";
    pmModal.onclick = (e) => e.stopPropagation();

    const header = document.createElement("div");
    header.className = "SpicyLyricsSettingsHeader";
    header.innerHTML = `
      <span>Manage Providers</span>
      <div style="display:flex; gap:8px;">
        <button class="reset-providers-btn" style="background:none; border:none; color:inherit; cursor:pointer; font-size:13px; padding:4px 12px; border-radius:6px; background:rgba(255,255,255,0.1);">Reset</button>
        <button class="pm-close" style="background:none; border:none; color:inherit; cursor:pointer; font-size:20px;">✕</button>
      </div>
    `;
    header.querySelector(".pm-close").onclick = () => pmOverlay.remove();
    header.querySelector(".reset-providers-btn").onclick = () => {
      settingsManager.set("lyricsSourceOrder", [...DEFAULT_LYRICS_SOURCE_ORDER]);
      settingsManager.set("disabledLyricsSources", []);
      renderList();
    };
    pmModal.appendChild(header);

    const scroll = document.createElement("div");
    scroll.className = "SpicyLyricsSettingsScroll";
    pmModal.appendChild(scroll);

    const renderList = () => {
      scroll.innerHTML = "";
      const order = settingsManager.get("lyricsSourceOrder");
      const disabled = settingsManager.get("disabledLyricsSources");

      order.forEach((id, index) => {
        const def = LYRICS_SOURCE_PROVIDER_DEFINITIONS[id];
        const row = document.createElement("div");
        row.className = "sl-settings-row";
        row.style.padding = "10px 15px";
        row.style.background = "rgba(255,255,255,0.05)";
        row.style.borderRadius = "8px";
        row.style.marginBottom = "8px";
        row.style.display = "flex";
        row.style.justifyContent = "space-between";
        row.style.alignItems = "center";

        const labelWrap = document.createElement("div");
        labelWrap.style.display = "flex";
        labelWrap.style.flexDirection = "column";
        labelWrap.innerHTML = `
          <span style="font-weight:600; font-size: 14px;">${index + 1}. ${escapeHTML(def.label)}</span>
          <span style="font-size: 11px; opacity: 0.6;">${escapeHTML(def.description)}</span>
        `;

        const actions = document.createElement("div");
        actions.style.display = "flex";
        actions.style.gap = "8px";
        actions.style.alignItems = "center";

        // Up/Down Buttons
        const createBtn = (text, disabled, cb) => {
          const b = document.createElement("button");
          b.className = "sl-btn-small";
          b.style.padding = "4px 8px";
          b.style.fontSize = "12px";
          b.textContent = text;
          b.disabled = disabled;
          b.onclick = cb;
          return b;
        };

        const upBtn = createBtn("↑", index === 0, () => {
          const newOrder = [...order];
          [newOrder[index], newOrder[index - 1]] = [newOrder[index - 1], newOrder[index]];
          settingsManager.set("lyricsSourceOrder", newOrder);
          renderList();
        });

        const downBtn = createBtn("↓", index === order.length - 1, () => {
          const newOrder = [...order];
          [newOrder[index], newOrder[index + 1]] = [newOrder[index + 1], newOrder[index]];
          settingsManager.set("lyricsSourceOrder", newOrder);
          renderList();
        });

        const isOff = disabled.includes(id);
        const toggle = createBtn(isOff ? "Off" : "On", false, () => {
          let newDisabled = [...disabled];
          if (isOff) {
            newDisabled = newDisabled.filter(d => d !== id);
          } else {
            newDisabled.push(id);
          }
          settingsManager.set("disabledLyricsSources", newDisabled);
          renderList();
        });
        if (isOff) toggle.style.opacity = "0.5";

        actions.appendChild(upBtn);
        actions.appendChild(downBtn);
        actions.appendChild(toggle);

        row.appendChild(labelWrap);
        row.appendChild(actions);
        scroll.appendChild(row);
      });
    };

    renderList();
    pmOverlay.appendChild(pmModal);
    document.body.appendChild(pmOverlay);
  }

  showTTMLTester() {
    const testerOverlay = document.createElement("div");
    testerOverlay.className = "SpicyLyricsSettingsOverlay active";
    testerOverlay.style.zIndex = "999999";
    testerOverlay.style.background = "rgba(0,0,0,0.95)";

    const testerModal = document.createElement("div");
    testerModal.className = "SpicyLyricsSettingsContainer active";
    testerModal.style.width = "800px";
    testerModal.style.maxWidth = "95%";
    testerModal.onclick = (e) => e.stopPropagation();

    const header = document.createElement("div");
    header.className = "SpicyLyricsSettingsHeader";
    header.innerHTML = `
      <span>TTML Tester</span>
      <button class="tester-close" style="background:none; border:none; color:inherit; cursor:pointer; font-size:20px;">✕</button>
    `;
    header.querySelector(".tester-close").onclick = () => testerOverlay.remove();
    testerModal.appendChild(header);

    const content = document.createElement("div");
    content.className = "SpicyLyricsSettingsScroll";
    content.style.padding = "20px";
    content.innerHTML = `
      <div style="display:flex; flex-direction:column; gap:16px;">
        <div>
          <label style="color:white; font-weight:500; display:block; margin-bottom:8px;">Upload TTML File</label>
          <input type="file" id="ttml-tester-input" accept=".ttml,.xml" style="width:100%; padding:10px; border-radius:8px; border:1px solid rgba(255,255,255,0.2); background:rgba(255,255,255,0.05); color:white;" />
        </div>
        <div id="ttml-tester-status" style="color:rgba(255,255,255,0.7); font-size:14px;"></div>
        <div>
          <label style="color:white; font-weight:500; display:block; margin-bottom:8px;">Or Paste TTML Content</label>
          <textarea id="ttml-tester-textarea" style="width:100%; height:200px; padding:10px; border-radius:8px; border:1px solid rgba(255,255,255,0.2); background:rgba(255,255,255,0.05); color:white; font-family:monospace; font-size:13px;"></textarea>
        </div>
        <button id="ttml-tester-load-btn" class="sl-btn sl-btn-accent" style="width:100%;">Load & Test TTML</button>
      </div>
    `;
    testerModal.appendChild(content);

    testerOverlay.appendChild(testerModal);
    document.body.appendChild(testerOverlay);

    // Add functionality
    const fileInput = content.querySelector("#ttml-tester-input");
    const textarea = content.querySelector("#ttml-tester-textarea");
    const status = content.querySelector("#ttml-tester-status");
    const loadBtn = content.querySelector("#ttml-tester-load-btn");

    fileInput.onchange = async (e) => {
      if (e.target.files.length > 0) {
        const file = e.target.files[0];
        const ttml = await file.text();
        textarea.value = ttml;
        status.textContent = `Loaded file: ${file.name}`;
      }
    };

    loadBtn.onclick = async () => {
      const ttml = textarea.value.trim();
      if (!ttml) {
        status.textContent = "Please enter TTML content first!";
        return;
      }

      try {
        status.textContent = "Parsing TTML...";
        // Dynamically import parser
        const parseTTMLToLyrics = (await import("./ttml-parser.js")).default;
        const GeniusService = (await import("./genius-service.js")).GeniusService;
        
        let parsedLyrics = parseTTMLToLyrics(ttml);

        // Check for missing songwriters and offer to fetch!
        if (!parsedLyrics.SongWriters || parsedLyrics.SongWriters.length === 0) {
          if (confirm("TTML has no songwriters! Would you like to fetch songwriters from Genius? You'll need to enter song title & artist.")) {
            const title = prompt("Enter song title:");
            const artist = prompt("Enter artist name:");
            if (title && artist) {
              try {
                status.textContent = "Fetching songwriters from Genius...";
                const writers = await GeniusService.fetchCredits({ title, artist });
                if (writers && writers.length > 0) {
                  parsedLyrics.SongWriters = writers;
                  status.textContent = `Fetched ${writers.length} songwriter(s)!`;
                } else {
                  status.textContent = "No songwriters found on Genius.";
                }
              } catch (e) {
                console.error(e);
                status.textContent = "Error fetching songwriters: " + e.message;
              }
            }
          }
        }

        // Now we need to pass this to player.html's applyLyricsToUI! Since we can't directly call it, let's open player.html and pass data via URL, or store in localStorage!
        // Let's store in localStorage and redirect to player.html in demo mode!
        localStorage.setItem("spicy_ttml_test", JSON.stringify({
          lyrics: parsedLyrics,
          timestamp: Date.now()
        }));

        // Create a dummy audio track to play
        // First check if we are already on player.html! If yes, use existing player!
        if (window.location.pathname.endsWith("player.html") && window.spicyPlayer) {
          // If already on player, use existing player and set lyrics!
          alert("TTML loaded! Please wait while we apply it...");
          // We need to inject the lyrics! Let's dispatch an event!
          window.dispatchEvent(new CustomEvent("spicy_ttml_test_loaded", { detail: parsedLyrics }));
          testerOverlay.remove();
        } else {
          // Redirect to player.html with dummy data!
          alert("Opening player with test TTML! Please upload an audio file to play along!");
          // For now, just store in localStorage!
          window.location.href = "player.html?test=true";
        }

      } catch (e) {
        console.error(e);
        status.textContent = "Error parsing TTML: " + e.message;
      }
    };
  }

  renderDeveloper(container) {
    this.addGroup(container, "TTML Testing & Authoring");
    const ttmlCard = this.createCard(container);
    const testTTMLBtn = document.createElement("button");
    testTTMLBtn.className = "sl-btn";
    testTTMLBtn.textContent = "Test TTML Lyrics";
    testTTMLBtn.onclick = () => this.showTTMLTester();
    this.addRow(ttmlCard, "TTML Tester", "Load and test custom TTML lyric files.", testTTMLBtn);

    this.addGroup(container, "Lyrics Synchronization");
    const syncCard = this.createCard(container);
    // Custom Playback Offset Slider with Reset!
    const offsetRow = document.createElement("div");
    offsetRow.className = "sl-settings-row";
    
    const offsetMeta = document.createElement("div");
    offsetMeta.className = "sl-settings-meta";
    offsetMeta.innerHTML = `
      <span class="sl-settings-label">Playback Offset</span>
      <span class="sl-settings-description">Shift lyrics timing in milliseconds. Negative values show lyrics earlier; positive values delay them.</span>
    `;
    
    const offsetControls = document.createElement("div");
    offsetControls.style.display = "flex";
    offsetControls.style.alignItems = "center";
    offsetControls.style.gap = "12px";
    
    const offsetValue = document.createElement("span");
    offsetValue.className = "sl-slider-value";
    const formatVal = (v) => v === 0 ? "0ms (Sync)" : (v > 0 ? `+${v}ms` : `${v}ms`);
    offsetValue.textContent = formatVal(settingsManager.get("playbackOffset"));
    
    const offsetSlider = document.createElement("input");
    offsetSlider.type = "range";
    offsetSlider.className = "sl-range-slider";
    offsetSlider.style.width = "200px";
    offsetSlider.min = -5000;
    offsetSlider.max = 5000;
    offsetSlider.step = 10;
    offsetSlider.value = settingsManager.get("playbackOffset");
    offsetSlider.oninput = () => {
      const v = parseInt(offsetSlider.value, 10);
      settingsManager.set("playbackOffset", v);
      offsetValue.textContent = formatVal(v);
    };
    
    const offsetResetBtn = document.createElement("button");
    offsetResetBtn.className = "sl-btn-small";
    offsetResetBtn.textContent = "Reset";
    offsetResetBtn.style.padding = "4px 12px";
    offsetResetBtn.onclick = () => {
      settingsManager.set("playbackOffset", 0);
      offsetSlider.value = 0;
      offsetValue.textContent = formatVal(0);
    };
    
    offsetControls.appendChild(offsetValue);
    offsetControls.appendChild(offsetSlider);
    offsetControls.appendChild(offsetResetBtn);
    
    offsetRow.appendChild(offsetMeta);
    offsetRow.appendChild(offsetControls);
    
    syncCard.appendChild(offsetRow);

    this.addGroup(container, "Persistent Cache Utilities");
    const cacheCard = this.createCard(container);

    const btnClearCurrentCache = document.createElement("button");
    btnClearCurrentCache.className = "sl-btn";
    btnClearCurrentCache.textContent = "Clear current song state cache";
    btnClearCurrentCache.onclick = async () => {
      const { RemoveCurrentLyrics_AllCaches } = await import("./lyrics-cache-tools.js");
      await RemoveCurrentLyrics_AllCaches(true);
    };
    this.addRow(cacheCard, "Destroy Current Lyrics Cache", "Erase persistent cache for the currently playing track.", btnClearCurrentCache);

    const btnClearAllCache = document.createElement("button");
    btnClearAllCache.className = "sl-btn sl-btn-accent";
    btnClearAllCache.textContent = "Clear all stored lyrics caches";
    btnClearAllCache.onclick = async () => {
      const { RemoveLyricsCache } = await import("./lyrics-cache-tools.js");
      await RemoveLyricsCache(true);
    };
    this.addRow(cacheCard, "Destroy All Lyrics Cache", "Wipe clean the entire local lyrics CacheStorage cache.", btnClearAllCache);

    const btnClearState = document.createElement("button");
    btnClearState.className = "sl-btn";
    btnClearState.textContent = "Clear current song state";
    btnClearState.onclick = async () => {
      const { RemoveCurrentLyrics_StateCache } = await import("./lyrics-cache-tools.js");
      RemoveCurrentLyrics_StateCache(true);
      window.dispatchEvent(new CustomEvent("spicy-settings-changed"));
    };
    this.addRow(cacheCard, "Clear Memory State", "Reset internal loaded lyrics state for the current song.", btnClearState);
  }
}

export const settingsUI = new SettingsUI();