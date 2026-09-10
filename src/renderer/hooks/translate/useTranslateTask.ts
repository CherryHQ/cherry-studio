import { loggerService } from '@logger'
import { ipcApi, useIpcOn } from '@renderer/ipc'
import type { TranslateLangCode } from '@shared/data/preference/preferenceTypes'
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'

import type { TranslateSessionHandle } from './useTranslateSession'

const logger = loggerService.withContext('useTranslateTask')

export interface TranslateTaskRequest {
  text: string
  sourceLangCode: TranslateLangCode | 'auto'
  targetLangCode: TranslateLangCode
  bidirectional: boolean
  bidirectionalPair: [TranslateLangCode, TranslateLangCode]
}

export interface UseTranslateTaskOptions {
  /** The text produced so far, as it grows. Feed it to whatever renders the output. */
  onText: (accumulated: string) => void
  /** The run finished with `text`. A one-shot reaction — a page that was away misses it. */
  onCompleted: (text: string, sourceLangCode: TranslateLangCode | undefined) => void
  /** The run failed, with a bare i18n key. Deciding whether to show it is the page's call. */
  onFailed: (messageKey: string) => void
}

export interface UseTranslateTaskResult {
  isBusy: boolean
  detectedSourceLanguage: TranslateLangCode | null
  start: (request: TranslateTaskRequest) => Promise<void>
  cancel: () => void
}

/**
 * Follow the translation this tab owns, wherever it is running.
 *
 * The task lives in main (see `translate.task.*`), so this hook is a view of it rather than its
 * owner: it re-attaches on mount, replays what it missed, and forwards the text as it arrives.
 * That is what lets a translation survive a tab switch, a hibernation, and a detach — the last of
 * which destroys this renderer entirely.
 */
export function useTranslateTask(
  session: TranslateSessionHandle,
  { onText, onCompleted, onFailed }: UseTranslateTaskOptions
): UseTranslateTaskResult {
  const isBusy = useSyncExternalStore(session.subscribe, session.isBusy)
  const [detectedSourceLanguage, setDetectedSourceLanguage] = useState<TranslateLangCode | null>(null)
  const streamIdRef = useRef<string | undefined>(undefined)
  const accumulatedRef = useRef('')
  /** Releases the session's hold on the task. Main drops a settled task; this is the other half. */
  const finishTaskRef = useRef<(() => void) | undefined>(undefined)

  const onTextRef = useRef(onText)
  onTextRef.current = onText
  const onCompletedRef = useRef(onCompleted)
  onCompletedRef.current = onCompleted
  const onFailedRef = useRef(onFailed)
  onFailedRef.current = onFailed

  // Re-attach on mount: the task kept running while this page had no effects — or no existence at
  // all, after a detach — so what it produced meanwhile is only here for the asking.
  useEffect(() => {
    const taskId = session.currentTaskId()
    if (!taskId) return
    let cancelled = false
    void ipcApi
      .request('translate.task.attach', { taskId })
      .then((state) => {
        if (cancelled || !state) return
        streamIdRef.current = state.streamId
        accumulatedRef.current = state.accumulated
        finishTaskRef.current = session.addTask(state.taskId)
        setDetectedSourceLanguage(state.detectedSourceLanguage)
        if (state.accumulated) onTextRef.current(state.accumulated)
      })
      .catch((error: unknown) => {
        logger.error('Failed to re-attach to translate task', error as Error)
      })
    return () => {
      cancelled = true
    }
  }, [session])

  useIpcOn('ai.stream.chunk', ({ topicId, chunk }) => {
    if (topicId !== streamIdRef.current) return
    if ((chunk as { type?: string }).type !== 'text-delta') return
    const delta = (chunk as { delta?: unknown }).delta
    if (typeof delta !== 'string') return
    accumulatedRef.current += delta
    onTextRef.current(accumulatedRef.current)
  })

  useIpcOn('translate.task.state', (state) => {
    if (state.taskId !== session.currentTaskId()) return
    setDetectedSourceLanguage(state.detectedSourceLanguage)
  })

  useIpcOn('translate.task.completed', ({ taskId, text, sourceLangCode }) => {
    if (taskId !== session.currentTaskId()) return
    accumulatedRef.current = text
    finishTaskRef.current?.()
    onTextRef.current(text)
    onCompletedRef.current(text, sourceLangCode)
  })

  useIpcOn('translate.task.aborted', ({ taskId }) => {
    if (taskId !== session.currentTaskId()) return
    finishTaskRef.current?.()
  })

  useIpcOn('translate.task.failed', ({ taskId, messageKey }) => {
    if (taskId !== session.currentTaskId()) return
    finishTaskRef.current?.()
    onFailedRef.current(messageKey)
  })

  const start = useCallback(
    async (request: TranslateTaskRequest) => {
      if (session.isBusy()) return
      accumulatedRef.current = ''
      setDetectedSourceLanguage(null)
      onTextRef.current('')
      const { taskId, streamId } = await ipcApi.request('translate.task.start', request)
      streamIdRef.current = streamId
      finishTaskRef.current = session.addTask(taskId)
    },
    [session]
  )

  const cancel = useCallback(() => {
    session.cancel()
  }, [session])

  return { isBusy, detectedSourceLanguage, start, cancel }
}
