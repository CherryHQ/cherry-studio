import type { ChatRequestOptions, FileUIPart } from 'ai'
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'

import { ipcApi } from '@renderer/ipc'
import { messageProjectionService, streamDispatchService } from '@renderer/services/aiTransport'
import type { AiChatRequestBody, AiStreamOpenRequest } from '@shared/ai/transport'
import type { CherryUIMessage } from '@shared/data/types/message'

const EMPTY_MESSAGES: CherryUIMessage[] = []

/** Sends commands and retains local input; assistant output comes from the shared projection. */
export function useStreamCommands(
  topicId: string,
  initialMessages: CherryUIMessage[] = EMPTY_MESSAGES,
  onError?: (error: Error) => void
) {
  const [local, setLocal] = useState({ topicId, messages: initialMessages })
  const [error, setError] = useState<Error>()
  const initialRef = useRef(initialMessages)
  initialRef.current = initialMessages
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
    setLocal({ topicId, messages: initialRef.current })
    setError(undefined)
    reported.current.clear()
  }, [topicId])

  useEffect(() => {
    const view = projection.view
    if (view?.kind !== 'topic') return
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
      setError(failure)
      errorHandler.current?.(failure)
    }
  }, [projection])

  const setMessages = useCallback(
    (update: CherryUIMessage[] | ((messages: CherryUIMessage[]) => CherryUIMessage[])) => {
      setLocal((previous) => ({
        topicId,
        messages:
          typeof update === 'function'
            ? update(previous.topicId === topicId ? previous.messages : initialRef.current)
            : update
      }))
    },
    [topicId]
  )
  const dispatch = useCallback(
    async (request: AiStreamOpenRequest) => {
      setError(undefined)
      const result = await streamDispatchService.dispatch(topicId, request)
      if (currentOwner.current !== owner || result.ok) return
      setError(result.error)
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
      setMessages((messages) => [...messages, { id: crypto.randomUUID(), role: 'user', parts }])
      await dispatch({
        trigger: 'submit-message',
        topicId,
        userMessageParts: parts,
        parentAnchorId: body.parentAnchorId,
        mentionedModelIds: body.mentionedModels,
        reasoningEffort: body.reasoningEffort,
        serviceTier: body.serviceTier,
        ...(body.fastMode ? { fastMode: true } : {})
      })
    },
    [dispatch, setMessages, topicId]
  )
  const regenerate = useCallback(
    async (options?: ChatRequestOptions & { messageId?: string }) => {
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
    messages: local.topicId === topicId ? local.messages : initialMessages,
    setMessages,
    sendMessage,
    regenerate,
    stop,
    error
  }
}
