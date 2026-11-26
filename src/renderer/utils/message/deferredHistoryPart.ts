import { dataApiService } from '@data/DataApiService'
import type { CherryMessagePart } from '@shared/data/types/message'
import type { CherryDataPartTypes } from '@shared/data/types/uiParts'

export function readDeferredHistoryPart({
  sessionId,
  messageId,
  partId
}: CherryDataPartTypes['deferred-history-part']) {
  return dataApiService.get(
    `/agent-sessions/${sessionId}/messages/${messageId}/parts/${partId}` as '/agent-sessions/:sessionId/messages/:messageId/parts/:partId'
  )
}

export async function readVerbatimHistoryParts(parts: CherryMessagePart[]): Promise<CherryMessagePart[]> {
  let resolved: CherryMessagePart[] | undefined
  for (const [index, part] of parts.entries()) {
    if (part.type !== 'data-deferred-history-part') continue
    resolved ??= parts.slice()
    resolved[index] = await readDeferredHistoryPart(part.data)
  }
  return resolved ?? parts
}
