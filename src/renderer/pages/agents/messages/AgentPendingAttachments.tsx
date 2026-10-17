import { memo, useCallback } from 'react'

import { RemotePendingAttachments } from '@renderer/components/chat/messages/frame/RemotePendingAttachments'
import { useRemoteAttachmentSelections } from '@renderer/hooks/chat/useRemoteAttachmentSelections'
import { ipcApi } from '@renderer/ipc'

/** The list owns geometry; this adapter owns only the remote selection subscription. */
export const AgentPendingAttachments = memo(function AgentPendingAttachments({
  sessionId,
  messageIds
}: {
  sessionId: string
  messageIds: readonly string[]
}) {
  const load = useCallback(() => ipcApi.request('ai.agent.attachment_selections.list', { sessionId }), [sessionId])
  const subscribe = useCallback(
    (onChange: () => void) =>
      ipcApi.on('ai.agent.attachment_selections.changed', (event) => {
        if (event.sessionId === sessionId) onChange()
      }),
    [sessionId]
  )
  const selections = useRemoteAttachmentSelections(sessionId, load, subscribe)
  return <RemotePendingAttachments selections={selections} messageIds={messageIds} />
})
