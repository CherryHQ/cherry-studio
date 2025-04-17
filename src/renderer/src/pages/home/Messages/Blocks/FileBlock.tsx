import type { FileMessageBlock, Message } from '@renderer/types/newMessageTypes'
import React from 'react'

import MessageAttachments from '../MessageAttachments'

interface Props {
  block: FileMessageBlock
}

const FileBlock: React.FC<Props> = ({ block }) => {
  // 创建一个最小的Message对象以便复用MessageAttachments组件
  const minimalMessage: Partial<Message> = {
    id: block.messageId,
    role: 'assistant',
    files: [block.file],
    assistantId: '',
    topicId: '',
    createdAt: '',
    status: 'success',
    type: 'text',
    blocks: [block.id]
  } as unknown as Message

  return <MessageAttachments message={minimalMessage} />
}

export default React.memo(FileBlock)