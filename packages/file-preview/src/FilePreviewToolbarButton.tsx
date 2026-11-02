import type { ReactNode } from 'react'

import { Button, Tooltip } from '@cherrystudio/ui'
import { cn } from '@cherrystudio/ui/lib/utils'

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
        className={cn(
          'size-[var(--file-preview-toolbar-button-size,1.75rem)] text-muted-foreground hover:text-foreground',
          pressed && 'bg-ghost-active text-foreground'
        )}>
        {children}
      </Button>
    </Tooltip>
  )
}
