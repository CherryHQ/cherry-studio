import { Plus, RefreshCw, Settings2, Trash2 } from 'lucide-react'
import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button, MenuItem, MenuList, Popover, PopoverContent, PopoverTrigger } from '@cherrystudio/ui'
import { formatRelativeTime } from '@renderer/utils/time'
import type { KnowledgeItemType } from '@shared/data/types/knowledge'

import { KNOWLEDGE_DATA_SOURCE_TYPES } from '../../components/addKnowledgeItemDialog/constants'

interface DataSourcePanelHeaderProps {
  /** Server-side total across all pages. */
  total: number
  /** Rows currently loaded in the renderer (≤ total when pages remain). */
  loadedCount: number
  selectedCount: number
  updatedAt: string
  onBulkReindex: () => void
  onBulkDelete: () => void
  onAdd: (source: KnowledgeItemType) => void
  /** Adding is only meaningful at the base root; a drilled-in directory mirrors a read-only
   *  filesystem folder, so the entry is hidden there to avoid "add" silently landing at the root. */
  canAddSource?: boolean
  localModelStatus?: {
    label: string
    onOpenSettings?: () => void
  }
}

const DataSourcePanelHeader = ({
  total,
  loadedCount,
  selectedCount,
  updatedAt,
  onBulkReindex,
  onBulkDelete,
  onAdd,
  canAddSource = true,
  localModelStatus
}: DataSourcePanelHeaderProps) => {
  const { t, i18n } = useTranslation()
  const [isSourceMenuOpen, setIsSourceMenuOpen] = useState(false)

  const handleSourceSelect = useCallback(
    (source: KnowledgeItemType) => {
      setIsSourceMenuOpen(false)
      onAdd(source)
    },
    [onAdd]
  )

  if (selectedCount > 0) {
    return (
      <div className="flex min-h-8 w-full min-w-0 items-center justify-between gap-3">
        <span className="flex min-w-0 items-baseline gap-2 pl-2">
          <span className="truncate text-sm text-foreground">
            {t('knowledge.data_source.bulk.selected_count', { count: selectedCount })}
          </span>
          {/* Selection only covers loaded rows; warn when unloaded pages remain so the
              checked-all state doesn't read as "all rows in the base". */}
          {total > loadedCount ? (
            <span className="shrink-0 text-xs text-foreground-tertiary">
              {t('knowledge.data_source.bulk.loaded_only_hint', { total })}
            </span>
          ) : null}
        </span>
        <div className="flex shrink-0 items-center gap-2">
          <Button type="button" variant="outline" size="sm" onClick={onBulkReindex}>
            <RefreshCw className="size-3.5" />
            {t('knowledge.data_source.bulk.reindex')}
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={onBulkDelete}>
            <Trash2 className="size-3.5" />
            {t('knowledge.data_source.bulk.delete')}
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="flex min-h-8 w-full min-w-0 items-center justify-between gap-2">
      <span className="min-w-0 truncate pl-2 text-xs leading-4 text-foreground-tertiary">
        {t('knowledge.meta.updated_at', { time: formatRelativeTime(updatedAt, i18n.language) })}
      </span>
      <div className="flex shrink-0 items-center gap-2">
        {localModelStatus ? (
          <>
            <span
              role="status"
              className="max-w-52 truncate text-xs text-muted-foreground"
              title={localModelStatus.label}>
              {localModelStatus.label}
            </span>
            {localModelStatus.onOpenSettings ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-7 min-h-0 gap-1 rounded-md bg-transparent px-2 py-1 text-xs leading-4 font-medium text-muted-foreground shadow-none hover:bg-accent hover:text-foreground"
                onClick={localModelStatus.onOpenSettings}>
                <Settings2 className="size-3" />
                {t('common.go_to_settings')}
              </Button>
            ) : null}
          </>
        ) : canAddSource ? (
          <Popover open={isSourceMenuOpen} onOpenChange={setIsSourceMenuOpen}>
            <PopoverTrigger asChild>
              <Button
                type="button"
                variant="outline"
                size="sm"
                aria-haspopup="menu"
                aria-expanded={isSourceMenuOpen}
                className="h-7 min-h-0 gap-1 rounded-md bg-transparent px-2 py-1 text-xs leading-4 font-medium text-muted-foreground shadow-none hover:bg-accent hover:text-foreground">
                <Plus className="size-3" />
                {t('knowledge.data_source.toolbar.add')}
              </Button>
            </PopoverTrigger>
            <PopoverContent
              align="end"
              side="top"
              sideOffset={8}
              collisionPadding={8}
              className="w-[var(--radix-popover-trigger-width)] rounded-xl p-1.5"
              onOpenAutoFocus={(event) => event.preventDefault()}
              onCloseAutoFocus={(event) => event.preventDefault()}>
              <MenuList role="menu" className="gap-1">
                {KNOWLEDGE_DATA_SOURCE_TYPES.map((source) => (
                  <MenuItem
                    key={source.value}
                    role="menuitem"
                    variant="ghost"
                    label={t(source.labelKey)}
                    className="h-8 rounded-lg px-2.5 text-sm"
                    onClick={() => handleSourceSelect(source.value)}
                  />
                ))}
              </MenuList>
            </PopoverContent>
          </Popover>
        ) : null}
      </div>
    </div>
  )
}

export default DataSourcePanelHeader
