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
  'h-8 w-full cursor-pointer gap-1.5 rounded-lg border-0 px-1.5 text-[13px] font-normal ' +
  'text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-foreground [&_svg]:size-4 ' +
  'data-[active=true]:bg-sidebar-accent data-[active=true]:text-sidebar-foreground ' +
  'focus-visible:bg-sidebar-accent focus-visible:text-sidebar-foreground focus-visible:ring-1 focus-visible:ring-sidebar-ring'

export const LibrarySidebar: FC<Props> = ({ filter, onFilterChange, typeCounts }) => {
  const { t } = useTranslation()

  return (
    <div className="flex min-h-0 w-56 shrink-0 flex-col border-border border-r-[0.5px] bg-background text-sidebar-foreground">
      {/* Header */}
      <div className="px-3 pt-3 pb-3">
        <h2 className="font-medium text-sidebar-foreground text-sm">{t('library.sidebar.title')}</h2>
        <p className="mt-1 text-foreground-muted text-xs">{t('library.sidebar.subtitle')}</p>
      </div>

      {/* Scrollable */}
      <div className="flex-1 overflow-y-auto px-2 pb-3 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-sidebar-border [&::-webkit-scrollbar]:w-1">
        {/* Resource Types */}
        <div className="space-y-1">
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
                    <span className="text-foreground-muted text-xs tabular-nums">{count}</span>
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
