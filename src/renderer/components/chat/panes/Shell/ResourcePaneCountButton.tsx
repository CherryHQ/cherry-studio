import { Button, Tooltip } from '@cherrystudio/ui'
import { cn } from '@renderer/utils/style'
import { MessageCircle } from 'lucide-react'
import { useCallback } from 'react'

import { RESOURCE_PANE_TAB } from './resourcePane'
import { useShellActions, useShellState } from './Shell'

export interface ResourcePaneCountButtonProps {
  label: string
  count: number
  className?: string
}

export function ResourcePaneCountButton({ label, count, className }: ResourcePaneCountButtonProps) {
  const { open } = useShellState()
  const { openTab } = useShellActions()
  const title = `${label} ${count}`
  const handleClick = useCallback(() => {
    openTab(RESOURCE_PANE_TAB)
  }, [openTab])

  if (open) return null

  return (
    <Tooltip content={title} delay={800}>
      <Button
        type="button"
        variant="ghost"
        aria-label={title}
        className={cn(
          'group h-7 shrink-0 gap-1.5 rounded-full bg-card px-2.5 font-medium text-foreground-muted text-xs shadow-none',
          'hover:bg-accent hover:text-foreground',
          '[&_svg]:!size-3.5 [-webkit-app-region:none]',
          className
        )}
        onClick={handleClick}>
        <MessageCircle />
        <span>{label}</span>
        <span className="text-foreground-muted group-hover:text-foreground-secondary">{count}</span>
      </Button>
    </Tooltip>
  )
}
