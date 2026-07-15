import type { ReactNode } from 'react'

interface FilePreviewToolbarProps {
  'aria-label': string
  children: ReactNode
}

export function FilePreviewToolbar({ 'aria-label': ariaLabel, children }: FilePreviewToolbarProps) {
  return (
    <div
      role="toolbar"
      aria-label={ariaLabel}
      className="flex h-10 min-h-10 shrink-0 items-center overflow-x-auto border-border-subtle border-b bg-background px-3">
      <div className="flex min-w-max items-center gap-1">{children}</div>
    </div>
  )
}
