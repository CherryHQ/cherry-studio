import { Input } from '@cherrystudio/ui'
import { useEffect, useRef, useState } from 'react'

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
  useEffect(() => {
    if (ref.current) {
      ref.current.focus()
      const dotIdx = value.lastIndexOf('.')
      ref.current.setSelectionRange(0, dotIdx > 0 ? dotIdx : value.length)
    }
  }, [value])
  return (
    <Input
      ref={ref}
      value={text}
      onChange={(e) => setText(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && text.trim()) onConfirm(text.trim())
        if (e.key === 'Escape') onCancel()
      }}
      onBlur={() => {
        if (text.trim()) onConfirm(text.trim())
        else onCancel()
      }}
      className={`h-auto rounded-md border border-border bg-background py-0.5 text-foreground text-xs shadow-sm focus-visible:border-primary/60 focus-visible:ring-2 focus-visible:ring-primary/15 ${className ?? ''}`}
      onClick={(e) => e.stopPropagation()}
    />
  )
}
