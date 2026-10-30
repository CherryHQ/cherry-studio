import { Plus, RefreshCw, Settings2, Trash2 } from 'lucide-react'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import { Button, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@cherrystudio/ui'
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
  onAddFeishuWiki: () => void
  syncStatus?: ReactNode
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
  onAddFeishuWiki,
  syncStatus,
  canAddSource = true,
  localModelStatus
}: DataSourcePanelHeaderProps) => {
  const { t, i18n } = useTranslation()

  return (
    <div className="flex min-h-8 w-full min-w-0 items-center justify-between gap-2">
      <div className="flex min-w-0 items-center gap-2 pl-2">
        {selectedCount > 0 ? (
          <span className="flex min-w-0 items-baseline gap-2">
            <span className="truncate text-sm text-foreground">
              {t('knowledge.data_source.bulk.selected_count', { count: selectedCount })}
            </span>
            {total > loadedCount ? (
              <span className="text-foreground-tertiary shrink-0 text-xs">
                {t('knowledge.data_source.bulk.loaded_only_hint', { total })}
              </span>
            ) : null}
          </span>
        ) : (
          <span className="text-foreground-tertiary min-w-0 truncate text-xs leading-4">
            {t('knowledge.meta.updated_at', { time: formatRelativeTime(updatedAt, i18n.language) })}
          </span>
        )}
        <div hidden={selectedCount > 0} className="min-w-0">
          {syncStatus}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {selectedCount > 0 ? (
          <>
            <Button type="button" variant="outline" size="sm" onClick={onBulkReindex}>
              <RefreshCw className="size-3.5" />
              {t('knowledge.data_source.bulk.reindex')}
            </Button>
            <Button type="button" variant="outline" size="sm" onClick={onBulkDelete}>
              <Trash2 className="size-3.5" />
              {t('knowledge.data_source.bulk.delete')}
            </Button>
          </>
        ) : localModelStatus ? (
          <>
            <span
              role="status"
              className="text-muted-foreground max-w-52 truncate text-xs"
              title={localModelStatus.label}>
              {localModelStatus.label}
            </span>
            {localModelStatus.onOpenSettings ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="text-muted-foreground h-7 min-h-0 gap-1 rounded-md bg-transparent px-2 py-1 text-xs leading-4 font-medium shadow-none hover:bg-accent hover:text-foreground"
                onClick={localModelStatus.onOpenSettings}>
                <Settings2 className="size-3" />
                {t('common.go_to_settings')}
              </Button>
            ) : null}
          </>
        ) : canAddSource ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="text-muted-foreground h-7 min-h-0 gap-1 rounded-md bg-transparent px-2 py-1 text-xs leading-4 font-medium shadow-none hover:bg-accent hover:text-foreground">
                <Plus className="size-3" />
                {t('knowledge.data_source.toolbar.add')}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="end"
              side="top"
              sideOffset={8}
              collisionPadding={8}
              className="min-w-40 rounded-xl p-1.5">
              {KNOWLEDGE_DATA_SOURCE_TYPES.map((source) => (
                <DropdownMenuItem
                  key={source.value}
                  className="h-8 rounded-lg px-2.5 text-sm"
                  onSelect={() => onAdd(source.value)}>
                  {t(source.labelKey)}
                </DropdownMenuItem>
              ))}
              <DropdownMenuItem className="h-8 rounded-lg px-2.5 text-sm" onSelect={onAddFeishuWiki}>
                {t('knowledge.data_source.add_dialog.sources.feishu_wiki')}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
      </div>
    </div>
  )
}

export default DataSourcePanelHeader
