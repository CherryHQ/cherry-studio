import { useEffect, useRef } from 'react'

import { usePreference } from '@data/hooks/usePreference'
import { loggerService } from '@logger'
import type { CherryUIMessage } from '@shared/data/types/message'

const logger = loggerService.withContext('useAutoContinueTruncated')

/**
 * A cap rather than a loop: a model that keeps stopping at the cap would otherwise
 * spend the day's quota one paragraph at a time.
 */
const MAX_AUTO_CONTINUES = 3

interface Params {
  topicId: string
  messages: CherryUIMessage[]
  isStreamPending: boolean
  continueTruncated: (messageId: string) => Promise<void>
}

/**
 * Carry on a reply the provider cut off at its token cap.
 *
 * Free tiers cap output low enough that a long answer stops mid-sentence, and the
 * fix — asking the model to continue — is something the user should not have to
 * think about. Runs only on a turn that settled while this hook was watching, so
 * opening a topic that already holds a truncated reply does not fire off requests.
 */
export function useAutoContinueTruncated({ topicId, messages, isStreamPending, continueTruncated }: Params) {
  const [enabled] = usePreference('chat.retry.auto_continue_truncated')
  const attemptsRef = useRef(new Map<string, number>())
  const watchedRef = useRef<{ topicId: string; isStreamPending: boolean } | undefined>(undefined)

  useEffect(() => {
    const previous = watchedRef.current
    watchedRef.current = { topicId, isStreamPending }

    // Only a settle observed on this same topic counts; a topic switch is not a settle.
    const settled = previous?.topicId === topicId && previous.isStreamPending && !isStreamPending
    if (!enabled || !settled) return

    const last = messages.at(-1)
    if (last?.role !== 'assistant') return
    if (last.metadata?.status !== 'success') return
    if (last.metadata?.stats?.finishReason !== 'length') return

    const attempts = attemptsRef.current.get(last.id) ?? 0
    if (attempts >= MAX_AUTO_CONTINUES) return
    attemptsRef.current.set(last.id, attempts + 1)

    void continueTruncated(last.id).catch((error) => {
      logger.warn('auto-continue failed, leaving the reply as it is', { messageId: last.id, error })
    })
  }, [continueTruncated, enabled, isStreamPending, messages, topicId])
}
