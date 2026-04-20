import '@renderer/databases'

import useMacTransparentWindow from '@renderer/hooks/useMacTransparentWindow'
import { cn } from '@renderer/utils'

import Sidebar from '../app/Sidebar'
import { PanesContainer } from './PanesContainer'

/**
 * Top-level main-window shell.
 *
 * Post-Phase 2: the window is a single pane tree rendered by PanesContainer.
 * The "global tab bar" is simply the tab bar of the root leaf when the tree
 * has not been split; splits produce per-leaf tab bars inside the tree.
 */
export const AppShell = () => {
  const isMacTransparentWindow = useMacTransparentWindow()

  return (
    <div
      className={cn(
        'flex h-screen w-screen flex-row overflow-hidden text-foreground',
        isMacTransparentWindow ? 'bg-transparent' : 'bg-sidebar'
      )}>
      {/* Sidebar */}
      <Sidebar />

      {/* Content area: pane tree (tab bar is rendered inside each leaf) */}
      <div className="flex min-w-0 flex-1 flex-col pr-2 pb-2">
        <PanesContainer />
      </div>
    </div>
  )
}
