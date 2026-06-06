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
