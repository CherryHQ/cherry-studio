/**
 * Split a long message into chunks that respect paragraph/line boundaries.
 * Used by all channel adapters — each passes its own platform max length.
 */
export function splitMessage(text: string, maxLength: number): string[] {
  if (text.length <= maxLength) return [text]

  const chunks: string[] = []
  let remaining = text

  while (remaining.length > 0) {
    if (remaining.length <= maxLength) {
      chunks.push(remaining)
      break
    }

    let splitIndex = remaining.lastIndexOf('\n\n', maxLength)
    if (splitIndex <= 0) splitIndex = remaining.lastIndexOf('\n', maxLength)
    if (splitIndex <= 0) splitIndex = remaining.lastIndexOf(' ', maxLength)
    if (splitIndex <= 0) splitIndex = maxLength

    chunks.push(remaining.slice(0, splitIndex))
    remaining = remaining.slice(splitIndex).replace(/^\n+/, '').trimStart()
  }

  return chunks
}

/** Common MIME type lookup by file extension. */
export const FILE_EXTENSION_MIME_MAP: Record<string, string> = {
  pdf: 'application/pdf',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ppt: 'application/vnd.ms-powerpoint',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  txt: 'text/plain',
  csv: 'text/csv',
  md: 'text/markdown',
  zip: 'application/zip'
}

/** Resolve a MIME type from a filename's extension; falls back to application/octet-stream. */
export function mimeFromFileName(fileName: string | undefined): string {
  if (!fileName) return 'application/octet-stream'
  const ext = fileName.includes('.') ? fileName.split('.').pop()!.toLowerCase() : ''
  return FILE_EXTENSION_MIME_MAP[ext] ?? 'application/octet-stream'
}

/**
 * Detect an image MIME type from magic bytes. Handles PNG/JPEG/GIF/WebP/BMP.
 * Defaults to image/png on unknown signatures — adequate for the upstream IMs
 * that accept common image formats without strict validation.
 */
export function detectImageMime(data: Buffer): string {
  if (data.length < 4) return 'image/png'
  if (data[0] === 0xff && data[1] === 0xd8) return 'image/jpeg'
  if (data[0] === 0x89 && data[1] === 0x50 && data[2] === 0x4e && data[3] === 0x47) return 'image/png'
  if (data[0] === 0x47 && data[1] === 0x49 && data[2] === 0x46) return 'image/gif'
  if (data[0] === 0x52 && data[1] === 0x49 && data[2] === 0x46 && data[3] === 0x46) return 'image/webp'
  if (data[0] === 0x42 && data[1] === 0x4d) return 'image/bmp'
  return 'image/png'
}

/** Pick an image extension (no dot) from magic bytes. Used to synthesize an upload filename. */
export function detectImageExtension(data: Buffer): string {
  const mime = detectImageMime(data)
  return mime.split('/')[1] ?? 'png'
}
