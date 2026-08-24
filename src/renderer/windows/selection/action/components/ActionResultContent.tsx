import MessageContent from '@renderer/components/chat/messages/frame/MessageContent'
import { useMessageListRenderConfig } from '@renderer/components/chat/messages/hooks/useMessageListRenderConfig'
import { useMessagePlatformActions } from '@renderer/components/chat/messages/hooks/useMessagePlatformActions'
import { MessageContentProvider } from '@renderer/components/chat/messages/MessageContentProvider'
import type { MessageListItem } from '@renderer/components/chat/messages/types'
import type { CherryMessagePart } from '@shared/data/types/message'
import type { FC } from 'react'

interface Props {
  message: MessageListItem
  partsByMessageId: Record<string, CherryMessagePart[]>
}

/**
 * Lazy boundary (S6b): the streamed-result renderer wraps the heavy message
 * content chain (ChatMarkdown, CodeMirror, katex, mermaid, platform actions).
 * ActionGeneral/ActionTranslate call `preloadActionResultContent()` on mount —
 * React.lazy alone would only start this import once the first result renders,
 * serializing chunk load after the model response instead of alongside it.
 */
const ActionResultContent: FC<Props> = ({ message, partsByMessageId }) => {
  const { renderConfig } = useMessageListRenderConfig()
  const platformActions = useMessagePlatformActions()
  return (
    <MessageContentProvider
      messages={[message]}
      partsByMessageId={partsByMessageId}
      renderConfig={renderConfig}
      actions={platformActions}>
      <MessageContent key={message.id} message={message} />
    </MessageContentProvider>
  )
}

export default ActionResultContent
