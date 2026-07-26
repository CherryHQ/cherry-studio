import { Input } from '@cherrystudio/ui'
import ModelAvatar from '@renderer/components/Avatar/ModelAvatar'
import { useTimer } from '@renderer/hooks/useTimer'
import type { Model } from '@shared/data/types/model'
import React, { useRef } from 'react'

interface InputBarProps {
  text: string
  model?: Model
  referenceText: string
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
  const { setTimeoutTimer } = useTimer()
  if (!loading) {
    setTimeoutTimer('focus', () => inputRef.current?.focus(), 0)
  }
  return (
    <div ref={ref} className="mt-2.5 flex items-center gap-2">
      {model && <ModelAvatar model={model} size={30} />}
      <Input
        ref={inputRef}
        value={text}
        placeholder={placeholder}
        autoFocus
        onKeyDown={handleKeyDown}
        onChange={handleChange}
        className="h-auto border-0 bg-transparent px-0 py-0 text-lg shadow-none [-webkit-app-region:no-drag] placeholder:text-muted-foreground focus-visible:border-transparent focus-visible:ring-0"
      />
    </div>
  )
}
InputBar.displayName = 'InputBar'

export default InputBar
