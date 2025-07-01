import type { ToolMessageBlock } from '@renderer/types/newMessage'
import React from 'react'

import MessageTools from '../MessageTools'

interface Props {
  block: ToolMessageBlock
}

const ToolBlock: React.FC<Props> = ({ block }) => {
  return <MessageTools block={block} />
}

export default React.memo(ToolBlock)
