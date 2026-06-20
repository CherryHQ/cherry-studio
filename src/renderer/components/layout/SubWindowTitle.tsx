import { useTabs } from '@renderer/hooks/useTabs'
import { cn } from '@renderer/utils'

import { TabIcon } from './TabIcon'

/**
 * Detached-window title: the single tab's emoji/icon + name, shown on the left of the
 * navbar (where the sidebar toggle sits in the main window). Reads the tab directly —
 * its title/icon are kept in sync by the hosted page (HomePage / AgentPage).
 */
export const SubWindowTitle = ({ className }: { className?: string }) => {
  const { tabs, activeTabId } = useTabs()
  const tab = tabs.find((tabItem) => tabItem.id === activeTabId) ?? tabs[0]
  if (!tab) return null

  return (
    <div data-navbar-left-occupant className={cn('flex min-w-0 items-center gap-2', className)}>
      <TabIcon tab={tab} size={16} className="shrink-0" />
      <span className="min-w-0 truncate font-medium text-[13px] text-foreground/80">{tab.title}</span>
    </div>
  )
}
