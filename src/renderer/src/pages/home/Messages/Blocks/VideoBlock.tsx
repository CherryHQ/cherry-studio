import type { VideoMessageBlock } from '@renderer/types/newMessage'
import React from 'react'

import MessageVideo from '../MessageVideo'

interface Props {
  block: VideoMessageBlock
}

const VideoBlock: React.FC<Props> = ({ block }) => {
  return (
    <MessageVideo
      url={block.url}
      filePath={block.filePath}
      videoPath={block.metadata?.video?.path}
      startTime={block.metadata?.startTime}
    />
  )
}

export default React.memo(VideoBlock)
