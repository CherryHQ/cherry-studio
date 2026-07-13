import { Button, Tooltip } from '@cherrystudio/ui'
import { cn } from '@renderer/utils/style'
import { List } from 'lucide-react'
import { useCallback } from 'react'

import { RESOURCE_PANE_TAB } from './resourcePane'
import { type ShellTabShortcutOpenBehavior, useShellActions, useShellState } from './Shell'

export interface ResourcePaneCountButtonProps {
  label: string
  count: number
  className?: string
  openBehavior?: ShellTabShortcutOpenBehavior
}

export function ResourcePaneCountButton({
  label,
  count,
  className,
  openBehavior = 'hide'
}: ResourcePaneCountButtonProps) {
  const { activeTab, maximized, open } = useShellState()
  const { close, openTab } = useShellActions()
  const title = `${label} ${count}`
  const togglesActive = openBehavior === 'toggle-active'
  const active = open && activeTab === RESOURCE_PANE_TAB
  const handleClick = useCallback(() => {
    if (togglesActive && active) {
      close()
      return
    }
    openTab(RESOURCE_PANE_TAB)
  }, [active, close, openTab, togglesActive])

  if (maximized || (open && openBehavior === 'hide')) return null

  return (
    <Tooltip content={title} delay={800}>
      <Button
        type="button"
        variant="ghost"
        aria-label={title}
        className={cn(
          'group h-7 shrink-0 gap-1.5 rounded-full bg-card px-2.5 font-medium text-foreground-muted text-xs shadow-none',
          'hover:bg-accent hover:text-foreground',
          active && 'bg-secondary text-secondary-foreground hover:bg-secondary-hover hover:text-secondary-foreground',
          '[&_svg]:!size-3.5 [-webkit-app-region:none]',
          className
        )}
        aria-pressed={togglesActive ? active : undefined}
        onClick={handleClick}>
        <List />
        <span>{label}</span>
        <span
          className={cn(
            'text-foreground-muted group-hover:text-foreground-secondary',
            active && 'text-secondary-foreground group-hover:text-secondary-foreground'
          )}>
          {count}
        </span>
      </Button>
    </Tooltip>
  )
}
