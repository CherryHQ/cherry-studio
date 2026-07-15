import { Button, Tooltip } from '@cherrystudio/ui'
import type { ReactNode } from 'react'

interface FilePreviewToolbarButtonProps {
  children: ReactNode
  disabled: boolean
  label: string
  onClick: () => void
}

export function FilePreviewToolbarButton({ children, disabled, label, onClick }: FilePreviewToolbarButtonProps) {
  return (
    <Tooltip content={label} delay={300}>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        aria-label={label}
        disabled={disabled}
        onClick={onClick}
        className="text-muted-foreground hover:text-foreground">
        {children}
      </Button>
    </Tooltip>
  )
}
