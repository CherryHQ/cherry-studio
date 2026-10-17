import { memo } from 'react'

import type { AgentAttachmentSelection } from '@cherrystudio/remote-protocol/agent'

import MessageAttachments from './MessageAttachments'
import { MessageUserLayout } from './MessageUserLayout'

type Selection = Pick<AgentAttachmentSelection, 'selectionId' | 'messageId' | 'items'>

/** Files a paired device is still sending; hidden once the message that carries them is in the list. */
export const RemotePendingAttachments = memo(function RemotePendingAttachments({
  selections,
  messageIds
}: {
  selections: readonly Selection[]
  messageIds: readonly string[]
}) {
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
