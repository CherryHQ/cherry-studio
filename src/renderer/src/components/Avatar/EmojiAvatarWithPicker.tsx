import { Button, Popover, PopoverContent, PopoverTrigger } from '@cherrystudio/ui'
import React from 'react'

import EmojiPicker from '../EmojiPicker'

type Props = {
  emoji: string
  onPick: (emoji: string) => void
}

export const EmojiAvatarWithPicker: React.FC<Props> = ({ emoji, onPick }) => {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" className="size-8 text-lg">
          {emoji}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0">
        <EmojiPicker onEmojiClick={onPick} />
      </PopoverContent>
    </Popover>
  )
}
