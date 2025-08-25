import type { VideoMessageBlock } from '@renderer/types/newMessage'
import React from 'react'

import MessageVideo from '../MessageVideo'

interface Props {
  block: VideoMessageBlock
}

const VideoBlock: React.FC<Props> = ({ block }) => {
  return <MessageVideo block={block} />
}

export default React.memo(VideoBlock)
