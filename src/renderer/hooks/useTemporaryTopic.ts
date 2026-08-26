/**
 * useTemporaryTopic — lease a short-lived in-memory topic on the Main process.
 *
 * Used by single-turn quick assistants (selection toolbar, mini window) and
 * the first-launch HomePage to obtain a topic id whose messages live in
 * `TemporaryChatService` (not SQLite), so their scratch conversations never
 * pollute the user's persistent chat history.
 *
 * Lifecycle:
 *   - On mount (with `enabled: true`): POST /temporary/topics
 *   - On unmount / when `enabled` flips false / when `assistantId` changes:
 *     DELETE /temporary/topics/:id
 *   - Consumers can call `reset()` to drop the current topic and lease a
 *     fresh one (used by "new conversation" actions in the mini window).
 *
 * The returned `ready` flag guards the `useChat` call-site — consumers should
 * only submit messages once `ready` is true; until then `topicId` is `null`.
 *
 * Race handling: if the component unmounts (or reset is called) before the
 * POST resolves, the hook still deletes the freshly created topic to avoid
 * Main-side leaks.
 */

import { dataApiService } from '@data/DataApiService'
import { loggerService } from '@logger'
import type { Topic as TemporaryTopic } from '@shared/data/types/topic'
import { clampSurrogateBoundary } from '@shared/utils/text'
import { useCallback, useEffect, useRef, useState } from 'react'

const logger = loggerService.withContext('useTemporaryTopic')
const TEMPORARY_TOPIC_NAME_MAX_LENGTH = 30

export interface UseTemporaryTopicOptions {
  /**
   * When falsy, no temp topic is leased and `topicId` stays `null`.
   * When truthy, a temp topic is leased. Default: `true` when `assistantId`
   * is provided, `false` otherwise — but callers wanting to lease a temp
   * topic *without* an assistant (e.g. HomePage first-launch) must pass
   * `enabled: true` explicitly.
   */
  enabled?: boolean
  /**
   * Optional persisted assistant id to bind the temp topic to. `undefined`
   * means the topic has no associated assistant — main composes capabilities
   * from the default model preference.
   */
  assistantId?: string
}

export interface UseTemporaryTopicResult {
  /** Null until the temporary topic is created on Main. */
  topicId: string | null
  /** The leased topic entity, for consumers that render it (name, timestamps). */
  topic: TemporaryTopic | null
  /** True once `topicId` is available. */
  ready: boolean
  /** Drop the current topic and lease a fresh one. No-op when disabled. */
  reset: () => void
  /** Move the temporary topic (plus its messages) into SQLite. */
  persist: (initialName?: string) => Promise<void>
}

export function useTemporaryTopic(options: UseTemporaryTopicOptions = {}): UseTemporaryTopicResult {
  const { assistantId, enabled = assistantId !== undefined } = options
  const [topic, setTopic] = useState<TemporaryTopic | null>(null)
  const topicId = topic?.id ?? null
  /** Bumped by `reset()` to force the effect to re-run and allocate a new topic. */
  const [epoch, setEpoch] = useState(0)
  /** The lease `persist()` acts on. Each effect run tracks its own id separately. */
  const leaseRef = useRef<string | null>(null)
  /** Leases that reached SQLite, so releasing them would delete a real topic. */
  const persistedIdsRef = useRef(new Set<string>())

  const releaseLease = useCallback((id: string, reason: string) => {
    if (persistedIdsRef.current.has(id)) return
    void dataApiService.delete(`/temporary/topics/${id}`).catch((err) => {
      logger.warn(reason, err as Error)
    })
  }, [])

  useEffect(() => {
    if (!enabled) {
      setTopic(null)
      return
    }

    let cancelled = false
    // Scoped to this run, not shared: two overlapping leases would otherwise overwrite
    // each other's id and leak whichever topic the user is actually looking at.
    let createdId: string | null = null

    const body = assistantId ? { assistantId } : {}

    void dataApiService
      .post('/temporary/topics', { body })
      .then((created) => {
        createdId = created.id
        if (cancelled) {
          releaseLease(created.id, 'Failed to cleanup racing temporary topic')
          return
        }
        leaseRef.current = created.id
        setTopic(created)
        logger.debug('Leased temporary topic', { topicId: created.id, assistantId, epoch })
      })
      .catch((err) => {
        logger.error('Failed to create temporary topic', err as Error)
      })

    return () => {
      cancelled = true
      setTopic(null)
      if (createdId) {
        if (leaseRef.current === createdId) leaseRef.current = null
        releaseLease(createdId, 'Failed to release temporary topic on unmount')
      }
    }
  }, [enabled, assistantId, epoch, releaseLease])

  const reset = useCallback(() => {
    setEpoch((n) => n + 1)
  }, [])

  const persist = useCallback(async (initialName?: string) => {
    const id = leaseRef.current
    if (!id) return
    // Claim before the request so a concurrent reset/unmount cannot DELETE the topic
    // mid-persist, and give the claim back on failure so the save stays retryable.
    persistedIdsRef.current.add(id)
    try {
      await dataApiService.post(`/temporary/topics/${id}/persist`, { body: {} })
    } catch (err) {
      persistedIdsRef.current.delete(id)
      throw err
    }
    if (leaseRef.current === id) leaseRef.current = null
    logger.debug('Persisted temporary topic', { topicId: id })

    const trimmed = initialName?.trim()
    if (trimmed) {
      try {
        await dataApiService.patch(`/topics/${id}`, {
          body: {
            name: trimmed.slice(0, clampSurrogateBoundary(trimmed, TEMPORARY_TOPIC_NAME_MAX_LENGTH)),
            isNameManuallyEdited: false
          }
        })
      } catch (err) {
        logger.warn('Failed to seed placeholder topic name', err as Error)
      }
    }
  }, [])

  return { topicId, topic, ready: topicId !== null, reset, persist }
}
