import { Button, Popover } from 'antd'
import React from 'react'

import EmojiPicker from '../EmojiPicker'

type Props = {
  emoji: string
  onPick: (emoji: string) => void
}

export const EmojiAvatarWithPicker: React.FC<Props> = ({ emoji, onPick }) => {
  return (
    <Popover content={<EmojiPicker onEmojiClick={onPick} />} trigger="click">
      <Button type="text" style={{ width: 32, height: 32, fontSize: 18 }}>
        {emoji}
      </Button>
    </Popover>
  )
}
