import { Checkbox, NormalTooltip } from '@cherrystudio/ui'
import { cn } from '@cherrystudio/ui/lib/utils'
import { CommandContextMenu, type CommandContextMenuExtraItem } from '@renderer/components/command'
import { useSharedCacheValue } from '@renderer/data/hooks/useCache'
import KnowledgeRowActionsMenu from '@renderer/pages/knowledge/components/KnowledgeRowActionsMenu'
import { getKnowledgeItemFailureReason } from '@renderer/pages/knowledge/utils/error'
import { toast } from '@renderer/services/toast'
import { formatErrorMessageWithPrefix } from '@renderer/utils/error'
import { formatRelativeTime } from '@renderer/utils/time'
import type { KnowledgeItem } from '@shared/data/types/knowledge'
import { BookOpen, Check, CircleAlert, Eye, LoaderCircle, RefreshCw, Trash2 } from 'lucide-react'
import type { KeyboardEvent, ReactNode } from 'react'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import { KNOWLEDGE_ITEM_ROW_GRID, knowledgeDataSourceCheckboxClassName } from './styles'
import { type DataSourceStatusViewModel, dataSourceTypeDisplayConfig } from './utils/models'
import { toKnowledgeItemRowViewModel } from './utils/selectors'

export interface KnowledgeItemRowProps {
  item: KnowledgeItem
  selected: boolean
  onToggleSelect: (next: boolean) => void
  onClick: () => void
  onDelete: () => void | Promise<unknown>
  onPreviewSource: () => void | Promise<unknown>
  onReindex: () => void | Promise<unknown>
  onViewChunks: () => void
}

/**
 * Live " NN%" suffix for a row whose index job is embedding. Mounted only while
 * `item.status === 'embedding'` and subscribed read-only, so ordinary rows never
 * create or pin the shared-cache key — the indexing job in main owns it end-to-end
 * (created when embedding actually starts, TTL-collected after the job exits).
 */
const KnowledgeItemEmbeddingProgress = ({ itemId }: { itemId: string }) => {
  const progress = useSharedCacheValue(`knowledge.item.embedding_progress.${itemId}` as const)
  if (progress == null) {
    return null
  }
  return ` ${progress}%`
}

const KnowledgeItemStatusBadge = ({
  failureReason,
  status,
  embeddingProgress
}: {
  failureReason: string | null
  status: DataSourceStatusViewModel
  embeddingProgress: ReactNode
}) => {
  const { t } = useTranslation()
  const icon =
    status.icon === 'loader' ? (
      <LoaderCircle className={cn('size-3 animate-spin', status.textClassName)} />
    ) : status.icon === 'check' ? (
      <Check className={cn('size-3', status.textClassName)} />
    ) : (
      <CircleAlert className={cn('size-3', status.textClassName)} />
    )

  const content = (
    <span
      className={cn(
        'inline-flex shrink-0 items-center gap-1 text-xs',
        failureReason && 'cursor-help',
        status.textClassName
      )}
      tabIndex={failureReason ? 0 : undefined}
      aria-label={failureReason ?? undefined}>
      {icon}
      <span>
        {t(status.labelKey)}
        {embeddingProgress}
      </span>
    </span>
  )

  if (failureReason) {
    return (
      <NormalTooltip
        content={failureReason}
        side="bottom"
        contentProps={{
          className: 'max-w-72'
        }}>
        {content}
      </NormalTooltip>
    )
  }

  return content
}

const KnowledgeItemRow = ({
  item,
  selected,
  onToggleSelect,
  onClick,
  onDelete,
  onPreviewSource,
  onReindex,
  onViewChunks
}: KnowledgeItemRowProps) => {
  const {
    i18n: { language },
    t
  } = useTranslation()
  const { icon, status, title } = toKnowledgeItemRowViewModel(item, language)
  const Icon = icon.icon
  // `failed` carries a reason code in `error` (e.g. a migrated folder whose vectors could not
  // be migrated); surface it as the badge tooltip.
  const failureReason = item.status === 'failed' ? getKnowledgeItemFailureReason(item, t) : null
  const canReindex = item.status === 'completed' || item.status === 'failed'
  const canViewChunks = item.status === 'completed'
  // Left-click activates the row: file/url open with the system tool and a directory drills into
  // its children — all status-independent (the source exists regardless of index state). A note
  // has no external target, so it only activates once its in-app chunk view is ready (`completed`).
  const canActivate = item.type === 'note' ? canViewChunks : true
  const typeLabel = t(dataSourceTypeDisplayConfig[item.type].filterLabelKey)
  const updatedAt = formatRelativeTime(item.updatedAt, language)
  const fullTitle = 'source' in item.data ? item.data.source : title

  // Row actions, surfaced via the whole-row right-click menu (replacing the old per-row more
  // button). Same shape the navigator's KnowledgeBaseRow uses, so presentation stays consistent.
  const contextMenuItems = useMemo<CommandContextMenuExtraItem[]>(() => {
    const items: CommandContextMenuExtraItem[] = [
      {
        type: 'item',
        id: 'preview-source',
        label: t('knowledge.data_source.actions.preview_source'),
        icon: <BookOpen className="size-3.5" />,
        onSelect: () => {
          void Promise.resolve(onPreviewSource()).catch((error) => {
            toast.error(formatErrorMessageWithPrefix(error, t('knowledge.data_source.preview.failed')))
          })
        }
      }
    ]

    if (canViewChunks) {
      items.push({
        type: 'item',
        id: 'view-chunks',
        label: t('knowledge.data_source.actions.view_chunks'),
        icon: <Eye className="size-3.5" />,
        onSelect: onViewChunks
      })
    }

    if (canReindex) {
      items.push({
        type: 'item',
        id: 'reindex',
        label: t('knowledge.data_source.actions.reindex'),
        icon: <RefreshCw className="size-3.5" />,
        onSelect: () => {
          void Promise.resolve(onReindex()).catch((error) => {
            toast.error(formatErrorMessageWithPrefix(error, t('knowledge.data_source.reindex_failed')))
          })
        }
      })
    }

    items.push({ type: 'separator' })
    items.push({
      type: 'item',
      id: 'delete',
      label: t('knowledge.data_source.actions.delete'),
      icon: <Trash2 className="size-3.5" />,
      destructive: true,
      onSelect: () => {
        void Promise.resolve(onDelete()).catch((error) => {
          toast.error(formatErrorMessageWithPrefix(error, t('knowledge.data_source.delete_failed')))
        })
      }
    })

    return items
  }, [canReindex, canViewChunks, onDelete, onPreviewSource, onReindex, onViewChunks, t])

  // Keyboard equivalent for the row's primary click action. Only handle keys raised on the row
  // itself so Enter/Space on the checkbox (which bubble up) don't also open chunks.
  const handleRowKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.target !== event.currentTarget) {
      return
    }
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      onClick()
    }
  }

  return (
    <CommandContextMenu location="webcontents.context" extraItems={contextMenuItems}>
      <div
        role="row"
        data-state={selected ? 'selected' : undefined}
        tabIndex={canActivate ? 0 : undefined}
        aria-label={canActivate ? t('knowledge.data_source.table.open_row', { title }) : undefined}
        onClick={canActivate ? onClick : undefined}
        onKeyDown={canActivate ? handleRowKeyDown : undefined}
        className={cn(
          KNOWLEDGE_ITEM_ROW_GRID,
          'group/row rounded-md px-2.5 py-1.5 transition-colors',
          canActivate &&
            'cursor-pointer focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50',
          // Match the navigator base rows: hover highlight for any row, solid selected background
          // for the checked one.
          selected ? 'bg-secondary' : 'hover:bg-accent'
        )}>
        <div role="gridcell" className="flex items-center self-stretch" onClick={(event) => event.stopPropagation()}>
          {/* The label fills the whole cell so a click anywhere in the checkbox column toggles
              selection; the cell's stopPropagation keeps that click from also opening the row. */}
          <label className="flex size-full cursor-pointer items-center">
            <Checkbox
              size="sm"
              className={knowledgeDataSourceCheckboxClassName}
              aria-label={t('knowledge.data_source.table.select_row')}
              checked={selected}
              onCheckedChange={(next) => onToggleSelect(next === true)}
            />
          </label>
        </div>
        <div role="gridcell" className="flex min-w-0 items-center gap-2">
          <span className="flex size-6 shrink-0 items-center justify-center rounded bg-background-subtle">
            <Icon className={cn('size-3.5', icon.iconClassName)} />
          </span>
          <span className="min-w-0 flex-1 truncate text-foreground text-sm" title={fullTitle}>
            {title}
          </span>
        </div>
        <div role="gridcell" className="truncate text-foreground-secondary text-xs">
          {typeLabel}
        </div>
        <div role="gridcell">
          <KnowledgeItemStatusBadge
            status={status}
            failureReason={failureReason}
            embeddingProgress={item.status === 'embedding' ? <KnowledgeItemEmbeddingProgress itemId={item.id} /> : null}
          />
        </div>
        <div role="gridcell" className="truncate text-foreground-muted text-xs">
          {updatedAt}
        </div>
        <div role="gridcell" className="flex items-center justify-center" onClick={(event) => event.stopPropagation()}>
          <KnowledgeRowActionsMenu items={contextMenuItems} />
        </div>
      </div>
    </CommandContextMenu>
  )
}

export default KnowledgeItemRow
