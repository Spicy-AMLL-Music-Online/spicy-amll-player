/**
 * Spicy AMLL Extension System
 * Handles loading and managing user extensions (zip files containing script.js and config.json)
 */

class ExtensionManager {
  constructor() {
    this.extensions = [];
    this.loadFromStorage();
  }

  /**
   * Load extensions from IndexedDB
   */
  async loadFromStorage() {
    try {
      const db = await this._openDB();
      const tx = db.transaction('extensions', 'readonly');
      const store = tx.objectStore('extensions');
      const extensions = await this._getAllFromStore(store);
      this.extensions = extensions || [];
    } catch (e) {
      console.error('[Extensions] Failed to load from storage:', e);
      this.extensions = [];
    }
  }

  /**
   * Save an extension to storage
   */
  async saveExtension(extension) {
    try {
      const db = await this._openDB();
      const tx = db.transaction('extensions', 'readwrite');
      const store = tx.objectStore('extensions');
      await this._putToStore(store, extension);
      const index = this.extensions.findIndex(e => e.id === extension.id);
      if (index >= 0) {
        this.extensions[index] = extension;
      } else {
        this.extensions.push(extension);
      }
    } catch (e) {
      console.error('[Extensions] Failed to save extension:', e);
    }
  }

  /**
   * Delete an extension
   */
  async deleteExtension(id) {
    try {
      const db = await this._openDB();
      const tx = db.transaction('extensions', 'readwrite');
      const store = tx.objectStore('extensions');
      await this._deleteFromStore(store, id);
      this.extensions = this.extensions.filter(e => e.id !== id);
    } catch (e) {
      console.error('[Extensions] Failed to delete extension:', e);
    }
  }

  /**
   * Load an extension from a zip file
   */
  async loadExtensionFromZip(zipFile) {
    try {
      // Load JSZip library (since it's a web app, we'll load it dynamically or use a CDN)
      if (typeof window.JSZip === 'undefined') {
        await this._loadJSZip();
      }

      const zip = await window.JSZip.loadAsync(zipFile);
      
      // Check for required files
      const configFile = zip.file('config.json');
      const scriptFile = zip.file('script.js');
      
      if (!configFile || !scriptFile) {
        throw new Error('Zip file must contain config.json and script.js');
      }

      // Parse config
      const configJson = await configFile.async('text');
      const config = JSON.parse(configJson);

      // Validate config
      if (!config.id || !config.name || !config.version) {
        throw new Error('config.json must contain id, name, and version');
      }

      // Read script
      const script = await scriptFile.async('text');

      const extension = {
        id: config.id,
        name: config.name,
        description: config.description || '',
        version: config.version,
        author: config.author || '',
        tags: config.tags || [],
        script: script,
        enabled: true,
        loadedAt: Date.now()
      };

      await this.saveExtension(extension);

      // Execute the extension if enabled
      if (extension.enabled) {
        this._executeExtension(extension);
      }

      return extension;
    } catch (e) {
      console.error('[Extensions] Failed to load extension:', e);
      throw e;
    }
  }

  /**
   * Load all enabled extensions
   */
  async loadAllExtensions() {
    for (const extension of this.extensions) {
      if (extension.enabled) {
        this._executeExtension(extension);
      }
    }
  }

  /**
   * Execute an extension's script in a sandboxed context
   */
  _executeExtension(extension) {
    try {
      // Create a context object to expose to the extension
      const context = {
        player: window.spicyPlayer,
        settingsManager: window.spicySettingsManager,
        getCurrentLyrics: () => {
          // Helper to get current lyrics
          return window._spicyCurrentLyrics || null;
        },
        downloadFile: (content, filename, mimeType) => {
          // Helper to download files
          const blob = new Blob([content], { type: mimeType || 'text/plain' });
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = filename;
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          URL.revokeObjectURL(url);
        }
      };

      // Execute the script with the context
      const scriptFunction = new Function(...Object.keys(context), extension.script);
      scriptFunction(...Object.values(context));

      console.log(`[Extensions] Loaded: ${extension.name} v${extension.version}`);
    } catch (e) {
      console.error(`[Extensions] Failed to execute ${extension.name}:`, e);
    }
  }

  /**
   * Open IndexedDB
   */
  _openDB() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open('SpicyLyricsExtensionsDB', 1);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);
      request.onupgradeneeded = (event) => {
        const db = event.target.result;
        if (!db.objectStoreNames.contains('extensions')) {
          db.createObjectStore('extensions', { keyPath: 'id' });
        }
      };
    });
  }

  /**
   * Get all items from an IndexedDB store
   */
  _getAllFromStore(store) {
    return new Promise((resolve, reject) => {
      const request = store.getAll();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Put an item into an IndexedDB store
   */
  _putToStore(store, value) {
    return new Promise((resolve, reject) => {
      const request = store.put(value); // no key parameter needed!
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Delete an item from an IndexedDB store
   */
  _deleteFromStore(store, key) {
    return new Promise((resolve, reject) => {
      const request = store.delete(key);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Load JSZip library from CDN
   */
  _loadJSZip() {
    return new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = 'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js';
      script.onload = () => resolve();
      script.onerror = () => reject(new Error('Failed to load JSZip'));
      document.head.appendChild(script);
    });
  }
}

// Export the extension manager
const extensionManager = new ExtensionManager();
window.spicyExtensionManager = extensionManager;

export default extensionManager;
