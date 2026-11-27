import { useCallback, useMemo, useState, useSyncExternalStore } from 'react'

import { useConversationHistoryQuery } from '@renderer/hooks/useConversationHistoryQuery'
import { messageProjectionService } from '@renderer/services/aiTransport'
import { createPartsByMessageId } from '@renderer/utils/message/exportView'
import { replyParts } from '@renderer/utils/message/messagePartRows'

export function useAgentChildProjection(sessionId: string, toolCallId: string | undefined, active: boolean) {
  const target = useMemo(
    () => ({ kind: 'child' as const, sessionId, toolCallId: toolCallId ?? '' }),
    [sessionId, toolCallId]
  )
  const enabled = active && Boolean(toolCallId)
  const state = useSyncExternalStore(
    useCallback(
      (listener) => (enabled ? messageProjectionService.subscribe(target, listener) : () => {}),
      [enabled, target]
    ),
    useCallback(() => messageProjectionService.getSnapshot(target), [target])
  )
  const view = state.view?.kind === 'child' ? state.view : null
  const [before, setBefore] = useState<string>()
  const paging = !!before && before === view?.olderCursor
  const history = useConversationHistoryQuery('/agent-sessions/:sessionId/children/:toolCallId/history', {
    params: { sessionId, toolCallId: toolCallId ?? '' },
    query: { before: before ?? '' },
    enabled: enabled && paging,
    swrOptions: { keepPreviousData: false, revalidateFirstPage: false }
  })
  const archived = useMemo(
    () => (paging ? history.pages?.toReversed().flatMap((page) => page.items) : undefined),
    [paging, history.pages]
  )
  const result = useMemo(() => {
    if (!view || !archived?.length) return view
    return { ...view, messages: [...archived, ...view.messages] }
  }, [view, archived])
  const historyParts = useMemo(() => createPartsByMessageId(archived ?? []), [archived])
  const partsByMessageId = useMemo(() => replyParts(historyParts, view?.messages ?? []), [historyParts, view?.messages])
  return enabled
    ? {
        view: result,
        partsByMessageId,
        error: state.error ?? (history.error && String(history.error)),
        hasOlder: paging ? history.hasNext : !!view?.olderCursor,
        loadOlder: () => {
          if (paging) history.loadNext()
          else setBefore(view?.olderCursor)
        }
      }
    : undefined
}
