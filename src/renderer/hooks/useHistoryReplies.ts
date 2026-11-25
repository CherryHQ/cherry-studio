import { useEffect, useEffectEvent, useMemo, useState } from 'react'

import { loggerService } from '@logger'
import { projectedReplies, type TopicView } from '@renderer/utils/message/projectedReplies'
import { type ActiveExecution, classifyTurn, type TopicStreamStatus } from '@shared/ai/transport'
import type { CherryUIMessage } from '@shared/data/types/message'

import type { ReplyHistory } from './useHistoryRowUpdates'

const logger = loggerService.withContext('useHistoryReplies')
// A failed read may retain a streamed reply until a later history update replaces that row.
type Handoff = { accepted: true } | { accepted: false; before?: WeakRef<object> }

function historyOwns(row: ReturnType<ReplyHistory['get']>, handoff?: Handoff): boolean {
  return !!row && row.status !== 'pending' && !!handoff && (handoff.accepted || row !== handoff.before?.deref())
}

export function useHistoryReplies(
  view: TopicView | null,
  expected: readonly ActiveExecution[],
  history: ReplyHistory,
  status: TopicStreamStatus | undefined
): CherryUIMessage[] {
  const [handoff, setHandoff] = useState<{ topicId: string; attempts: Map<number, Handoff> }>()
  const replies = useMemo(() => projectedReplies(view, expected), [view, expected])
  const topicId = view?.topicId
  const turn = classifyTurn(status)
  const ready =
    !turn.isAwaitingApproval &&
    (turn.isTerminal || (turn.isStreamLive && replies.some(({ execution }) => execution.status === 'active')))
  const saved =
    ready && history.loaded
      ? replies.flatMap(({ execution }) =>
          execution.savedMessageId && history.has(execution.savedMessageId)
            ? [{ attemptId: execution.attemptId, id: execution.savedMessageId }]
            : []
        )
      : []
  const key = JSON.stringify(saved)
  const adopt = useEffectEvent((current: () => boolean) => {
    if (!topicId) return
    for (const { attemptId, id } of saved) {
      const before = history.get(id)
      if (handoff?.topicId === topicId && historyOwns(before, handoff.attempts.get(attemptId))) continue
      const record = (outcome: Handoff) => {
        if (!current()) return
        setHandoff((previous) => {
          const attempts = new Map(
            saved.flatMap(({ attemptId: active }) => {
              const result = previous?.topicId === topicId && previous.attempts.get(active)
              return result ? [[active, result] as const] : []
            })
          )
          attempts.set(attemptId, outcome)
          return { topicId, attempts }
        })
      }
      void history.refreshRow(id).then(
        () => record({ accepted: true }),
        (error) => {
          logger.warn('Could not read committed reply', { topicId, id, error })
          record({ accepted: false, before: before && new WeakRef(before) })
        }
      )
    }
  })
  // A new branch page can still contain the placeholder from before this commit.
  useEffect(() => {
    let current = true
    adopt(() => current)
    return () => {
      current = false
    }
  }, [topicId, key, history.has])

  return useMemo(
    () =>
      replies.flatMap(({ execution, message }) => {
        const id = execution.savedMessageId
        const result = handoff?.topicId === topicId ? handoff?.attempts.get(execution.attemptId) : undefined
        if (id && history.loaded && (result || ready)) {
          const row = history.get(id)
          if (!row) return []
          if (historyOwns(row, result)) return []
        }
        return [message]
      }),
    [replies, topicId, history, handoff, ready]
  )
}
