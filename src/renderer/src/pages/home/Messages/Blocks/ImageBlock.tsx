import type { ImageMessageBlock } from '@renderer/types/newMessage'
import React from 'react'

import MessageImage from '../MessageImage'

interface Props {
  block: ImageMessageBlock
}

const ImageBlock: React.FC<Props> = ({ block }) => {
  return <MessageImage block={block} />
}

export default React.memo(ImageBlock)
