import type { MarkdownSource } from '@cherrystudio/ui/composites/markdown'
import { ChatMarkdown } from '@renderer/components/chat/messages'
import type { MainTextMessageBlock } from '@renderer/types/newMessage'
import React from 'react'

interface Props {
  block: MainTextMessageBlock
}

const MessageContent: React.FC<Props> = ({ block }) => {
  const markdownSource: MarkdownSource = {
    id: block.id,
    content: block.content,
    status: String(block.status).toLowerCase()
  }

  return <ChatMarkdown block={markdownSource} />
}

export default React.memo(MessageContent)
