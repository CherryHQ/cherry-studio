import { memo, useEffect, useState } from 'react'

import type { AgentAttachmentSelection } from '@cherrystudio/remote-protocol/agent'
import { loggerService } from '@logger'
import MessageAttachments from '@renderer/components/chat/messages/frame/MessageAttachments'
import { MessageUserLayout } from '@renderer/components/chat/messages/frame/MessageUserLayout'
import { ipcApi } from '@renderer/ipc'

const logger = loggerService.withContext('AgentPendingAttachments')

/** The list owns geometry; this adapter owns only the remote selection subscription. */
export const AgentPendingAttachments = memo(function AgentPendingAttachments({
  sessionId,
  messageIds
}: {
  sessionId: string
  messageIds: readonly string[]
}) {
  const [snapshot, setSnapshot] = useState<{ sessionId: string; items: AgentAttachmentSelection[] }>()
  useEffect(() => {
    let retired = false
    let reading = false
    let dirty = false
    const refresh = async () => {
      dirty = true
      if (reading) return
      reading = true
      try {
        while (dirty && !retired) {
          dirty = false
          const items = await ipcApi.request('ai.agent.attachment_selections.list', { sessionId })
          if (!retired) setSnapshot({ sessionId, items })
        }
      } catch (error) {
        logger.warn('Attachment selection refresh failed', error as Error)
      } finally {
        reading = false
      }
    }
    const unsubscribe = ipcApi.on('ai.agent.attachment_selections.changed', (event) => {
      if (event.sessionId === sessionId) void refresh()
    })
    void refresh()
    return () => {
      retired = true
      unsubscribe()
    }
  }, [sessionId])
  const selections = snapshot?.sessionId === sessionId ? snapshot.items : []
  return selections
    .filter((selection) => selection.items.length && !(selection.messageId && messageIds.includes(selection.messageId)))
    .map((selection) => (
      <div key={selection.selectionId} className="pt-2.5 pb-2" data-attachment-selection={selection.selectionId}>
        <MessageUserLayout>
          {selection.items.map((item) => {
            const state = item.upload?.state
            const percent = Math.min(
              100,
              Math.floor((Number(item.upload?.committedOffset ?? 0) / Math.max(1, item.byteLength)) * 100)
            )
            const dot = item.filename.lastIndexOf('.')
            return (
              <MessageAttachments
                key={item.attachmentId}
                name={item.filename}
                ext={dot > 0 ? item.filename.slice(dot) : ''}
                size={item.byteLength}
                transfer={{ state: state === 'ready' ? 'ready' : state === 'failed' ? 'error' : 'uploading', percent }}
              />
            )
          })}
        </MessageUserLayout>
      </div>
    ))
})
