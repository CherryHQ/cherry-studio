import { Button, Popover, PopoverContent, PopoverTrigger } from '@cherrystudio/ui'
import React, { useState } from 'react'

import EmojiPicker from '../EmojiPicker'

type Props = {
  emoji: string
  onPick: (emoji: string) => void
}

export const EmojiAvatarWithPicker: React.FC<Props> = ({ emoji, onPick }) => {
  const [open, setOpen] = useState(false)

  const handlePick = (nextEmoji: string) => {
    onPick(nextEmoji)
    setOpen(false)
  }

  return (
    <Popover open={open} onOpenChange={setOpen} modal>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" className="size-8 text-lg">
          {emoji}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" sideOffset={6} collisionPadding={16} className="w-auto p-0">
        <EmojiPicker onEmojiClick={handlePick} />
      </PopoverContent>
    </Popover>
  )
}
