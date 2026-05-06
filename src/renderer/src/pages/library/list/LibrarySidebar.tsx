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
  'mx-1 h-10 w-[calc(100%-0.5rem)] gap-2 px-2.5 text-sm font-normal cursor-pointer border-0 ' +
  'text-sidebar-foreground/60 hover:bg-sidebar-accent hover:text-sidebar-foreground ' +
  'data-[active=true]:bg-sidebar-accent data-[active=true]:text-sidebar-foreground ' +
  'focus-visible:ring-0'

export const LibrarySidebar: FC<Props> = ({ filter, onFilterChange, typeCounts }) => {
  const { t } = useTranslation()

  return (
    <div className="flex min-h-0 w-[200px] shrink-0 flex-col border-sidebar-border border-r bg-sidebar">
      {/* Header */}
      <div className="px-4 pt-5 pb-3">
        <h2 className="text-sidebar-foreground text-sm tracking-tight">{t('library.sidebar.title')}</h2>
        <p className="mt-0.5 text-sidebar-foreground/50 text-xs">{t('library.sidebar.subtitle')}</p>
      </div>

      {/* Scrollable */}
      <div className="flex-1 overflow-y-auto px-2.5 pb-2 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-sidebar-border/70 [&::-webkit-scrollbar]:w-[3px]">
        {/* Resource Types */}
        <div className="mb-3 space-y-1">
          {RESOURCE_TYPE_ORDER.map((resourceType) => {
            const meta = RESOURCE_TYPE_META[resourceType]
            const Icon = meta.icon
            const count = typeCounts?.[resourceType]
            return (
              <MenuItem
                key={resourceType}
                size="sm"
                active={filter.resourceType === resourceType}
                onClick={() => onFilterChange({ resourceType })}
                icon={<Icon size={16} strokeWidth={1.6} />}
                label={t(meta.labelKey)}
                suffix={
                  count != null ? (
                    <span className="text-sidebar-foreground/50 text-xs tabular-nums">{count}</span>
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
