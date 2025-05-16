import type { FileMessageBlock } from '@renderer/types/newMessage'
import React from 'react'

import MessageAttachments from '../MessageAttachments'

interface Props {
  block: FileMessageBlock
}

const FileBlock: React.FC<Props> = ({ block }) => {
  return <MessageAttachments block={block} />
}

export default React.memo(FileBlock)
