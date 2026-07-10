import MessageList from '@renderer/components/chat/messages/MessageList'
import { MessageListProvider } from '@renderer/components/chat/messages/MessageListProvider'
import type { MessageListProviderValue } from '@renderer/components/chat/messages/types'
import { memo } from 'react'

interface MessageImageCaptureHostProps {
  captureHostAttribute: string
  messageList: MessageListProviderValue
  ready: boolean
  testId: string
}

const MessageImageCaptureHost = ({
  captureHostAttribute,
  messageList,
  ready,
  testId
}: MessageImageCaptureHostProps) => {
  if (!ready) return null

  return (
    <div
      aria-hidden="true"
      className="-left-[10000px] pointer-events-none fixed top-0 h-px w-[960px] overflow-hidden bg-background text-foreground"
      data-testid={testId}
      inert
      {...{ [captureHostAttribute]: '' }}>
      <MessageListProvider value={messageList}>
        <MessageList />
      </MessageListProvider>
    </div>
  )
}

export default memo(MessageImageCaptureHost)
