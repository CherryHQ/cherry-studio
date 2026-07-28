import { Button, Tooltip } from '@cherrystudio/ui'
import { cn } from '@renderer/utils/style'
import { List } from 'lucide-react'
import { useCallback } from 'react'

import { RESOURCE_PANE_TAB } from './resourcePane'
import { useRightPanelActions, useRightPanelState } from './RightPanel'

export interface ResourcePaneCountButtonProps {
  label: string
  count: number
  className?: string
}

export function ResourcePaneCountButton({ label, count, className }: ResourcePaneCountButtonProps) {
  const state = useRightPanelState()
  const actions = useRightPanelActions()
  const title = `${label} ${count}`
  const active = state.isActive(RESOURCE_PANE_TAB)
  const handleClick = useCallback(() => {
    if (active) {
      actions.close()
      return
    }
    actions.tryOpen(RESOURCE_PANE_TAB, { userInitiated: true })
  }, [actions, active])

  if (!actions.canOpen(RESOURCE_PANE_TAB)) return null
  if (state.presentationMaximized) return null

  return (
    <Tooltip content={title} delay={800}>
      <Button
        type="button"
        variant={active ? 'secondary' : 'ghost'}
        pressed={active}
        aria-label={title}
        className={cn(
          'group h-7 shrink-0 gap-1.5 rounded-full bg-card px-2.5 font-medium text-muted-foreground text-xs shadow-none',
          'hover:bg-accent hover:text-foreground',
          active && 'bg-secondary text-secondary-foreground hover:text-secondary-foreground',
          '[&_svg]:!size-3.5 [-webkit-app-region:none]',
          className
        )}
        onClick={handleClick}>
        <List />
        <span>{label}</span>
        <span
          className={cn(
            'text-muted-foreground group-hover:text-foreground',
            active && 'text-secondary-foreground group-hover:text-secondary-foreground'
          )}>
          {count}
        </span>
      </Button>
    </Tooltip>
  )
}
