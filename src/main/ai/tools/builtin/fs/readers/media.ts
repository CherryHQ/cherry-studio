/**
 * Media (image / audio / video) extension → mime tables. Raw bytes are
 * passed through to the model — no resize / transcode — because the
 * dispatcher hands them to providers that handle their own wire-side
 * encoding. Unknown extensions fall back to `application/octet-stream`
 * at the call site.
 */

export const IMAGE_MIME_BY_EXT: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
  '.tiff': 'image/tiff',
  '.tif': 'image/tiff'
}

export const AUDIO_MIME_BY_EXT: Record<string, string> = {
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.flac': 'audio/flac',
  '.aac': 'audio/aac'
}

export const VIDEO_MIME_BY_EXT: Record<string, string> = {
  '.mp4': 'video/mp4',
  '.avi': 'video/x-msvideo',
  '.mov': 'video/quicktime',
  '.wmv': 'video/x-ms-wmv',
  '.flv': 'video/x-flv',
  '.mkv': 'video/x-matroska'
}

export function isImageExtension(ext: string): boolean {
  return ext.toLowerCase() in IMAGE_MIME_BY_EXT
}

export function isAudioExtension(ext: string): boolean {
  return ext.toLowerCase() in AUDIO_MIME_BY_EXT
}

export function isVideoExtension(ext: string): boolean {
  return ext.toLowerCase() in VIDEO_MIME_BY_EXT
}
