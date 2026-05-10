import { Button, MenuItem, MenuList, NormalTooltip, Popover, PopoverContent, PopoverTrigger } from '@cherrystudio/ui'
import { cn } from '@cherrystudio/ui/lib/utils'
import { formatErrorMessageWithPrefix } from '@renderer/utils/error'
import type { KnowledgeItem } from '@shared/data/types/knowledge'
import { BookOpen, Check, CircleAlert, Eye, LoaderCircle, MoreHorizontal, RefreshCw, Trash2 } from 'lucide-react'
import type { ComponentProps, MouseEvent, ReactNode } from 'react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import type { DataSourceIconMeta, DataSourceStatusViewModel } from './utils/models'
import { toKnowledgeItemRowViewModel } from './utils/selectors'

export interface KnowledgeItemRowProps {
  item: KnowledgeItem
  onClick: () => void
  onDelete: () => void | Promise<unknown>
  onPreviewSource: () => void | Promise<unknown>
  onReindex: () => void | Promise<unknown>
  onViewChunks: () => void
}

const KnowledgeItemRowIcon = ({ icon, iconClassName }: DataSourceIconMeta) => {
  const Icon = icon

  return (
    <div className="flex size-6 shrink-0 items-center justify-center rounded bg-accent/40">
      <Icon className={cn('size-3.5', iconClassName)} />
    </div>
  )
}

const KnowledgeItemRowContent = ({
  id,
  metaParts,
  suffix,
  title
}: {
  id: string
  metaParts: string[]
  suffix: string
  title: string
}) => (
  <div className="min-w-0 flex-1">
    <div className="flex items-center gap-1.5">
      <div className="truncate text-foreground text-sm leading-5">{title}</div>
      {suffix ? <span className="shrink-0 text-muted-foreground/30 text-xs uppercase leading-3">{suffix}</span> : null}
    </div>

    <div className="mt-px flex items-center gap-1.5 text-muted-foreground/35 text-xs leading-4">
      {metaParts.map((part) => (
        <span key={`${id}-${part}`}>{part}</span>
      ))}
    </div>
  </div>
)

const KnowledgeItemRowStatus = ({
  failureReason,
  status
}: {
  failureReason: string | null
  status: DataSourceStatusViewModel
}) => {
  const { t } = useTranslation()
  const icon =
    status.icon === 'loader' ? (
      <LoaderCircle className="size-1.75 animate-spin" />
    ) : status.icon === 'check' ? (
      <Check className="size-1.75" />
    ) : (
      <CircleAlert className="size-2" />
    )

  const content = (
    <span
      className={cn(
        'inline-flex items-center gap-0.5 text-xs leading-4',
        failureReason ? 'cursor-help' : '',
        status.textClassName
      )}
      tabIndex={failureReason ? 0 : undefined}
      aria-label={failureReason ?? undefined}>
      {icon}
      <span>{t(status.labelKey)}</span>
    </span>
  )

  return (
    <div className="flex shrink-0 items-center">
      {failureReason ? (
        <NormalTooltip
          content={failureReason}
          side="bottom"
          contentProps={{
            className: 'max-w-72 rounded-md px-2.5 py-1.5 leading-4 text-foreground/75'
          }}>
          {content}
        </NormalTooltip>
      ) : (
        content
      )}
    </div>
  )
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
      className={cn(
        'size-5 min-h-5 min-w-5 shrink-0 rounded p-0 text-muted-foreground/25 shadow-none transition-all hover:bg-accent hover:text-foreground',
        isOpen ? 'opacity-100' : 'opacity-0 group-hover/row:opacity-100'
      )}>
      <MoreHorizontal className="size-2.5" />
    </Button>
  )
}

const KnowledgeItemActionMenuIcon = ({ children }: { children: ReactNode }) => {
  return <span className="[&_svg]:size-2.25">{children}</span>
}

const KnowledgeItemActionMenuItem = ({
  icon,
  label,
  onClick
}: {
  icon: ReactNode
  label: string
  onClick: (event: MouseEvent<HTMLButtonElement>) => void
}) => {
  return (
    <MenuItem
      variant="ghost"
      size="sm"
      icon={<KnowledgeItemActionMenuIcon>{icon}</KnowledgeItemActionMenuIcon>}
      label={label}
      className="gap-1.5 rounded-md px-2 py-1 font-normal text-popover-foreground"
      onClick={onClick}
    />
  )
}

const KnowledgeItemDeleteMenuItem = ({
  icon,
  label,
  onClick
}: {
  icon: ReactNode
  label: string
  onClick: (event: MouseEvent<HTMLButtonElement>) => void
}) => {
  return (
    <MenuItem
      variant="ghost"
      size="sm"
      icon={<KnowledgeItemActionMenuIcon>{icon}</KnowledgeItemActionMenuIcon>}
      label={label}
      className="gap-1.5 rounded-md px-2 py-1 font-normal text-red-500 hover:bg-red-500/10 hover:text-red-500 focus-visible:ring-red-500/20"
      onClick={onClick}
    />
  )
}

const KnowledgeItemRowMenuItems = ({
  onDelete,
  onPreviewSource,
  onReindex,
  onViewChunks
}: {
  onDelete: (event: MouseEvent<HTMLButtonElement>) => void
  onPreviewSource: (event: MouseEvent<HTMLButtonElement>) => void
  onReindex: (event: MouseEvent<HTMLButtonElement>) => void
  onViewChunks: (event: MouseEvent<HTMLButtonElement>) => void
}) => {
  const { t } = useTranslation()

  return (
    <MenuList className="gap-0.5">
      <KnowledgeItemActionMenuItem
        icon={<BookOpen />}
        label={t('knowledge_v2.data_source.actions.preview_source')}
        onClick={onPreviewSource}
      />
      <KnowledgeItemActionMenuItem
        icon={<Eye />}
        label={t('knowledge_v2.data_source.actions.view_chunks')}
        onClick={onViewChunks}
      />
      <KnowledgeItemActionMenuItem
        icon={<RefreshCw />}
        label={t('knowledge_v2.data_source.actions.reindex')}
        onClick={onReindex}
      />
      <KnowledgeItemDeleteMenuItem
        icon={<Trash2 />}
        label={t('knowledge_v2.data_source.actions.delete')}
        onClick={onDelete}
      />
    </MenuList>
  )
}

const KnowledgeItemRowMoreMenu = ({
  onDelete,
  onPreviewSource,
  onReindex,
  onViewChunks
}: {
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
    void onPreviewSource()
  }

  const handleViewChunks = (event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation()
    setIsOpen(false)
    onViewChunks()
  }

  const handleReindex = (event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation()
    setIsOpen(false)
    void Promise.resolve()
      .then(onReindex)
      .catch((error) => {
        window.toast.error(formatErrorMessageWithPrefix(error, t('knowledge_v2.data_source.reindex_failed')))
      })
  }

  const handleDelete = (event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation()
    setIsOpen(false)
    void onDelete()
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
        className="z-30 w-30 rounded-lg p-1 shadow-xl"
        onClick={(event) => event.stopPropagation()}
        onOpenAutoFocus={(event) => event.preventDefault()}
        onCloseAutoFocus={(event) => event.preventDefault()}>
        <KnowledgeItemRowMenuItems
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
  onClick,
  onDelete,
  onPreviewSource,
  onReindex,
  onViewChunks
}: KnowledgeItemRowProps) => {
  const {
    i18n: { language }
  } = useTranslation()
  const { icon, metaParts, status, suffix, title } = toKnowledgeItemRowViewModel(item, language)
  const failureReason = item.status === 'failed' ? item.error : null

  return (
    <div
      className="group/row relative flex h-11 cursor-pointer items-center gap-2.5 px-2.5 py-1.5 transition-colors hover:bg-accent/25"
      onClick={onClick}>
      <KnowledgeItemRowIcon {...icon} />
      <KnowledgeItemRowContent id={item.id} title={title} suffix={suffix} metaParts={metaParts} />
      <KnowledgeItemRowStatus status={status} failureReason={failureReason} />
      <KnowledgeItemRowMoreMenu
        onDelete={onDelete}
        onPreviewSource={onPreviewSource}
        onReindex={onReindex}
        onViewChunks={onViewChunks}
      />
    </div>
  )
}

export default KnowledgeItemRow
