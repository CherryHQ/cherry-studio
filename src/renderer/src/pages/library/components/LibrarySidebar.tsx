import { Layers } from 'lucide-react'
import type { FC } from 'react'
import { useTranslation } from 'react-i18next'

import { RESOURCE_TYPE_META, RESOURCE_TYPE_ORDER } from '../constants'
import type { LibrarySidebarFilter } from '../types'

interface Props {
  filter: LibrarySidebarFilter
  onFilterChange: (f: LibrarySidebarFilter) => void
  typeCounts?: Record<string, number>
}

export const LibrarySidebar: FC<Props> = ({ filter, onFilterChange, typeCounts }) => {
  const { t } = useTranslation()

  const isActive = (f: LibrarySidebarFilter) => {
    if (filter.type === 'all' && f.type === 'all') return true
    if (filter.type === 'resource' && f.type === 'resource') return filter.resourceType === f.resourceType
    if (filter.type === 'tag' && f.type === 'tag') return filter.tagName === f.tagName
    return false
  }

  const itemCls = (f: LibrarySidebarFilter) =>
    `flex items-center gap-2 w-full px-2.5 py-[6px] rounded-3xs text-[11px] transition-all cursor-pointer ${
      isActive(f) ? 'bg-accent/70 text-foreground' : 'text-muted-foreground/70 hover:text-foreground hover:bg-accent/35'
    }`

  return (
    <div className="flex min-h-0 w-[200px] shrink-0 flex-col border-border/15 border-r bg-background">
      {/* Header */}
      <div className="px-4 pt-5 pb-3">
        <h2 className="text-[13px] text-foreground tracking-tight">{t('library.sidebar.title')}</h2>
        <p className="mt-0.5 text-[9px] text-muted-foreground/50">{t('library.sidebar.subtitle')}</p>
      </div>

      {/* Scrollable */}
      <div className="flex-1 overflow-y-auto px-2.5 pb-2 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-border/30 [&::-webkit-scrollbar]:w-[3px]">
        {/* All */}
        <div className="mb-1">
          <button type="button" onClick={() => onFilterChange({ type: 'all' })} className={itemCls({ type: 'all' })}>
            <Layers size={12} strokeWidth={1.6} />
            <span className="flex-1 text-left">{t('library.sidebar.all_resources')}</span>
          </button>
        </div>

        {/* Resource Types */}
        <div className="mb-3">
          {RESOURCE_TYPE_ORDER.map((resourceType) => {
            const meta = RESOURCE_TYPE_META[resourceType]
            const Icon = meta.icon
            return (
              <button
                key={resourceType}
                type="button"
                onClick={() => onFilterChange({ type: 'resource', resourceType })}
                className={itemCls({ type: 'resource', resourceType })}>
                <Icon size={12} strokeWidth={1.6} />
                <span className="flex-1 text-left">{t(meta.labelKey)}</span>
                {typeCounts?.[resourceType] != null && (
                  <span className="text-[9px] text-muted-foreground/35 tabular-nums">{typeCounts[resourceType]}</span>
                )}
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}

export default LibrarySidebar
