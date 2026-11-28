import { memo, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button, Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, Textarea } from '@cherrystudio/ui'
import { loggerService } from '@logger'
import { useSharedCacheValue } from '@renderer/data/hooks/useCache'
import { ipcApi } from '@renderer/ipc'
import { toast } from '@renderer/services/toast'
import {
  AGENT_SESSION_FOLLOWUPS_CACHE_KEY,
  type AgentSessionFollowup,
  type AgentSessionFollowupChange,
  readFollowupText
} from '@shared/ai/agentSessionFollowups'

import { QueuedFollowupsDock } from './QueuedFollowupsDock'
import { createEditableMessageDraft } from './variants/chat/messageEditingDraft'

const logger = loggerService.withContext('NativeQueuedFollowups')

export const NativeQueuedFollowups = memo(function NativeQueuedFollowups({
  topicId,
  canSteer
}: {
  topicId: string
  canSteer?: boolean
}) {
  const { t } = useTranslation()
  const queue = useSharedCacheValue(AGENT_SESSION_FOLLOWUPS_CACHE_KEY(topicId))
  const [edit, setEdit] = useState<{ item: AgentSessionFollowup; text: string }>()
  const [saving, setSaving] = useState(false)
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
    <>
      <QueuedFollowupsDock
        items={items}
        onSteer={canSteer ? (inputId) => void change({ type: 'steer', inputId }) : undefined}
        onEdit={(id) => {
          const item = queue?.find((candidate) => candidate.id === id)
          if (item) setEdit({ item, text: readFollowupText(item.parts) })
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
      {edit ? (
        <Dialog open onOpenChange={(open) => !open && !saving && setEdit(undefined)}>
          <DialogContent size="sm">
            <form
              className="flex flex-col gap-4"
              onSubmit={async (event) => {
                event.preventDefault()
                if (saving) return
                setSaving(true)
                const applied = await change({
                  type: 'edit',
                  inputId: edit.item.id,
                  revision: edit.item.revision,
                  text: edit.text
                })
                if (applied) setEdit(undefined)
                setSaving(false)
              }}>
              <DialogHeader>
                <DialogTitle>{t('chat.input.followup_queue.edit')}</DialogTitle>
              </DialogHeader>
              <Textarea.Input
                aria-label={t('chat.input.followup_queue.edit')}
                rows={4}
                disabled={saving}
                value={edit.text}
                onValueChange={(text) => setEdit({ ...edit, text })}
              />
              <DialogFooter>
                <Button type="button" variant="outline" disabled={saving} onClick={() => setEdit(undefined)}>
                  {t('common.cancel')}
                </Button>
                <Button
                  type="submit"
                  variant="emphasis"
                  loading={saving}
                  disabled={!edit.text.trim() && !edit.item.parts.some((part) => part.type === 'file')}>
                  {t('common.save')}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      ) : null}
    </>
  )
})
