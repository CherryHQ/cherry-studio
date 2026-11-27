import { useEffect, useRef, useState } from 'react'

import { Input } from '@cherrystudio/ui'
import { useTimer } from '@renderer/hooks/useTimer'

export function InlineRename({
  value,
  onConfirm,
  onCancel,
  className
}: {
  value: string
  onConfirm: (v: string) => void
  onCancel: () => void
  className?: string
}) {
  const [text, setText] = useState(value)
  const ref = useRef<HTMLInputElement>(null)
  const finishedRef = useRef(false)
  const { setTimeoutTimer } = useTimer()

  useEffect(() => {
    return setTimeoutTimer(
      'inlineRenameFocus',
      () => {
        const input = ref.current
        if (!input) return

        input.focus()
        const dotIdx = value.lastIndexOf('.')
        input.setSelectionRange(0, dotIdx > 0 ? dotIdx : value.length)
      },
      0
    )
  }, [setTimeoutTimer, value])
  const finishRename = (name: string) => {
    if (finishedRef.current) return
    finishedRef.current = true
    if (name) onConfirm(name)
    else onCancel()
  }

  return (
    <Input
      ref={ref}
      value={text}
      onChange={(e) => setText(e.target.value)}
      onKeyDown={(e) => {
        // Browsers that do not set isComposing report an IME keydown as keyCode 229.
        // oxlint-disable-next-line no-deprecated
        if (e.nativeEvent.isComposing || e.keyCode === 229) return
        if (e.key === 'Enter' && text.trim()) finishRename(text.trim())
        if (e.key === 'Escape') finishRename('')
      }}
      onBlur={() => finishRename(text.trim())}
      className={`h-auto rounded-md border border-border bg-background py-0.5 text-xs text-foreground shadow-sm focus-visible:border-ring ${className ?? ''}`}
      onClick={(e) => e.stopPropagation()}
    />
  )
}
