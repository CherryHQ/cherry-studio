import { Button, Popover, PopoverContent, PopoverTrigger } from '@heroui/react'
import React from 'react'

import EmojiPicker from '../EmojiPicker'

type Props = {
  emoji: string
  onPick: (emoji: string) => void
}

export const EmojiAvatarWithPicker: React.FC<Props> = ({ emoji, onPick }) => {
  return (
    <Popover>
      <PopoverTrigger>
        <Button size="sm" startContent={<span className="text-lg">{emoji}</span>} isIconOnly />
      </PopoverTrigger>
      <PopoverContent>
        <EmojiPicker onEmojiClick={onPick}></EmojiPicker>
      </PopoverContent>
    </Popover>
  )
}
