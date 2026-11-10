import { getTextFromParts } from '@renderer/utils/message/partsHelpers'
import type { CherryMessagePart } from '@shared/data/types/message'

import { readTextAloud } from './manualPlayback'

export interface ReadMessageAloudInput {
  readonly messageId: string
  readonly parts: readonly CherryMessagePart[]
  readonly focusOnClose?: () => void
}

export async function readMessageAloud({ messageId, parts, focusOnClose }: ReadMessageAloudInput): Promise<void> {
  const text = getTextFromParts([...parts])
  await readTextAloud({
    text,
    mode: 'document',
    sourceLabel: 'message',
    sourceEntityId: messageId,
    focusOnClose
  })
}
