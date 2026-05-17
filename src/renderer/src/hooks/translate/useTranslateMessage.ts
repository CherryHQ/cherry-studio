/**
 * Message-bound translation hook for the `MessageMenubar` "translate this
 * reply" flow.
 *
 * Drives a stream entirely through main:
 *   - `window.api.translate.open({ ..., messageId })` opens a stream with a
 *     `TranslationBackend` attached on main.
 *   - chunks land via `Ai_StreamChunk` → we accumulate locally and write into
 *     the renderer-side `TranslationOverlayContext` (no SWR PATCH).
 *   - `Ai_StreamDone` is dispatched after main's persistence listener
 *     completes the DB write (listener order in `TranslateService.open` puts
 *     Persistence before WebContents, and the manager awaits each terminal
 *     callback serially). On `status: 'success'` we refresh the messages
 *     cache and clear the overlay so the persisted `data-translation` part
 *     becomes the source of truth. On `paused` (cancel) or `Ai_StreamError`
 *     we just clear the overlay — main wrote nothing.
 *
 * Orphan translations (selection translate, translate page) keep using
 * `useTranslate` + local accumulation — they don't need persistence and
 * don't go through this hook.
 */

import { loggerService } from '@logger'
import { useV2Chat } from '@renderer/hooks/V2ChatContext'
import { useTranslationOverlaySetter } from '@renderer/pages/home/Messages/Blocks/V2Contexts'
import type { TranslateLanguage } from '@renderer/types'
import type { TranslateLangCode } from '@shared/data/preference/preferenceTypes'
import { useCallback, useEffect, useRef } from 'react'
import { v4 as uuid } from 'uuid'

const logger = loggerService.withContext('useTranslateMessage')

/** Renderer-side prefix mirrors main's `TRANSLATE_STREAM_PREFIX` check. */
const TRANSLATE_STREAM_PREFIX = 'translate:'

export interface UseTranslateMessageResult {
  /** Start a translation for this message. Resolves once `translate.open` has dispatched (not on stream completion). */
  translate: (text: string, language: TranslateLanguage) => Promise<void>
  /** Abort the current stream (if any). Cleanup of subscriptions still happens via `onStreamError` / `onStreamDone`. */
  cancel: () => void
}

interface ActiveStream {
  streamId: string
  unsubscribers: Array<() => void>
}

export function useTranslateMessage(messageId: string): UseTranslateMessageResult {
  const setOverlay = useTranslationOverlaySetter()
  const v2 = useV2Chat()
  const activeRef = useRef<ActiveStream | null>(null)

  const teardown = useCallback((expectedStreamId: string | null) => {
    const active = activeRef.current
    if (!active) return
    if (expectedStreamId && active.streamId !== expectedStreamId) return
    for (const off of active.unsubscribers) {
      try {
        off()
      } catch {
        // best-effort
      }
    }
    activeRef.current = null
  }, [])

  // Tear down on unmount so subscriptions don't leak past the component.
  useEffect(() => {
    return () => teardown(null)
  }, [teardown])

  const translate = useCallback<UseTranslateMessageResult['translate']>(
    async (text, language) => {
      // A second translate on the same message cancels the previous one — the
      // user is explicitly asking for a different target. Server-side abort
      // is best-effort; the renderer teardown is the source of truth.
      if (activeRef.current) {
        void window.api.ai.streamAbort({ topicId: activeRef.current.streamId }).catch(() => {})
        teardown(null)
      }

      const streamId = `${TRANSLATE_STREAM_PREFIX}${uuid()}`
      const active: ActiveStream = { streamId, unsubscribers: [] }
      activeRef.current = active

      // Seed the overlay with an empty entry BEFORE opening the stream so
      // the data-translation part exists from t=0. Without this, `Markdown`
      // would first mount when the first chunk lands (with that chunk as
      // its initial `useState` content) and skip the typewriter for chunk
      // 1 entirely — leading to a one-shot reveal when translations come
      // back as 1–2 big chunks. With the empty seed, `Markdown` mounts at
      // content="" and every subsequent chunk goes through `addChunk` so
      // the smooth-stream typewriter engages from the very first delta.
      let accumulated = ''
      setOverlay(messageId, {
        content: '',
        targetLanguage: language.langCode as TranslateLangCode
      })

      const unsubChunk = window.api.ai.onStreamChunk(({ topicId, chunk }) => {
        if (topicId !== streamId) return
        if (
          chunk &&
          (chunk as { type?: string }).type === 'text-delta' &&
          typeof (chunk as { delta?: unknown }).delta === 'string'
        ) {
          accumulated += (chunk as { delta: string }).delta
          setOverlay(messageId, {
            content: accumulated,
            targetLanguage: language.langCode as TranslateLangCode
          })
        }
      })

      const unsubDone = window.api.ai.onStreamDone(async ({ topicId, status }) => {
        if (topicId !== streamId) return
        if (status === 'success') {
          try {
            await v2?.refresh()
          } catch (err) {
            logger.warn('refresh after translation done failed', err as Error)
          }
        }
        setOverlay(messageId, null)
        teardown(streamId)
      })

      const unsubError = window.api.ai.onStreamError(({ topicId }) => {
        if (topicId !== streamId) return
        setOverlay(messageId, null)
        teardown(streamId)
      })

      active.unsubscribers = [unsubChunk, unsubDone, unsubError]

      try {
        await window.api.translate.open({
          streamId,
          text,
          targetLangCode: language.langCode,
          messageId
        })
      } catch (err) {
        logger.error('translate.open failed', err as Error)
        setOverlay(messageId, null)
        teardown(streamId)
        throw err
      }
    },
    [messageId, setOverlay, teardown, v2]
  )

  const cancel = useCallback(() => {
    const active = activeRef.current
    if (!active) return
    void window.api.ai.streamAbort({ topicId: active.streamId }).catch(() => {})
    // onStreamError / onStreamDone (status: 'paused') will clear the overlay.
  }, [])

  return { translate, cancel }
}
