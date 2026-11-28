import { memo, useMemo, useRef } from 'react'
import { useTranslation } from 'react-i18next'

import { loggerService } from '@logger'
import { useSharedCacheValue } from '@renderer/data/hooks/useCache'
import { ipcApi } from '@renderer/ipc'
import { toast } from '@renderer/services/toast'
import {
  AGENT_SESSION_FOLLOWUPS_CACHE_KEY,
  type AgentSessionFollowup,
  type AgentSessionFollowupChange
} from '@shared/ai/agentSessionFollowups'

import { QueuedFollowupsDock } from './QueuedFollowupsDock'
import { createEditableMessageDraft } from './variants/chat/messageEditingDraft'

const logger = loggerService.withContext('NativeQueuedFollowups')

export const NativeQueuedFollowups = memo(function NativeQueuedFollowups({
  topicId,
  canSteer,
  onEdit
}: {
  topicId: string
  canSteer?: boolean
  onEdit: (topicId: string, item: AgentSessionFollowup) => void
}) {
  const { t } = useTranslation()
  const snapshot = useSharedCacheValue(AGENT_SESSION_FOLLOWUPS_CACHE_KEY(topicId))
  const queue = snapshot?.items
  const dragOrder = useRef<string[]>(undefined)
  const items = useMemo(
    () =>
      (queue ?? []).map(({ id, parts }) => {
        const { text, draftTokens } = createEditableMessageDraft(parts, id)
        return { id, draft: { text, tokens: draftTokens }, payload: { text, userMessageParts: parts } }
      }),
    [queue]
  )

  async function change(change: AgentSessionFollowupChange): Promise<boolean> {
    try {
      const applied = await ipcApi.request('ai.agent.session.change_followups', { topicId, change })
      if (!applied) toast.warning(t('chat.input.followup_queue.stale'))
      return applied
    } catch (error) {
      logger.warn('Failed to change native follow-ups', { error })
      toast.error(t('common.save_failed'))
      return false
    }
  }

  return (
    <QueuedFollowupsDock
      items={items}
      paused={snapshot?.paused}
      onTogglePause={snapshot?.paused ? () => void change({ type: 'resume' }) : undefined}
      onSteer={canSteer ? (inputId) => void change({ type: 'steer', inputId }) : undefined}
      onEdit={(id) => {
        const item = queue?.find((candidate) => candidate.id === id)
        if (item) onEdit(topicId, item)
      }}
      onRemove={(inputId) => void change({ type: 'withdraw', inputId })}
      onDragStart={() => {
        dragOrder.current = items.map(({ id }) => id)
      }}
      onReorder={(next) => {
        const before = dragOrder.current
        dragOrder.current = undefined
        if (!before || before.length !== items.length || items.some(({ id }, index) => id !== before[index])) {
          toast.warning(t('chat.input.followup_queue.stale'))
          return
        }
        void change({ type: 'reorder', before, after: next.map(({ id }) => id) })
      }}
    />
  )
})
