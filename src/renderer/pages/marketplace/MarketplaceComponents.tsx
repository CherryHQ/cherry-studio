import { useVirtualizer } from '@tanstack/react-virtual'
import { type ComponentProps, type MouseEvent, type ReactNode, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import {
  Badge,
  Button,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  EmptyState,
  HorizontalScrollContainer,
  Spinner,
  ScrollArea
} from '@cherrystudio/ui'
import { cn } from '@renderer/utils/style'

export function MarketplaceCategoryFilter({
  categories,
  category,
  onCategoryChange,
  categoryLabel
}: {
  categories: string[]
  category: string
  onCategoryChange: (category: string) => void
  categoryLabel: (category: string) => string
}) {
  const { t } = useTranslation()
  return (
    <div role="group" className="mb-3 shrink-0 pr-4" aria-label={t('marketplace.categories')}>
      <HorizontalScrollContainer
        gap="4px"
        scrollLeftLabel={t('settings.models.filter.scroll_left')}
        scrollRightLabel={t('settings.models.filter.scroll_right')}>
        {['', ...categories].map((group) => (
          <Button
            key={group}
            variant="ghost"
            size="sm"
            className={'shrink-0 rounded-full ' + (category === group ? 'bg-accent' : '')}
            aria-pressed={category === group}
            onClick={() => onCategoryChange(group)}>
            {group ? categoryLabel(group) : t('common.all')}
          </Button>
        ))}
      </HorizontalScrollContainer>
    </div>
  )
}

export function MarketplaceCard({
  name,
  description,
  icon,
  onOpen,
  action,
  children
}: {
  name: string
  description: string
  icon: ReactNode
  onOpen: (event: MouseEvent<HTMLButtonElement>) => void
  action: ReactNode
  children?: ReactNode
}) {
  return (
    <div className="flex h-full min-w-0 items-center gap-2 rounded-2xl border border-border-subtle pr-3 transition-colors hover:bg-accent/50">
      <Button
        variant="ghost"
        className="h-auto min-h-20 min-w-0 flex-1 justify-start gap-3 rounded-2xl p-3 text-left hover:bg-transparent"
        onClick={onOpen}>
        {icon}
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium" title={name}>
            {name}
          </div>
          <p className="text-muted-foreground mt-0.5 line-clamp-2 text-xs font-normal">{description}</p>
          {children}
        </div>
      </Button>
      {action}
    </div>
  )
}

export function MarketplaceCardAction({ className, ...props }: ComponentProps<typeof Button>) {
  return (
    <Button
      variant="ghost"
      size="icon-sm"
      className={cn('text-muted-foreground size-7 shrink-0 rounded-full bg-background-subtle', className)}
      {...props}
    />
  )
}

export function MarketplaceGrid<T extends { id: string }>({
  items,
  renderItem,
  virtualized = false
}: {
  items: readonly T[]
  renderItem: (item: T) => ReactNode
  virtualized?: boolean
}) {
  const [element, setElement] = useState<HTMLDivElement | null>(null)
  const [columns, setColumns] = useState(1)
  useEffect(() => {
    if (!element || !virtualized) return
    const observer = new ResizeObserver(([entry]) => setColumns(entry.contentRect.width >= 720 ? 2 : 1))
    observer.observe(element)
    return () => observer.disconnect()
  }, [element, virtualized])
  const rows = useVirtualizer({
    count: virtualized ? Math.ceil(items.length / columns) : 0,
    getScrollElement: () => element,
    estimateSize: () => 88,
    getItemKey: (index) => items[index * columns].id,
    overscan: 5,
    gap: 8,
    enabled: virtualized
  })
  if (!virtualized)
    return (
      <div className="grid grid-cols-1 gap-x-4 gap-y-2 @[720px]:grid-cols-2">
        {items.map((item) => (
          <div key={item.id} className="min-w-0">
            {renderItem(item)}
          </div>
        ))}
      </div>
    )
  return (
    <ScrollArea
      viewportProps={{ ref: setElement }}
      className="min-h-0 flex-1"
      contentProps={{ className: 'pr-5 pb-4' }}
      data-testid="marketplace-virtual-grid">
      <div style={{ height: rows.getTotalSize(), position: 'relative' }}>
        {rows.getVirtualItems().map((row) => (
          <div
            key={row.key}
            ref={rows.measureElement}
            data-index={row.index}
            className="absolute top-0 left-0 grid w-full gap-4"
            style={{
              transform: 'translateY(' + row.start + 'px)',
              gridTemplateColumns: 'repeat(' + columns + ', minmax(0, 1fr))'
            }}>
            {items.slice(row.index * columns, (row.index + 1) * columns).map((item) => (
              <div key={item.id} className="min-w-0">
                {renderItem(item)}
              </div>
            ))}
          </div>
        ))}
      </div>
    </ScrollArea>
  )
}

export function MarketplaceLoadState({
  loading,
  error,
  empty,
  retry
}: {
  loading?: boolean
  error?: unknown
  empty: boolean
  retry?: () => unknown
}) {
  const { t } = useTranslation()
  if (error)
    return (
      <div role="alert" className="text-error my-3 flex items-center justify-between gap-3 text-sm">
        {t('marketplace.catalog_load_failed')}
        <Button variant="outline" size="sm" onClick={() => void retry?.()}>
          {t('common.retry')}
        </Button>
      </div>
    )
  if (loading)
    return (
      <div className="flex h-24 items-center justify-center">
        <Spinner text={t('common.loading')} />
      </div>
    )
  if (empty)
    return (
      <EmptyState
        preset="no-result"
        title={t('marketplace.no_results')}
        description={t('marketplace.no_results_description')}
      />
    )
  return null
}

export function MarketplaceDetailContent({ className, ...props }: ComponentProps<typeof DialogContent>) {
  const { t } = useTranslation()
  return (
    <DialogContent
      size="default"
      motion="fade-scale"
      closeLabel={t('common.close')}
      className={cn('flex max-h-[90vh] flex-col gap-0 overflow-hidden rounded-3xl bg-card p-0', className)}
      {...props}
    />
  )
}

export function MarketplaceDetailHeader({
  name,
  description,
  type,
  icon,
  curated = false,
  children
}: {
  name: string
  description: string
  type: string
  icon: ReactNode
  curated?: boolean
  children?: ReactNode
}) {
  return (
    <>
      <DialogDescription className="sr-only">{description}</DialogDescription>
      <DialogHeader
        className={cn(
          'shrink-0 border-b border-border-subtle px-5 pt-10 pb-5 text-left',
          curated && 'text-neutral-700'
        )}
        style={{
          backgroundColor: curated
            ? 'color-mix(in srgb, #FF8F99 98%, transparent)'
            : 'color-mix(in srgb, var(--card) 85%, transparent)',
          backgroundImage: curated
            ? 'linear-gradient(155deg, rgb(255 255 255 / 0.80) 0%, rgb(255 255 255 / 0.48) 52%, rgb(255 255 255 / 0.26) 100%)'
            : undefined,
          boxShadow: curated ? 'inset 0 1px 0 rgb(255 255 255 / 0.55)' : undefined
        }}>
        <div className="flex items-center gap-3">
          {icon}
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <DialogTitle className={cn('truncate', curated && 'text-neutral-700')} title={name}>
                {name}
              </DialogTitle>
              <Badge
                variant="secondary"
                className={cn('shrink-0', curated && 'border-white/40 bg-white/40 text-neutral-700')}>
                {type}
              </Badge>
            </div>
            {children}
          </div>
        </div>
      </DialogHeader>
    </>
  )
}

export function MarketplaceDetailBody({ children }: { children: ReactNode }) {
  return (
    <ScrollArea className="min-h-0 flex-1 bg-card" contentProps={{ className: 'space-y-5 px-5 py-5' }}>
      {children}
    </ScrollArea>
  )
}

export function MarketplaceDetailFooter({ children }: { children: ReactNode }) {
  return (
    <div className="flex shrink-0 items-center justify-between gap-3 border-t border-border-subtle bg-card px-5 py-3">
      {children}
    </div>
  )
}

export function MarketplaceDetailProperties({ items }: { items: { label: string; value: string }[] }) {
  return (
    <div className="grid grid-cols-[repeat(auto-fit,minmax(100px,1fr))] gap-2">
      {items
        .filter(({ value }) => value)
        .map(({ label, value }) => (
          <div key={label} className="min-w-0 rounded-xl border border-border-subtle bg-background-subtle px-3 py-2">
            <div className="text-foreground-tertiary text-xs">{label}</div>
            <div className="mt-1 truncate text-sm font-medium" title={value}>
              {value}
            </div>
          </div>
        ))}
    </div>
  )
}
