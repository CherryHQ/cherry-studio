import { useEffect, useEffectEvent, useMemo, useState } from 'react'

import { loggerService } from '@logger'
import { projectedReplies, type TopicView } from '@renderer/utils/message/projectedReplies'
import { type ActiveExecution, classifyTurn, type TopicStreamStatus } from '@shared/ai/transport'
import type { CherryUIMessage } from '@shared/data/types/message'

import type { ReplyHistory } from './useHistoryRowUpdates'

const logger = loggerService.withContext('useHistoryReplies')
// A failed read may retain a streamed reply until a later history update replaces that row.
type Handoff = { accepted: true } | { accepted: false; before?: WeakRef<object> }

function historyOwns(
  row: Extract<ReturnType<ReplyHistory['lookup']>, { kind: 'row' }>['row'],
  handoff?: Handoff
): boolean {
  return row.status !== 'pending' && !!handoff && (handoff.accepted || row !== handoff.before?.deref())
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
    ready && history.layout
      ? replies.flatMap(({ execution }) =>
          execution.savedMessageId ? [{ attemptId: execution.attemptId, id: execution.savedMessageId }] : []
        )
      : []
  const key = JSON.stringify(saved)
  const adopt = useEffectEvent((current: () => boolean) => {
    if (!topicId) return
    for (const { attemptId, id } of saved) {
      const member = history.lookup(id)
      if (member.kind === 'excluded') continue
      if (
        member.kind === 'row' &&
        handoff?.topicId === topicId &&
        historyOwns(member.row, handoff.attempts.get(attemptId))
      )
        continue
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
      const unconfirmed: Handoff = {
        accepted: false,
        before: member.kind === 'row' ? new WeakRef(member.row) : undefined
      }
      void history.refreshRow(id).then(
        (outcome) => record(outcome === 'written' ? { accepted: true } : unconfirmed),
        (error) => {
          logger.warn('Could not read committed reply', { topicId, id, error })
          record(unconfirmed)
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
  }, [topicId, key, history.layout])

  return useMemo(
    () =>
      replies.flatMap(({ execution, message }) => {
        const id = execution.savedMessageId
        const result = handoff?.topicId === topicId ? handoff?.attempts.get(execution.attemptId) : undefined
        if (id && history.layout && (result || ready)) {
          const member = history.lookup(id)
          if (member.kind === 'excluded' || (member.kind === 'unknown' && result?.accepted)) return []
          if (member.kind === 'row' && historyOwns(member.row, result)) return []
        }
        return [message]
      }),
    [replies, topicId, history, handoff, ready]
  )
}
