import SvgSpinners180Ring from '@renderer/components/Icons/SvgSpinners180Ring'
import { type ImageMessageBlock, MessageBlockStatus } from '@renderer/types/newMessage'
import React from 'react'

import MessageImage from '../MessageImage'

interface Props {
  block: ImageMessageBlock
}

const ImageBlock: React.FC<Props> = ({ block }) => {
  return block.status === MessageBlockStatus.SUCCESS ? (
    <MessageImage block={block} />
  ) : block.status === MessageBlockStatus.STREAMING || block.status === MessageBlockStatus.PROCESSING ? (
    <SvgSpinners180Ring />
  ) : (
    <></>
  )
}

export default React.memo(ImageBlock)
