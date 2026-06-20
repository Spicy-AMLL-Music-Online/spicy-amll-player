/**
 * Spicy AMLL Player WEB — Metadata Parser
 * Extracts ID3 tags (MP3) and FLAC/Vorbis metadata from audio files.
 * Supports: title, artist, album, album art (cover image).
 */

/**
 * Parse metadata from an audio ArrayBuffer.
 * @param {ArrayBuffer} buffer
 * @param {string} filename - Original filename for fallback
 * @returns {Promise<{title: string, artist: string, album: string, artUrl: string|null}>}
 */
export async function parseAudioMetadata(buffer, filename) {
  const result = {
    title: cleanFilename(filename),
    artist: '',
    album: '',
    year: '',
    artUrl: null,
  };

  const view = new DataView(buffer);

  try {
    // Try MP4/M4A (ftyp)
    if (isMP4(view)) {
      const mp4 = parseMP4(view);
      if (mp4.title) result.title = mp4.title;
      if (mp4.artist) result.artist = mp4.artist;
      if (mp4.album) result.album = mp4.album;
      if (mp4.year) result.year = mp4.year;
      if (mp4.artUrl) result.artUrl = mp4.artUrl;
      return result;
    }

    // Try ID3v2 first (MP3)
    if (hasID3v2(view)) {
      const id3 = parseID3v2(view);
      if (id3.title) result.title = id3.title;
      if (id3.artist) result.artist = id3.artist;
      if (id3.album) result.album = id3.album;
      if (id3.year) result.year = id3.year;
      if (id3.artUrl) result.artUrl = id3.artUrl;
      return result;
    }

    // Try FLAC
    if (hasFLAC(view)) {
      const flac = parseFLAC(buffer);
      if (flac.title) result.title = flac.title;
      if (flac.artist) result.artist = flac.artist;
      if (flac.album) result.album = flac.album;
      if (flac.year) result.year = flac.year;
      if (flac.artUrl) result.artUrl = flac.artUrl;
      return result;
    }

    // Try ID3v1 (tail of MP3)
    if (buffer.byteLength > 128) {
      const id3v1 = parseID3v1(view, buffer.byteLength);
      if (id3v1.title) result.title = id3v1.title;
      if (id3v1.artist) result.artist = id3v1.artist;
      if (id3v1.album) result.album = id3v1.album;
      if (id3v1.year) result.year = id3v1.year;
      return result;
    }
  } catch (err) {
    console.warn('Metadata parse error:', err);
  }

  return result;
}

function cleanFilename(name) {
  return (name || 'Unknown').replace(/\.[^.]+$/, '').trim();
}

// ── ID3v2 ────────────────────────────────────────

function hasID3v2(view) {
  if (view.byteLength < 10) return false;
  return (
    view.getUint8(0) === 0x49 && // I
    view.getUint8(1) === 0x44 && // D
    view.getUint8(2) === 0x33    // 3
  );
}

function id3Size(view, offset) {
  return (
    (view.getUint8(offset) << 21) |
    (view.getUint8(offset + 1) << 14) |
    (view.getUint8(offset + 2) << 7) |
    view.getUint8(offset + 3)
  );
}

function parseID3v2(view) {
  const version = view.getUint8(3);
  const tagSize = id3Size(view, 6);
  const headerSize = 10;
  const result = { title: '', artist: '', album: '', year: '', artUrl: null };

  let offset = headerSize;
  const end = Math.min(headerSize + tagSize, view.byteLength);

  while (offset + 10 < end) {
    let frameId, frameSize, headerLen;

    if (version >= 3) {
      // ID3v2.3 / ID3v2.4
      frameId = String.fromCharCode(
        view.getUint8(offset), view.getUint8(offset + 1),
        view.getUint8(offset + 2), view.getUint8(offset + 3)
      );

      if (version === 4) {
        frameSize = id3Size(view, offset + 4);
      } else {
        frameSize = view.getUint32(offset + 4);
      }
      headerLen = 10;
    } else {
      // ID3v2.2 (3-char frame IDs)
      frameId = String.fromCharCode(
        view.getUint8(offset), view.getUint8(offset + 1), view.getUint8(offset + 2)
      );
      frameSize = (view.getUint8(offset + 3) << 16) |
        (view.getUint8(offset + 4) << 8) |
        view.getUint8(offset + 5);
      headerLen = 6;
    }

    if (frameSize <= 0 || frameId.charCodeAt(0) === 0) break;
    if (offset + headerLen + frameSize > end) break;

    const dataStart = offset + headerLen;
    const dataEnd = dataStart + frameSize;

    // Text frames
    if (frameId === 'TIT2' || frameId === 'TT2') {
      result.title = readID3TextFrame(view, dataStart, frameSize);
    } else if (frameId === 'TPE1' || frameId === 'TP1') {
      result.artist = readID3TextFrame(view, dataStart, frameSize);
    } else if (frameId === 'TALB' || frameId === 'TAL') {
      result.album = readID3TextFrame(view, dataStart, frameSize);
    } else if (frameId === 'TYER' || frameId === 'TDRC' || frameId === 'TYE') {
      result.year = readID3TextFrame(view, dataStart, frameSize).substring(0, 4);
    } else if (frameId === 'APIC' || frameId === 'PIC') {
      result.artUrl = readID3Picture(view, dataStart, frameSize, frameId === 'PIC');
    }

    offset += headerLen + frameSize;
  }

  return result;
}

function readID3TextFrame(view, offset, size) {
  const encoding = view.getUint8(offset);
  const textBytes = new Uint8Array(view.buffer, offset + 1, size - 1);

  if (encoding === 0 || encoding === 3) {
    // ISO-8859-1 or UTF-8
    return new TextDecoder(encoding === 3 ? 'utf-8' : 'iso-8859-1').decode(textBytes).replace(/\0/g, '').trim();
  } else if (encoding === 1 || encoding === 2) {
    // UTF-16 (with or without BOM)
    return new TextDecoder('utf-16').decode(textBytes).replace(/\0/g, '').trim();
  }

  return new TextDecoder('utf-8').decode(textBytes).replace(/\0/g, '').trim();
}

function readID3Picture(view, offset, size, isV22) {
  try {
    const encoding = view.getUint8(offset);
    let pos = offset + 1;

    if (isV22) {
      // PIC: 3-byte image format
      pos += 3; // skip image format
      pos += 1; // skip picture type
      // skip description
      while (pos < offset + size && view.getUint8(pos) !== 0) pos++;
      pos++; // null terminator
    } else {
      // APIC: null-terminated MIME type
      let mime = '';
      while (pos < offset + size && view.getUint8(pos) !== 0) {
        mime += String.fromCharCode(view.getUint8(pos));
        pos++;
      }
      pos++; // null terminator
      pos++; // picture type byte
      // skip description
      if (encoding === 0 || encoding === 3) {
        while (pos < offset + size && view.getUint8(pos) !== 0) pos++;
        pos++;
      } else {
        while (pos < offset + size - 1 && !(view.getUint8(pos) === 0 && view.getUint8(pos + 1) === 0)) pos += 2;
        pos += 2;
      }
    }

    const imageData = new Uint8Array(view.buffer, pos, offset + size - pos);
    if (imageData.length < 8) return null;

    // Detect MIME from magic bytes
    let mime = 'image/jpeg';
    if (imageData[0] === 0x89 && imageData[1] === 0x50) mime = 'image/png';
    else if (imageData[0] === 0x47 && imageData[1] === 0x49) mime = 'image/gif';

    const blob = new Blob([imageData], { type: mime });
    return URL.createObjectURL(blob);
  } catch {
    return null;
  }
}

// ── ID3v1 ────────────────────────────────────────

function parseID3v1(view, fileSize) {
  const tagOffset = fileSize - 128;
  const result = { title: '', artist: '', album: '', year: '' };

  if (view.getUint8(tagOffset) !== 0x54 ||    // T
    view.getUint8(tagOffset + 1) !== 0x41 || // A
    view.getUint8(tagOffset + 2) !== 0x47) { // G
    return result;
  }

  result.title = readID3v1String(view, tagOffset + 3, 30);
  result.artist = readID3v1String(view, tagOffset + 33, 30);
  result.album = readID3v1String(view, tagOffset + 63, 30);
  result.year = readID3v1String(view, tagOffset + 93, 4);
  return result;
}

function readID3v1String(view, offset, length) {
  const bytes = new Uint8Array(view.buffer, offset, length);
  return new TextDecoder('iso-8859-1').decode(bytes).replace(/\0/g, '').trim();
}

// ── FLAC ────────────────────────────────────────

function hasFLAC(view) {
  if (view.byteLength < 4) return false;
  return (
    view.getUint8(0) === 0x66 && // f
    view.getUint8(1) === 0x4C && // L
    view.getUint8(2) === 0x61 && // a
    view.getUint8(3) === 0x43    // C
  );
}

function parseFLAC(buffer) {
  const view = new DataView(buffer);
  const result = { title: '', artist: '', album: '', year: '', artUrl: null };

  let offset = 4; // Skip "fLaC"

  while (offset < buffer.byteLength - 4) {
    const blockHeader = view.getUint8(offset);
    const isLast = (blockHeader & 0x80) !== 0;
    const blockType = blockHeader & 0x7f;
    const blockSize = (view.getUint8(offset + 1) << 16) |
      (view.getUint8(offset + 2) << 8) |
      view.getUint8(offset + 3);

    offset += 4;

    if (blockType === 4) {
      // VORBIS_COMMENT
      parseVorbisComment(view, offset, blockSize, result);
    } else if (blockType === 6) {
      // PICTURE
      parseFLACPicture(view, offset, blockSize, result);
    }

    offset += blockSize;
    if (isLast) break;
  }

  return result;
}

function parseVorbisComment(view, offset, size, result) {
  try {
    const vendorLength = view.getUint32(offset, true);
    offset += 4 + vendorLength;

    const commentCount = view.getUint32(offset, true);
    offset += 4;

    for (let i = 0; i < commentCount; i++) {
      const commentLength = view.getUint32(offset, true);
      offset += 4;

      const commentBytes = new Uint8Array(view.buffer, offset, commentLength);
      const comment = new TextDecoder('utf-8').decode(commentBytes);
      offset += commentLength;

      const eqIndex = comment.indexOf('=');
      if (eqIndex === -1) continue;

      const key = comment.substring(0, eqIndex).toUpperCase();
      const value = comment.substring(eqIndex + 1);

      if (key === 'TITLE') result.title = value;
      else if (key === 'ARTIST') result.artist = value;
      else if (key === 'ALBUM') result.album = value;
      else if (key === 'DATE' || key === 'YEAR') result.year = value.substring(0, 4);
    }
  } catch { /* ignore parse errors */ }
}

function parseFLACPicture(view, offset, size, result) {
  try {
    const pictureType = view.getUint32(offset);
    offset += 4;

    const mimeLength = view.getUint32(offset);
    offset += 4;

    const mimeBytes = new Uint8Array(view.buffer, offset, mimeLength);
    const mime = new TextDecoder('ascii').decode(mimeBytes);
    offset += mimeLength;

    const descLength = view.getUint32(offset);
    offset += 4 + descLength;

    // width, height, color depth, colors used
    offset += 4 * 4;

    const pictureDataLength = view.getUint32(offset);
    offset += 4;

    const pictureData = new Uint8Array(view.buffer, offset, pictureDataLength);
    const blob = new Blob([pictureData], { type: mime || 'image/jpeg' });
    result.artUrl = URL.createObjectURL(blob);
  } catch { /* ignore */ }
}

// ── MP4/M4A (iTunes Atoms) ────────────────────────

function isMP4(view) {
  if (view.byteLength < 8) return false;
  // Look for "ftyp" at offset 4
  return (
    view.getUint8(4) === 0x66 && // f
    view.getUint8(5) === 0x74 && // t
    view.getUint8(6) === 0x79 && // y
    view.getUint8(7) === 0x70    // p
  );
}

function parseMP4(view) {
  const result = { title: '', artist: '', album: '', year: '', artUrl: null };
  const buffer = view.buffer;
  
  // Walker function to find specific atoms
  function findAtom(start, end, path) {
    let offset = start;
    if (path.length === 0) return null;
    const target = path[0];
    
    while (offset + 8 <= end) {
      const size = view.getUint32(offset);
      const type = String.fromCharCode(
        view.getUint8(offset + 4), view.getUint8(offset + 5),
        view.getUint8(offset + 6), view.getUint8(offset + 7)
      );

      if (type === target) {
        if (path.length === 1) {
          return { offset: offset + 8, size: size - 8 };
        } else {
          // Move deeper (skip header)
          let innerOffset = offset + 8;
          if (type === 'meta') innerOffset += 4; // meta atom has a 4-byte prefix
          return findAtom(innerOffset, offset + size, path.slice(1));
        }
      }
      
      if (size <= 0) break;
      offset += size;
    }
    return null;
  }

  // Path: moov.udta.meta.ilst
  const ilst = findAtom(0, view.byteLength, ['moov', 'udta', 'meta', 'ilst']);
  if (!ilst) return result;

  // Walk through ilst children
  let offset = ilst.offset;
  const end = ilst.offset + ilst.size;

  while (offset + 8 < end) {
    const size = view.getUint32(offset);
    const type = String.fromCharCode(
      view.getUint8(offset + 4), view.getUint8(offset + 5),
      view.getUint8(offset + 6), view.getUint8(offset + 7)
    );

    const dataAtom = findAtom(offset + 8, offset + size, ['data']);
    if (dataAtom) {
      const dataOffset = dataAtom.offset + 8; // skip version/flags
      const dataSize = dataAtom.size - 8;

      if (type === '\xA9nam') {
        result.title = readUTF8(buffer, dataOffset, dataSize);
      } else if (type === '\xA9ART' || type === 'aART') {
        result.artist = readUTF8(buffer, dataOffset, dataSize);
      } else if (type === '\xA9alb') {
        result.album = readUTF8(buffer, dataOffset, dataSize);
      } else if (type === '\xA9day') {
        result.year = readUTF8(buffer, dataOffset, dataSize).substring(0, 4);
      } else if (type === 'covr') {
        const artData = new Uint8Array(buffer, dataOffset, dataSize);
        let mime = 'image/jpeg';
        if (artData[0] === 0x89 && artData[1] === 0x50) mime = 'image/png';
        const blob = new Blob([artData], { type: mime });
        result.artUrl = URL.createObjectURL(blob);
      }
    }
    offset += size;
  }

  return result;
}

function readUTF8(buffer, offset, length) {
  try {
    const bytes = new Uint8Array(buffer, offset, length);
    return new TextDecoder('utf-8').decode(bytes).replace(/\0/g, '').trim();
  } catch {
    return '';
  }
}
