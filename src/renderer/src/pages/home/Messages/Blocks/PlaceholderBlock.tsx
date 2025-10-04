import { MessageBlockStatus, MessageBlockType } from '@renderer/types/newMessage'
import { Loader } from '@renderer/ui/loader'
import React from 'react'

interface PlaceholderBlockProps {
  status: MessageBlockStatus
  type: MessageBlockType
}
const PlaceholderBlock: React.FC<PlaceholderBlockProps> = ({ status, type }) => {
  if (status === MessageBlockStatus.PROCESSING && type === MessageBlockType.UNKNOWN) {
    return (
      <div className="-mt-2">
        <Loader variant="terminal" />
      </div>
    )
  }
  return null
}

export default React.memo(PlaceholderBlock)
