import SvgSpinners180Ring from '@renderer/components/Icons/SvgSpinners180Ring'
import type { ImageMessageBlock } from '@renderer/types/newMessage'
import React from 'react'

import MessageImage from '../MessageImage'

interface Props {
  block: ImageMessageBlock
}

const ImageBlock: React.FC<Props> = ({ block }) => {
  return block.status === 'success' ? <MessageImage block={block} /> : <SvgSpinners180Ring />
}

export default React.memo(ImageBlock)
