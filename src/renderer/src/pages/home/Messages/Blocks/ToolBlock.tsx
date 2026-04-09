import type { ToolMessageBlock } from '@renderer/types/newMessage'
import React from 'react'

import MessageTools from '../Tools/MessageTools'
import { getToolResponseFromBlock } from '../Tools/toolResponse'

interface Props {
  block: ToolMessageBlock
}

const ToolBlock: React.FC<Props> = ({ block }) => {
  const toolResponse = getToolResponseFromBlock(block)
  if (!toolResponse) return null
  return <MessageTools toolResponse={toolResponse} />
}

export default React.memo(ToolBlock)
