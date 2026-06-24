import { Button, Checkbox, RowFlex } from '@cherrystudio/ui'
import { ActionConfirmDialog } from '@renderer/components/chat/actions/ActionConfirmDialog'
import type { ResolvedAction } from '@renderer/components/chat/actions/actionTypes'
import { CommandContextMenu, type CommandContextMenuExtraItem } from '@renderer/components/command'
import { DynamicVirtualList } from '@renderer/components/VirtualList'
import { cn } from '@renderer/utils'
import dayjs from 'dayjs'
import type { TFunction } from 'i18next'
import { PinIcon, Trash2 } from 'lucide-react'
import type { ReactElement, ReactNode } from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

const historyTableClassName = 'min-w-[760px] rounded-none border-0 bg-card shadow-none'
export const historyTableGridClassName = 'grid min-w-[760px] grid-cols-[44px_minmax(284px,1fr)_160px_96px_76px]'
const historyHeaderClassName =
  'sticky top-0 z-10 border-border-muted border-b bg-card text-muted-foreground text-xs leading-4'
const historyHeaderCellClassName = 'flex h-10 min-w-0 items-center px-3 py-2 font-semibold'
export const historyBodyRowClassName =
  'border-border-subtle border-b bg-card text-foreground-secondary text-sm leading-5 transition-colors hover:bg-muted data-[state=selected]:bg-muted'
export const historyBodyCellClassName = 'flex min-w-0 items-center px-3 py-2.5'
export const historyFixedActionCellClassName =
  'sticky right-0 z-2 justify-center bg-inherit px-2 [border-left:0.5px_solid_var(--color-border-subtle)]'
export const historyFixedActionShadowClassName = '[box-shadow:-8px_0_12px_-12px_var(--color-border-active)]'

interface HistoryVirtualTableProps<TItem> {
  emptyContent: ReactNode
  estimateSize: (index: number) => number
  header: ReactNode
  items: TItem[]
  onFixedActionShadowChange: (showShadow: boolean) => void
  renderRow: (item: TItem, index: number) => ReactNode
}

export function HistoryVirtualTable<TItem>({
  emptyContent,
  estimateSize,
  header,
  items,
  onFixedActionShadowChange,
  renderRow
}: HistoryVirtualTableProps<TItem>) {
  const scrollerRef = useRef<HTMLDivElement | null>(null)
  const updateFixedActionShadow = useCallback(() => {
    const scroller = scrollerRef.current
    if (!scroller) {
      onFixedActionShadowChange(false)
      return
    }

    const maxScrollLeft = scroller.scrollWidth - scroller.clientWidth
    onFixedActionShadowChange(maxScrollLeft > 1 && scroller.scrollLeft < maxScrollLeft - 1)
  }, [onFixedActionShadowChange])

  useEffect(() => {
    updateFixedActionShadow()

    const scroller = scrollerRef.current
    if (!scroller || typeof ResizeObserver === 'undefined') return

    const resizeObserver = new ResizeObserver(updateFixedActionShadow)
    resizeObserver.observe(scroller)
    if (scroller.firstElementChild) {
      resizeObserver.observe(scroller.firstElementChild)
    }

    return () => resizeObserver.disconnect()
    // `header` is intentionally excluded: callers pass a fresh inline element each render, so keeping it
    // here would tear down and rebuild the observer on every render. `items.length` already covers the
    // empty<->non-empty scroller swap, and the observer itself handles size changes.
  }, [items.length, updateFixedActionShadow])

  return (
    <div className="min-h-0 flex-1 px-3 py-3" role="table">
      <div className={cn('flex h-full min-h-0 flex-col overflow-hidden', historyTableClassName)}>
        {items.length > 0 ? (
          <DynamicVirtualList
            autoHideScrollbar
            className="min-h-0 flex-1"
            estimateSize={estimateSize}
            header={header}
            list={items}
            onScroll={updateFixedActionShadow}
            overscan={8}
            role="rowgroup"
            scrollElementRef={scrollerRef}
            scrollerStyle={{ overflowX: 'auto' }}>
            {renderRow}
          </DynamicVirtualList>
        ) : (
          <div ref={scrollerRef} className="min-h-0 flex-1 overflow-auto" onScroll={updateFixedActionShadow}>
            {header}
            {emptyContent}
          </div>
        )}
      </div>
    </div>
  )
}

interface HistoryTableHeaderProps {
  actionsLabel: string
  selectAllLabel: string
  selectionDisabled?: boolean
  selectedState: boolean | 'indeterminate'
  showFixedActionShadow: boolean
  sourceLabel: string
  timeLabel: string
  titleLabel: string
  onToggleAll: (checked: boolean) => void
}

export const HistoryTableHeader = ({
  actionsLabel,
  selectAllLabel,
  selectionDisabled = false,
  selectedState,
  showFixedActionShadow,
  sourceLabel,
  timeLabel,
  titleLabel,
  onToggleAll
}: HistoryTableHeaderProps) => (
  <div className={cn(historyTableGridClassName, historyHeaderClassName)} role="row">
    <div className={cn(historyHeaderCellClassName, 'justify-center px-2')} role="columnheader">
      <Checkbox
        size="sm"
        checked={selectedState}
        disabled={selectionDisabled}
        aria-label={selectAllLabel}
        onCheckedChange={(checked) => onToggleAll(Boolean(checked))}
        onClick={(event) => event.stopPropagation()}
      />
    </div>
    <div className={historyHeaderCellClassName} role="columnheader">
      {titleLabel}
    </div>
    <div className={historyHeaderCellClassName} role="columnheader">
      {sourceLabel}
    </div>
    <div className={historyHeaderCellClassName} role="columnheader">
      {timeLabel}
    </div>
    <div
      className={cn(
        historyHeaderCellClassName,
        historyFixedActionCellClassName,
        showFixedActionShadow && historyFixedActionShadowClassName
      )}
      role="columnheader">
      {actionsLabel}
    </div>
  </div>
)

interface HistorySelectionCellProps {
  checked: boolean
  disabled?: boolean
  label: string
  onCheckedChange: (checked: boolean) => void
}

export const HistorySelectionCell = ({
  checked,
  disabled = false,
  label,
  onCheckedChange
}: HistorySelectionCellProps) => (
  <div className={cn(historyBodyCellClassName, 'justify-center px-2')} role="cell">
    <Checkbox
      size="sm"
      checked={checked}
      disabled={disabled}
      aria-label={label}
      onCheckedChange={(nextChecked) => onCheckedChange(Boolean(nextChecked))}
      onClick={(event) => event.stopPropagation()}
    />
  </div>
)

interface HistoryTitleButtonProps {
  title: string
  onOpen?: () => void
}

export const HistoryTitleButton = ({ title, onOpen }: HistoryTitleButtonProps) => (
  <span
    role="button"
    tabIndex={0}
    className="-mx-1 block w-full min-w-0 max-w-full cursor-pointer truncate rounded-sm px-1 py-0 text-left font-medium text-foreground-secondary transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
    title={title}
    onClick={(event) => {
      event.stopPropagation()
      onOpen?.()
    }}
    onKeyDown={(event) => {
      if (event.key !== 'Enter' && event.key !== ' ') return
      event.preventDefault()
      event.stopPropagation()
      onOpen?.()
    }}>
    {title}
  </span>
)

interface HistoryActionContextMenuProps<TContext = unknown> {
  actions: readonly ResolvedAction<TContext>[]
  children: ReactElement
  className?: string
  onAction: (action: ResolvedAction<TContext>) => void | Promise<void>
}

export function HistoryActionContextMenu<TContext = unknown>({
  actions,
  children,
  className,
  onAction
}: HistoryActionContextMenuProps<TContext>) {
  const runAction = useCallback(
    (action: ResolvedAction<TContext>) => {
      if (!action.availability.enabled) return
      const confirm = action.confirm
      if (confirm) {
        void window.modal.confirm({
          title: confirm.title,
          content: confirm.description ?? confirm.content,
          okText: confirm.confirmText,
          cancelText: confirm.cancelText,
          centered: true,
          okButtonProps: confirm.destructive ? { danger: true } : undefined,
          onOk: () => onAction(action)
        })
        return
      }
      window.requestAnimationFrame(() => void onAction(action))
    },
    [onAction]
  )

  const extraItems = useMemo<CommandContextMenuExtraItem[]>(() => {
    const toItems = (list: readonly ResolvedAction<TContext>[]): CommandContextMenuExtraItem[] => {
      const items: CommandContextMenuExtraItem[] = []
      let previousGroup: string | undefined
      for (const action of list) {
        if (!action.availability.visible) continue
        if (items.length > 0 && action.group !== previousGroup) {
          items.push({ type: 'separator' })
        }
        previousGroup = action.group
        const label = String(action.label)
        if (action.children.length > 0) {
          items.push({
            type: 'submenu',
            id: action.id,
            label,
            icon: action.icon,
            enabled: action.availability.enabled,
            children: toItems(action.children)
          })
        } else {
          items.push({
            type: 'item',
            id: action.id,
            label,
            icon: action.icon,
            enabled: action.availability.enabled,
            destructive: action.danger,
            shortcutLabel: action.shortcut,
            onSelect: () => runAction(action)
          })
        }
      }
      return items
    }
    return toItems(actions)
  }, [actions, runAction])

  return (
    <CommandContextMenu location="webcontents.context" extraItems={extraItems} contentClassName={className}>
      {children}
    </CommandContextMenu>
  )
}

interface HistoryActionsCellProps<TContext = unknown> {
  actions: readonly ResolvedAction<TContext>[]
  deleteLabel: string
  isPinned: boolean
  pinLabel: string
  unpinLabel: string
  onAction: (action: ResolvedAction<TContext>) => void | Promise<void>
  onTogglePin?: () => void | Promise<void>
}

export function HistoryActionsCell<TContext = unknown>({
  actions,
  deleteLabel,
  isPinned,
  pinLabel,
  unpinLabel,
  onAction,
  onTogglePin
}: HistoryActionsCellProps<TContext>) {
  const [pendingDeleteAction, setPendingDeleteAction] = useState<ResolvedAction<TContext> | undefined>()
  const deleteAction = useMemo(() => actions.find(isDeleteAction), [actions])
  const handleAction = useCallback(
    (action: ResolvedAction<TContext>) => {
      window.requestAnimationFrame(() => {
        void onAction(action)
      })
    },
    [onAction]
  )

  return (
    <>
      <RowFlex className="items-center justify-center gap-1" onClick={(event) => event.stopPropagation()}>
        <PinActionButton isPinned={isPinned} pinLabel={pinLabel} unpinLabel={unpinLabel} onClick={onTogglePin} />
        <DeleteActionButton
          action={deleteAction}
          label={deleteLabel}
          onClick={(action) => {
            if (action.confirm) {
              setPendingDeleteAction(action)
              return
            }
            handleAction(action)
          }}
        />
      </RowFlex>
      <ActionConfirmDialog
        open={!!pendingDeleteAction}
        confirm={pendingDeleteAction?.confirm}
        contentClassName="z-50"
        overlayClassName="z-40"
        onOpenChange={(open) => {
          if (!open) setPendingDeleteAction(undefined)
        }}
        onConfirm={async () => {
          if (!pendingDeleteAction) return
          handleAction(pendingDeleteAction)
          setPendingDeleteAction(undefined)
        }}
      />
    </>
  )
}

function isDeleteAction<TContext>(action: ResolvedAction<TContext>) {
  return action.id.endsWith('.delete') || action.commandId?.endsWith('.delete')
}

interface DeleteActionButtonProps<TContext = unknown> {
  action?: ResolvedAction<TContext>
  label: string
  onClick: (action: ResolvedAction<TContext>) => void
}

const DeleteActionButton = <TContext,>({ action, label, onClick }: DeleteActionButtonProps<TContext>) => {
  const disabled = !action?.availability.enabled

  return (
    <Button
      type="button"
      aria-label={label}
      className="text-foreground-secondary hover:bg-accent hover:text-foreground"
      data-testid="history-delete-button"
      disabled={disabled}
      size="icon-sm"
      title={label}
      variant="ghost"
      onClick={(event) => {
        event.stopPropagation()
        if (action) onClick(action)
      }}>
      <Trash2 className="size-4" />
    </Button>
  )
}

interface PinActionButtonProps {
  isPinned: boolean
  pinLabel: string
  unpinLabel: string
  onClick?: () => void | Promise<void>
}

const PinActionButton = ({ isPinned, pinLabel, unpinLabel, onClick }: PinActionButtonProps) => {
  const label = isPinned ? unpinLabel : pinLabel

  return (
    <Button
      type="button"
      aria-label={label}
      className="text-foreground-secondary hover:bg-accent hover:text-foreground"
      data-testid="history-pin-button"
      size="icon-sm"
      title={label}
      variant="ghost"
      onClick={(event) => {
        event.stopPropagation()
        void onClick?.()
      }}>
      <PinIcon size={14} className={cn(isPinned && '-rotate-45')} />
    </Button>
  )
}

export function formatHistoryTime(value: string, t: TFunction) {
  const date = dayjs(value)
  const now = dayjs()

  if (!date.isValid()) return t('history.records.table.emptyValue')
  if (date.isSame(now, 'day')) return date.format('HH:mm')
  if (date.isSame(now.subtract(1, 'day'), 'day')) return t('common.yesterday')
  if (date.isSame(now, 'year')) return date.format('MM/DD')

  return date.format('YYYY/MM/DD')
}
