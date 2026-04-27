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

const ITEM_CLASS =
  'h-10 gap-2 px-2.5 text-sm font-normal cursor-pointer border-0 ' +
  'text-muted-foreground/60 hover:bg-accent/50 hover:text-foreground ' +
  'data-[active=true]:bg-accent/50 data-[active=true]:text-foreground ' +
  'focus-visible:ring-0'

export const LibrarySidebar: FC<Props> = ({ filter, onFilterChange, typeCounts }) => {
  const { t } = useTranslation()

  const isActive = (f: LibrarySidebarFilter) => {
    if (filter.type === 'resource' && f.type === 'resource') return filter.resourceType === f.resourceType
    if (filter.type === 'tag' && f.type === 'tag') return filter.tagName === f.tagName
    return false
  }

  return (
    <div className="flex min-h-0 w-[200px] shrink-0 flex-col border-border/15 border-r bg-background/50">
      {/* Header */}
      <div className="px-4 pt-5 pb-3">
        <h2 className="text-foreground text-sm tracking-tight">{t('library.sidebar.title')}</h2>
        <p className="mt-0.5 text-muted-foreground/50 text-xs">{t('library.sidebar.subtitle')}</p>
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
                icon={<Icon size={16} strokeWidth={1.6} />}
                label={t(meta.labelKey)}
                suffix={
                  count != null ? (
                    <span className="text-muted-foreground/50 text-xs tabular-nums">{count}</span>
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
