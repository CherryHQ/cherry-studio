import { MenuItem } from '@cherrystudio/ui'
import type { FC } from 'react'
import { useTranslation } from 'react-i18next'

import { RESOURCE_TYPE_META, RESOURCE_TYPE_ORDER } from '../constants'
import type { LibrarySidebarFilter } from '../types'

interface Props {
  filter: LibrarySidebarFilter
  onFilterChange: (f: LibrarySidebarFilter) => void
  typeCounts?: Record<string, number>
}

// Preserve the original pixel-perfect styling of the sidebar item: 2px vertical padding bump
// (py-[6px] vs MenuItem sm's py-1), 3xs radius, gap-2, normal weight, muted/70 idle color,
// 35% accent hover, 70% accent active, no focus-visible ring, no border.
const ITEM_CLASS =
  'gap-2 px-2.5 py-[6px] rounded-3xs font-normal cursor-pointer border-0 ' +
  'text-muted-foreground/70 hover:bg-accent/35 hover:text-foreground ' +
  'data-[active=true]:bg-accent/70 data-[active=true]:text-foreground ' +
  'focus-visible:ring-0'

export const LibrarySidebar: FC<Props> = ({ filter, onFilterChange, typeCounts }) => {
  const { t } = useTranslation()

  const isActive = (f: LibrarySidebarFilter) => {
    if (filter.type === 'resource' && f.type === 'resource') return filter.resourceType === f.resourceType
    if (filter.type === 'tag' && f.type === 'tag') return filter.tagName === f.tagName
    return false
  }

  return (
    <div className="flex min-h-0 w-[200px] shrink-0 flex-col border-border/15 border-r bg-background">
      {/* Header */}
      <div className="px-4 pt-5 pb-3">
        <h2 className="text-[13px] text-foreground tracking-tight">{t('library.sidebar.title')}</h2>
        <p className="mt-0.5 text-[9px] text-muted-foreground/50">{t('library.sidebar.subtitle')}</p>
      </div>

      {/* Scrollable */}
      <div className="flex-1 overflow-y-auto px-2.5 pb-2 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-border/30 [&::-webkit-scrollbar]:w-[3px]">
        {/* Resource Types */}
        <div className="mb-3">
          {RESOURCE_TYPE_ORDER.map((resourceType) => {
            const meta = RESOURCE_TYPE_META[resourceType]
            const Icon = meta.icon
            const count = typeCounts?.[resourceType]
            return (
              <MenuItem
                key={resourceType}
                size="sm"
                active={isActive({ type: 'resource', resourceType })}
                onClick={() => onFilterChange({ type: 'resource', resourceType })}
                icon={<Icon size={12} strokeWidth={1.6} />}
                label={t(meta.labelKey)}
                suffix={
                  count != null ? (
                    <span className="text-[9px] text-muted-foreground/35 tabular-nums">{count}</span>
                  ) : undefined
                }
                className={ITEM_CLASS}
              />
            )
          })}
        </div>
      </div>
    </div>
  )
}

export default LibrarySidebar
