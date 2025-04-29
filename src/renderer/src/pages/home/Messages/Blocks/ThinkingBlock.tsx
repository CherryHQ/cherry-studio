import type { ThinkingMessageBlock } from '@renderer/types/newMessage'
import React from 'react'

import MessageThought from '../MessageThought'
interface Props {
  block: ThinkingMessageBlock
}

const ThinkingBlock: React.FC<Props> = ({ block }) => {
  // 创建思考过程的显示组件
  return <MessageThought message={block} />
}

export default React.memo(ThinkingBlock)
