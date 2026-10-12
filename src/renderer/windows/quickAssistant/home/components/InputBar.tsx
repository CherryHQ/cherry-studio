import React, { useEffect, useRef } from 'react'

import { Input } from '@cherrystudio/ui'
import ModelAvatar from '@renderer/components/Avatar/ModelAvatar'
import type { Model } from '@shared/data/types/model'

interface InputBarProps {
  text: string
  model?: Model
  placeholder: string
  loading: boolean
  handleKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => void
  handleChange: (e: React.ChangeEvent<HTMLInputElement>) => void
}

const InputBar = ({
  ref,
  text,
  model,
  placeholder,
  loading,
  handleKeyDown,
  handleChange
}: InputBarProps & { ref?: React.RefObject<HTMLDivElement | null> }) => {
  const inputRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (!loading) inputRef.current?.focus()
  }, [loading])
  return (
    <div ref={ref} className="flex min-w-0 flex-1 items-center gap-2">
      {model && <ModelAvatar model={model} size={30} />}
      <Input
        dir="auto"
        style={{ textAlign: 'start' }}
        ref={inputRef}
        value={text}
        placeholder={placeholder}
        autoFocus
        onKeyDown={handleKeyDown}
        onChange={handleChange}
        className="h-auto rounded-none border-0 bg-transparent px-0 py-0 text-sm shadow-none [-webkit-app-region:no-drag] placeholder:text-muted-foreground focus-visible:border-transparent focus-visible:ring-0 dark:bg-transparent"
      />
    </div>
  )
}
InputBar.displayName = 'InputBar'

export default InputBar
