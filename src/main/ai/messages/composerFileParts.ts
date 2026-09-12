import type { UIMessage } from 'ai'

import type { FileUIPart } from '@shared/data/types/message'
import { readCherryMeta } from '@shared/data/types/uiParts'

export function collectComposerFileTokenIds(message: UIMessage): Set<string> {
  const tokenIds = new Set<string>()
  for (const part of message.parts ?? []) {
    if (part.type !== 'text') continue
    for (const token of readCherryMeta(part)?.composer?.tokens ?? []) {
      if (token.kind === 'file') tokenIds.add(token.id)
    }
  }
  return tokenIds
}

export function isActiveManagedFilePart(part: FileUIPart, composerFileTokenIds: ReadonlySet<string>): boolean {
  const sourceId = readCherryMeta(part)?.fileTokenSourceId
  return !sourceId || composerFileTokenIds.has(`file:${sourceId}`)
}
