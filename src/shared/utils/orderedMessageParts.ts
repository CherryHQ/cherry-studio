import type { UIMessage } from 'ai'

import { readCherryMeta } from '@shared/data/types/uiParts'

export function isOrderedContentPart(part: UIMessage['parts'][number]): boolean {
  return (part.type === 'text' || part.type === 'file') && readCherryMeta(part)?.contentFormat === 'ordered-parts-v1'
}

export function hasOrderedContent(parts: readonly UIMessage['parts'][number][]): boolean {
  return parts.some(isOrderedContentPart)
}
