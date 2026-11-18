import { Capacitor } from '@capacitor/core';
import { Directory, Filesystem } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';

export type FileDataInput = Blob | Uint8Array | ArrayBuffer | string;

export interface SaveAndShareOptions {
  data: FileDataInput;
  fileName: string;
  mimeType: string;
  title?: string;
  dialogTitle?: string;
  /** Set to true if `data` is already a base64 string (with or without data URL prefix). */
  isBase64?: boolean;
}

export type SaveAndShareOutcome =
  | { status: 'shared'; uri: string; fileName: string }
  | { status: 'downloaded'; fileName: string }
  | { status: 'cancelled'; fileName: string };

/**
 * Sanitizes a filename for cross-platform safety (Android Cache + FileProvider + desktop browsers).
 * Preserves a valid extension (e.g. .pdf, .xlsx, .json) while stripping slashes, spaces,
 * Bengali/non-ASCII characters, and special punctuation.
 */
export function sanitizeFileName(rawName: string, fallbackExt = ''): string {
  const trimmed = (rawName || '').trim();
  const lastDot = trimmed.lastIndexOf('.');
  let base = lastDot > 0 ? trimmed.slice(0, lastDot) : trimmed;
  let ext = lastDot > 0 ? trimmed.slice(lastDot + 1) : fallbackExt.replace(/^\./, '');

  base = base
    .normalize('NFKD')
    .replace(/[^\x20-\x7E]/g, '')
    .replace(/[\\/:*?"<>|\s]+/g, '-')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[-._]+|[-._]+$/g, '')
    .slice(0, 80);

  ext = ext
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '')
    .slice(0, 12);

  if (!base) {
    base = `export-${Date.now()}`;
  }

  return ext ? `${base}.${ext}` : base;
}

function uint8ArrayToBase64(bytes: Uint8Array): string {
  const chunkSize = 0x8000; // 32 KB chunks avoid call-stack limits on large exports
  const parts: string[] = [];
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const slice = bytes.subarray(i, Math.min(i + chunkSize, bytes.length));
    parts.push(String.fromCharCode(...slice));
  }
  return btoa(parts.join(''));
}

async function toBase64(data: FileDataInput, isBase64?: boolean): Promise<string> {
  if (typeof data === 'string') {
    if (isBase64) {
      const commaIdx = data.indexOf('base64,');
      return commaIdx >= 0 ? data.slice(commaIdx + 7) : data;
    }
    return uint8ArrayToBase64(new TextEncoder().encode(data));
  }

  if (data instanceof Blob) {
    const buffer = await data.arrayBuffer();
    return uint8ArrayToBase64(new Uint8Array(buffer));
  }

  if (data instanceof ArrayBuffer) {
    return uint8ArrayToBase64(new Uint8Array(data));
  }

  return uint8ArrayToBase64(data);
}

function toBlob(data: FileDataInput, mimeType: string, isBase64?: boolean): Blob {
  if (data instanceof Blob) {
    return data.type === mimeType ? data : new Blob([data], { type: mimeType });
  }

  if (typeof data === 'string') {
    if (isBase64) {
      const commaIdx = data.indexOf('base64,');
      const clean = commaIdx >= 0 ? data.slice(commaIdx + 7) : data;
      const binary = atob(clean);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
      }
      return new Blob([bytes], { type: mimeType });
    }
    return new Blob([data], { type: mimeType });
  }

  if (data instanceof ArrayBuffer) {
    return new Blob([data], { type: mimeType });
  }

  // Copy into a standard ArrayBuffer-backed Uint8Array for strict BlobPart compatibility
  const copy = new Uint8Array(data.byteLength);
  copy.set(data);
  return new Blob([copy], { type: mimeType });
}

function isShareCancelError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const msg = err.message.toLowerCase();
  return msg.includes('cancel') || msg.includes('dismissed');
}

/**
 * Saves an exported file natively on Android/iOS via Capacitor Filesystem (Directory.Cache) + Share sheet,
 * or triggers a standard browser download on Web.
 */
export async function saveAndShareFile(
  options: SaveAndShareOptions
): Promise<SaveAndShareOutcome> {
  const safeName = sanitizeFileName(options.fileName);

  if (Capacitor.isNativePlatform()) {
    const base64 = await toBase64(options.data, options.isBase64);

    await Filesystem.writeFile({
      path: safeName,
      data: base64,
      directory: Directory.Cache,
      recursive: true,
    });

    const { uri } = await Filesystem.getUri({
      path: safeName,
      directory: Directory.Cache,
    });

    try {
      await Share.share({
        title: options.title || safeName,
        url: uri,
        dialogTitle: options.dialogTitle || `Open or save ${safeName}`,
      });
      return { status: 'shared', uri, fileName: safeName };
    } catch (err) {
      if (isShareCancelError(err)) {
        return { status: 'cancelled', fileName: safeName };
      }
      throw err;
    }
  }

  // Web browser fallback
  const blob = toBlob(options.data, options.mimeType, options.isBase64);
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = safeName;
  anchor.style.display = 'none';
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  setTimeout(() => URL.revokeObjectURL(url), 1500);

  return { status: 'downloaded', fileName: safeName };
}
