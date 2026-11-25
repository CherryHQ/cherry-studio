import type { ChatRequestOptions, FileUIPart } from 'ai'
import { useCallback, useEffect, useMemo, useRef, useSyncExternalStore } from 'react'

import { ipcApi } from '@renderer/ipc'
import { messageProjectionService, streamDispatchService } from '@renderer/services/aiTransport'
import type { AiChatRequestBody, AiStreamOpenRequest } from '@shared/ai/transport'

export function useStreamCommands(topicId: string, onError?: (error: Error) => void) {
  const errorHandler = useRef(onError)
  errorHandler.current = onError
  const owner = useMemo(() => ({ topicId }), [topicId])
  const currentOwner = useRef(owner)
  currentOwner.current = owner
  const target = useMemo(() => ({ kind: 'topic' as const, topicId }), [topicId])
  const projection = useSyncExternalStore(
    useCallback(
      (listener) => (topicId ? messageProjectionService.subscribe(target, listener) : () => {}),
      [target, topicId]
    ),
    useCallback(() => messageProjectionService.getSnapshot(target), [target])
  )
  const reported = useRef(new Set<number>())
  useEffect(() => {
    reported.current.clear()
  }, [topicId])

  useEffect(() => {
    const view = projection.view
    if (!errorHandler.current || view?.kind !== 'topic') return
    for (const execution of view.executions) {
      if (
        (execution.status !== 'error' && execution.status !== 'unresolved') ||
        reported.current.has(execution.attemptId)
      )
        continue
      reported.current.add(execution.attemptId)
      const message = view.messages.find((item) => item.id === execution.messageId)
      const part = message?.parts.find((item) => item.type === 'data-error')
      if (part?.type !== 'data-error') continue
      const failure = new Error(part.data.message ?? 'Stream error')
      errorHandler.current?.(failure)
    }
  }, [projection])

  const dispatch = useCallback(
    async (request: AiStreamOpenRequest) => {
      const result = await streamDispatchService.dispatch(topicId, request)
      if (currentOwner.current !== owner || result.ok) return
      errorHandler.current?.(result.error)
    },
    [owner, topicId]
  )
  const sendMessage = useCallback(
    async (message?: { text: string; files?: FileUIPart[] }, options?: ChatRequestOptions) => {
      const body = (options?.body ?? {}) as Partial<AiChatRequestBody>
      const parts = body.userMessageParts ?? [
        ...(message?.files ?? []),
        ...(message ? [{ type: 'text' as const, text: message.text }] : [])
      ]
      await dispatch({
        trigger: 'submit-message',
        topicId,
        userMessageParts: parts,
        parentAnchorId: body.parentAnchorId,
        mentionedModelIds: body.mentionedModels,
        reasoningEffort: body.reasoningEffort,
        serviceTier: body.serviceTier,
        ...(body.fastMode ? { fastMode: true } : {}),
        ...(body.followUp ? { followUp: true } : {})
      })
    },
    [dispatch, topicId]
  )
  const regenerate = useCallback(
    async (options?: ChatRequestOptions) => {
      const body = (options?.body ?? {}) as Partial<AiChatRequestBody>
      await dispatch({
        trigger: 'regenerate-message',
        topicId,
        parentAnchorId: body.parentAnchorId ?? '',
        mentionedModelIds: body.mentionedModels,
        reasoningEffort: body.reasoningEffort,
        serviceTier: body.serviceTier,
        ...(body.fastMode ? { fastMode: true } : {})
      })
    },
    [dispatch, topicId]
  )
  const stop = useCallback(async () => {
    if (topicId) await ipcApi.request('ai.stream.abort', { topicId })
  }, [topicId])
  return {
    projection: projection.view?.kind === 'topic' ? projection.view : null,
    sendMessage,
    regenerate,
    stop
  }
}
