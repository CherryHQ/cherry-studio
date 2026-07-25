import type { CherryMessagePart } from '@shared/data/types/message'
import type { DeferredToolResultRef } from '@shared/data/types/uiParts'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function getDeferredToolResultRef(part: CherryMessagePart): DeferredToolResultRef | undefined {
  const source = part as unknown as Record<string, unknown>
  const metadata = source.resultProviderMetadata
  if (!isRecord(metadata)) return undefined
  const cherry = metadata.cherry
  if (!isRecord(cherry)) return undefined
  const deferredToolResult = cherry.deferredToolResult
  if (!isRecord(deferredToolResult)) return undefined

  const { messageId, toolCallId, kind } = deferredToolResult
  if (
    typeof messageId !== 'string' ||
    !messageId ||
    typeof toolCallId !== 'string' ||
    !toolCallId ||
    (kind !== 'output' && kind !== 'error')
  ) {
    return undefined
  }

  return { messageId, toolCallId, kind }
}
