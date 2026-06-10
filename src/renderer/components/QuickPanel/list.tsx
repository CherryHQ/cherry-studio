import { Flex } from '@cherrystudio/ui'
import { cn } from '@cherrystudio/ui/lib/utils'
import { t } from 'i18next'
import { Check, ChevronRight } from 'lucide-react'
import type { ReactNode, Ref } from 'react'
import { useEffect, useRef } from 'react'

export interface QuickPanelRowData {
  id?: string
  label: ReactNode | string
  description?: ReactNode | string
  icon?: ReactNode | string
  suffix?: ReactNode | string
  disabled?: boolean
  isMenu?: boolean
}

export interface QuickPanelCandidateItem extends QuickPanelRowData {
  id: string
  selected?: boolean
}

interface QuickPanelFrameProps {
  children: ReactNode
  className?: string
}

interface QuickPanelListProps<T extends QuickPanelCandidateItem> {
  items: readonly T[]
  activeIndex: number
  emptyLabel: ReactNode
  onSelect: (item: T, index: number) => void
}

interface QuickPanelFooterProps {
  title?: ReactNode
  showPageHint?: boolean
  assistiveKey?: string
  assistiveKeyActive?: boolean
  confirmLabel?: ReactNode
  className?: string
  containerRef?: Ref<HTMLDivElement>
}

interface QuickPanelReadOnlyHeaderProps {
  title?: ReactNode
  onClose: () => void
}

interface QuickPanelRowProps<T extends QuickPanelRowData> {
  active: boolean
  className?: string
  contentClassName?: string
  dataId?: string
  hoverEnabled?: boolean
  item: T
  onSelect: () => void
  reserveIconSlot?: boolean
  readOnly?: boolean
  rowRef?: Ref<HTMLDivElement>
  selected?: boolean
}

export function firstQuickPanelSelectableIndex(items: readonly QuickPanelCandidateItem[]) {
  return items.findIndex((item) => !item.disabled)
}

function selectableIndexes(items: readonly QuickPanelCandidateItem[]) {
  return items.flatMap((item, index) => (item.disabled ? [] : [index]))
}

export function moveQuickPanelSelectableIndex(
  items: readonly QuickPanelCandidateItem[],
  index: number,
  offset: number,
  options: { wrap: boolean }
) {
  const indexes = selectableIndexes(items)
  if (indexes.length === 0) return -1

  if (index === -1) {
    return offset < 0 ? indexes[indexes.length - 1] : indexes[0]
  }

  const currentPosition = indexes.indexOf(index)
  const basePosition = currentPosition === -1 ? 0 : currentPosition
  const nextPosition = basePosition + offset

  if (options.wrap) {
    return indexes[(nextPosition + indexes.length) % indexes.length]
  }

  return indexes[Math.min(Math.max(nextPosition, 0), indexes.length - 1)]
}

export function toggleQuickPanelSelectedId(ids: ReadonlySet<string>, id: string) {
  const nextIds = new Set(ids)
  if (nextIds.has(id)) {
    nextIds.delete(id)
  } else {
    nextIds.add(id)
  }

  return nextIds
}

export function QuickPanelFrame({ children, className }: QuickPanelFrameProps) {
  return (
    <div
      className={cn(
        'w-80 overflow-hidden rounded-xl border border-border bg-popover p-1.5 text-popover-foreground shadow-xl',
        className
      )}>
      {children}
    </div>
  )
}

export function QuickPanelFooter({
  assistiveKey,
  assistiveKeyActive = false,
  className,
  confirmLabel,
  containerRef,
  showPageHint = false,
  title
}: QuickPanelFooterProps) {
  return (
    <div
      ref={containerRef}
      data-testid="quick-panel-footer"
      className={cn('flex w-full items-center justify-between gap-4 px-3 pt-2 pb-[5px]', className)}>
      <div className="overflow-hidden text-ellipsis whitespace-nowrap text-[12px] text-muted-foreground">
        {title || ''}
      </div>
      <div className="flex shrink-0 items-center justify-end gap-4 text-[12px] text-muted-foreground">
        <span>ESC {t('settings.quickPanel.close')}</span>

        <Flex className="items-center gap-1">▲▼ {t('settings.quickPanel.select')}</Flex>

        {assistiveKey && showPageHint ? (
          <Flex className="items-center gap-1">
            <span className={assistiveKeyActive ? 'text-foreground' : 'text-muted-foreground'}>{assistiveKey}</span>+ ▲▼{' '}
            {t('settings.quickPanel.page')}
          </Flex>
        ) : null}

        <Flex className="items-center gap-1">Tab/↩︎ {confirmLabel ?? t('settings.quickPanel.confirm')}</Flex>
      </div>
    </div>
  )
}

export function QuickPanelReadOnlyHeader({ onClose, title }: QuickPanelReadOnlyHeaderProps) {
  return (
    <div className="flex w-full items-center justify-between gap-4 px-3 pt-2 pb-[7px]">
      <div className="overflow-hidden text-ellipsis whitespace-nowrap font-medium text-[13px] text-foreground">
        {title || ''}
      </div>
      <button
        type="button"
        className="shrink-0 rounded-md px-1.5 py-0.5 text-[12px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        onClick={(event) => {
          event.stopPropagation()
          onClose()
        }}>
        {t('settings.quickPanel.close')}
      </button>
    </div>
  )
}

export function QuickPanelRow<T extends QuickPanelRowData>({
  active,
  className,
  contentClassName = 'max-w-[68%]',
  dataId,
  hoverEnabled = true,
  item,
  onSelect,
  reserveIconSlot = false,
  readOnly = false,
  rowRef,
  selected = false
}: QuickPanelRowProps<T>) {
  const suffixContent = item.suffix ? (
    item.suffix
  ) : selected ? (
    <Check />
  ) : item.isMenu && !item.disabled && !readOnly ? (
    <ChevronRight size={14} />
  ) : null
  const canHover = hoverEnabled && !readOnly && !item.disabled

  return (
    <div
      ref={rowRef}
      className={cn(
        'mx-[5px] mb-px flex h-[30px] items-center justify-between gap-5 rounded-md p-[5px] transition-colors duration-100',
        readOnly ? 'cursor-default' : item.disabled ? 'cursor-not-allowed opacity-40' : 'cursor-pointer',
        !readOnly && selected && 'bg-muted',
        !readOnly && selected && active && 'bg-accent',
        !readOnly && !selected && active && 'bg-accent',
        canHover && 'hover:bg-accent',
        className
      )}
      data-active={active}
      data-id={dataId}
      data-selected={selected ? '' : undefined}
      onClick={(event) => {
        event.stopPropagation()
        if (readOnly) return
        onSelect()
      }}>
      <div className={cn('flex flex-1 shrink-0 items-center gap-[5px]', contentClassName)}>
        {reserveIconSlot || item.icon ? (
          <span className="flex items-center justify-center text-[13px] text-muted-foreground [&>svg]:size-[1em] [&>svg]:text-muted-foreground">
            {item.icon}
          </span>
        ) : null}
        <span className="flex-1 shrink-0 overflow-hidden text-ellipsis whitespace-nowrap text-[13px] leading-4">
          {item.label}
        </span>
      </div>
      <div className="flex min-w-[20%] items-center justify-end gap-0.5 text-[11px] text-muted-foreground">
        {item.description ? (
          <span className="overflow-hidden text-ellipsis whitespace-nowrap">{item.description}</span>
        ) : null}
        {suffixContent ? (
          <span className="flex min-w-3 shrink-0 items-center justify-end gap-[3px] [&>svg]:size-[1em] [&>svg]:text-muted-foreground">
            {suffixContent}
          </span>
        ) : null}
      </div>
    </div>
  )
}

export function QuickPanelList<T extends QuickPanelCandidateItem>({
  activeIndex,
  emptyLabel,
  items,
  onSelect
}: QuickPanelListProps<T>) {
  const itemRefs = useRef(new Map<string, HTMLDivElement>())

  useEffect(() => {
    const activeItem = items[activeIndex]
    if (!activeItem) return
    itemRefs.current.get(activeItem.id)?.scrollIntoView({ block: 'nearest' })
  }, [activeIndex, items])

  return (
    <div className="max-h-72 overflow-y-auto">
      {items.length > 0 ? (
        items.map((item, itemIndex) => (
          <QuickPanelRow
            key={item.id}
            active={itemIndex === activeIndex}
            dataId={item.id}
            item={item}
            rowRef={(node) => {
              if (node) {
                itemRefs.current.set(item.id, node)
              } else {
                itemRefs.current.delete(item.id)
              }
            }}
            selected={item.selected}
            onSelect={() => onSelect(item, itemIndex)}
          />
        ))
      ) : (
        <div className="p-4 text-center text-[13px] text-muted-foreground">{emptyLabel}</div>
      )}
    </div>
  )
}
