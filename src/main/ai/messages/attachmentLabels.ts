import type { FileUIPart } from '@shared/data/types/message'
import { imageExts } from '@shared/utils/file'

export function attachmentLabel(number: number, filename?: string): string {
  return `[Attachment ${number}${filename ? `: ${JSON.stringify(filename)}` : ''}]`
}

export function isImageFilePart(part: FileUIPart): boolean {
  if (part.mediaType?.toLowerCase().startsWith('image/')) return true
  const filename = part.filename?.toLowerCase()
  const url = part.url && !part.url.startsWith('data:') ? part.url.toLowerCase().split(/[?#]/, 1)[0] : undefined
  return imageExts.some((extension) => filename?.endsWith(extension) || url?.endsWith(extension))
}
