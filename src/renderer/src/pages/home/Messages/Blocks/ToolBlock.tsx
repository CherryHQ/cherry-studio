import type { ToolBlock as ToolBlockType } from '@renderer/types/newMessageTypes'
import React from 'react'

import MessageTools from '../MessageTools'

interface Props {
  block: ToolBlockType
}

const ToolBlock: React.FC<Props> = ({ block }) => {
  return <MessageTools message={block} />
}

export default React.memo(ToolBlock)
