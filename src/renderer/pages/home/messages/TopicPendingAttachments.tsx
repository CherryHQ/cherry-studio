import { memo, useCallback } from 'react'

import { RemotePendingAttachments } from '@renderer/components/chat/messages/frame/RemotePendingAttachments'
import { useRemoteAttachmentSelections } from '@renderer/hooks/chat/useRemoteAttachmentSelections'
import { ipcApi } from '@renderer/ipc'

/** The list owns geometry; this adapter owns only the remote selection subscription. */
export const TopicPendingAttachments = memo(function TopicPendingAttachments({
  topicId,
  messageIds
}: {
  topicId: string
  messageIds: readonly string[]
}) {
  const load = useCallback(() => ipcApi.request('ai.topic.attachment_selections.list', { topicId }), [topicId])
  const subscribe = useCallback(
    (onChange: () => void) =>
      ipcApi.on('ai.topic.attachment_selections.changed', (event) => {
        if (event.topicId === topicId) onChange()
      }),
    [topicId]
  )
  const selections = useRemoteAttachmentSelections(topicId, load, subscribe)
  return <RemotePendingAttachments selections={selections} messageIds={messageIds} />
})
