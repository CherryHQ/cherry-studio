import {
  Button,
  Checkbox,
  MenuItem,
  MenuList,
  NormalTooltip,
  Popover,
  PopoverContent,
  PopoverTrigger
} from '@cherrystudio/ui'
import { cn } from '@cherrystudio/ui/lib/utils'
import { formatRelativeTime } from '@renderer/pages/knowledge/utils'
import { getKnowledgeItemFailureReason } from '@renderer/pages/knowledge/utils/error'
import { formatErrorMessageWithPrefix } from '@renderer/utils/error'
import type { KnowledgeItem } from '@shared/data/types/knowledge'
import { BookOpen, Check, CircleAlert, Eye, LoaderCircle, MoreHorizontal, RefreshCw, Trash2 } from 'lucide-react'
import type { ComponentProps, KeyboardEvent, MouseEvent } from 'react'
import { useState } from 'react'
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

const KnowledgeItemStatusBadge = ({
  failureReason,
  status
}: {
  failureReason: string | null
  status: DataSourceStatusViewModel
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
      <span>{t(status.labelKey)}</span>
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

const KnowledgeItemRowMoreButton = ({ isOpen, ...props }: { isOpen: boolean } & ComponentProps<typeof Button>) => {
  const { t } = useTranslation()

  return (
    <Button
      {...props}
      type="button"
      variant="ghost"
      size="icon-sm"
      aria-label={t('common.more')}
      className={cn(isOpen ? 'opacity-100' : 'opacity-0 group-hover/row:opacity-100')}>
      <MoreHorizontal />
    </Button>
  )
}

const KnowledgeItemRowMenuItems = ({
  canReindex,
  canViewChunks,
  onDelete,
  onPreviewSource,
  onReindex,
  onViewChunks
}: {
  canReindex: boolean
  canViewChunks: boolean
  onDelete: (event: MouseEvent<HTMLButtonElement>) => void
  onPreviewSource: (event: MouseEvent<HTMLButtonElement>) => void
  onReindex: (event: MouseEvent<HTMLButtonElement>) => void
  onViewChunks: (event: MouseEvent<HTMLButtonElement>) => void
}) => {
  const { t } = useTranslation()

  return (
    <MenuList>
      <MenuItem
        variant="ghost"
        size="sm"
        icon={<BookOpen className="size-3.5" />}
        label={t('knowledge.data_source.actions.preview_source')}
        onClick={onPreviewSource}
      />
      {canViewChunks ? (
        <MenuItem
          variant="ghost"
          size="sm"
          icon={<Eye className="size-3.5" />}
          label={t('knowledge.data_source.actions.view_chunks')}
          onClick={onViewChunks}
        />
      ) : null}
      {canReindex ? (
        <MenuItem
          variant="ghost"
          size="sm"
          icon={<RefreshCw className="size-3.5" />}
          label={t('knowledge.data_source.actions.reindex')}
          onClick={onReindex}
        />
      ) : null}
      <MenuItem
        variant="ghost"
        size="sm"
        icon={<Trash2 className="size-3.5" />}
        label={t('knowledge.data_source.actions.delete')}
        className="text-destructive hover:bg-destructive/10 hover:text-destructive focus-visible:ring-destructive/20"
        onClick={onDelete}
      />
    </MenuList>
  )
}

const KnowledgeItemRowMoreMenu = ({
  canReindex,
  canViewChunks,
  onDelete,
  onPreviewSource,
  onReindex,
  onViewChunks
}: {
  canReindex: boolean
  canViewChunks: boolean
  onDelete: () => void | Promise<unknown>
  onPreviewSource: () => void | Promise<unknown>
  onReindex: () => void | Promise<unknown>
  onViewChunks: () => void
}) => {
  const { t } = useTranslation()
  const [isOpen, setIsOpen] = useState(false)

  const handlePreviewSource = (event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation()
    setIsOpen(false)
    void Promise.resolve(onPreviewSource()).catch((error) => {
      window.toast.error(formatErrorMessageWithPrefix(error, t('knowledge.data_source.preview.failed')))
    })
  }

  const handleViewChunks = (event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation()
    setIsOpen(false)
    onViewChunks()
  }

  const handleReindex = (event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation()
    setIsOpen(false)
    void Promise.resolve(onReindex()).catch((error) => {
      window.toast.error(formatErrorMessageWithPrefix(error, t('knowledge.data_source.reindex_failed')))
    })
  }

  const handleDelete = (event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation()
    setIsOpen(false)
    void Promise.resolve(onDelete()).catch((error) => {
      window.toast.error(formatErrorMessageWithPrefix(error, t('knowledge.data_source.delete_failed')))
    })
  }

  return (
    <Popover open={isOpen} onOpenChange={setIsOpen}>
      <PopoverTrigger asChild>
        <KnowledgeItemRowMoreButton isOpen={isOpen} onClick={(event) => event.stopPropagation()} />
      </PopoverTrigger>
      <PopoverContent
        align="end"
        side="bottom"
        sideOffset={4}
        collisionPadding={8}
        className="z-30 w-max max-w-56"
        onClick={(event) => event.stopPropagation()}
        onOpenAutoFocus={(event) => event.preventDefault()}
        onCloseAutoFocus={(event) => event.preventDefault()}>
        <KnowledgeItemRowMenuItems
          canReindex={canReindex}
          canViewChunks={canViewChunks}
          onDelete={handleDelete}
          onPreviewSource={handlePreviewSource}
          onReindex={handleReindex}
          onViewChunks={handleViewChunks}
        />
      </PopoverContent>
    </Popover>
  )
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
  const typeLabel = t(dataSourceTypeDisplayConfig[item.type].filterLabelKey)
  const updatedAt = formatRelativeTime(item.updatedAt, language)
  const fullTitle = 'source' in item.data ? item.data.source : title

  // Keyboard equivalent for the row's primary click action. Only handle keys raised on the row
  // itself so Enter/Space on the checkbox or more-button (which bubble up) don't also open chunks.
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
    <div
      role="row"
      data-state={selected ? 'selected' : undefined}
      tabIndex={canViewChunks ? 0 : undefined}
      aria-label={canViewChunks ? t('knowledge.data_source.table.view_chunks_row', { title }) : undefined}
      onClick={canViewChunks ? onClick : undefined}
      onKeyDown={canViewChunks ? handleRowKeyDown : undefined}
      className={cn(
        KNOWLEDGE_ITEM_ROW_GRID,
        'group/row min-h-12 rounded-lg transition-colors',
        canViewChunks &&
          'cursor-pointer focus-visible:outline-none focus-visible:ring-ring/50 focus-visible:ring-[3px]',
        selected ? 'bg-accent' : canViewChunks && 'hover:bg-accent/40'
      )}>
      <div role="gridcell" className="flex items-center" onClick={(event) => event.stopPropagation()}>
        <Checkbox
          size="sm"
          className={knowledgeDataSourceCheckboxClassName}
          aria-label={t('knowledge.data_source.table.select_row')}
          checked={selected}
          onCheckedChange={(next) => onToggleSelect(next === true)}
        />
      </div>
      <div role="gridcell" className="flex min-w-0 items-center gap-2 py-3">
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
        <KnowledgeItemStatusBadge status={status} failureReason={failureReason} />
      </div>
      <div role="gridcell" className="truncate text-foreground-muted text-xs">
        {updatedAt}
      </div>
      <div role="gridcell" className="flex justify-end" onClick={(event) => event.stopPropagation()}>
        <KnowledgeItemRowMoreMenu
          canReindex={canReindex}
          canViewChunks={canViewChunks}
          onDelete={onDelete}
          onPreviewSource={onPreviewSource}
          onReindex={onReindex}
          onViewChunks={onViewChunks}
        />
      </div>
    </div>
  )
}

export default KnowledgeItemRow
