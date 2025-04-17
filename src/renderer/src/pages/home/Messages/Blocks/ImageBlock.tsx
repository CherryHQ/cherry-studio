import type { ImageMessageBlock } from '@renderer/types/newMessageTypes'
import React from 'react'

import MessageImage from '../MessageImage'

interface Props {
  block: ImageMessageBlock
}

const ImageBlock: React.FC<Props> = ({ block }) => {
  return block.metadata?.generateImage && <MessageImage message={block} />
}

export default React.memo(ImageBlock)
