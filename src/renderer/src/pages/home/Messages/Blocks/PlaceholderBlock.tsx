import { MessageBlockStatus, MessageBlockType, type PlaceholderMessageBlock } from '@renderer/types/newMessage'
import React from 'react'
import { BeatLoader } from 'react-spinners'

interface PlaceholderBlockProps {
  block: PlaceholderMessageBlock
}
const PlaceholderBlock: React.FC<PlaceholderBlockProps> = ({ block }) => {
  if (block.status === MessageBlockStatus.PROCESSING && block.type === MessageBlockType.UNKNOWN) {
    return (
      <div className="-mt-1.25 mb-1.25 flex h-8 flex-row items-center">
        <BeatLoader color="var(--color-text-1)" size={8} speedMultiplier={0.8} />
      </div>
    )
  }
  return null
}
export default React.memo(PlaceholderBlock)
