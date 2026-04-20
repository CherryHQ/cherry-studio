import type { PaneTab } from '@shared/data/cache/cacheValueTypes'

import { getTabDisplayTitle } from '../../context/PanesContext'
import { getTabIcon } from './tabIcons'

/**
 * Lightweight TabButton-style preview rendered inside `<DragOverlay>`.
 *
 * Deliberately minimal (no drag listeners, no close button, no selection
 * state) — just an icon + title chip that follows the cursor.
 */
export function TabDragGhost({ tab }: { tab: PaneTab }) {
  const Icon = getTabIcon(tab)
  return (
    <div className="pointer-events-none flex h-[30px] min-w-[80px] max-w-[200px] items-center gap-1.5 rounded-[10px] border border-black/10 bg-background px-2 shadow-lg dark:border-white/10">
      <Icon size={13} strokeWidth={1.6} className="shrink-0" />
      <span
        className="min-w-0 flex-1 truncate text-left font-medium text-[11px] leading-none"
        style={{ maskImage: 'linear-gradient(to right, black 80%, transparent 100%)' }}>
        {getTabDisplayTitle(tab)}
      </span>
    </div>
  )
}
