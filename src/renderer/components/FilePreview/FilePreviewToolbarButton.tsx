import { Button, Tooltip } from '@cherrystudio/ui'
import { cn } from '@renderer/utils/style'
import type { ReactNode } from 'react'

interface FilePreviewToolbarButtonProps {
  children: ReactNode
  disabled: boolean
  label: string
  onClick: () => void
  pressed?: boolean
}

export function FilePreviewToolbarButton({
  children,
  disabled,
  label,
  onClick,
  pressed
}: FilePreviewToolbarButtonProps) {
  return (
    <Tooltip content={label} delay={300}>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        aria-label={label}
        aria-pressed={pressed}
        disabled={disabled}
        onClick={onClick}
        className={cn('text-muted-foreground hover:text-foreground', pressed && 'bg-ghost-active text-foreground')}>
        {children}
      </Button>
    </Tooltip>
  )
}
