import { MESSAGE_BLOCK_STATUS, MESSAGE_BLOCK_TYPE, type PlaceholderMessageBlock } from '@renderer/types/newMessage'
import React from 'react'
import { BeatLoader } from 'react-spinners'
import styled from 'styled-components'

interface PlaceholderBlockProps {
  block: PlaceholderMessageBlock
}
const PlaceholderBlock: React.FC<PlaceholderBlockProps> = ({ block }) => {
  if (block.status === MESSAGE_BLOCK_STATUS.PROCESSING && block.type === MESSAGE_BLOCK_TYPE.UNKNOWN) {
    return (
      <MessageContentLoading>
        <BeatLoader color="var(--color-text-1)" size={8} speedMultiplier={0.8} />
      </MessageContentLoading>
    )
  }
  return null
}
const MessageContentLoading = styled.div`
  display: flex;
  flex-direction: row;
  align-items: center;
  height: 32px;
  margin-top: -5px;
  margin-bottom: 5px;
`
export default React.memo(PlaceholderBlock)
