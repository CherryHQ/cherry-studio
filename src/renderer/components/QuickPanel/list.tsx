import { Kbd, NormalTooltip } from '@cherrystudio/ui'
import { cn } from '@cherrystudio/ui/lib/utils'
import { t } from 'i18next'
import { Check, ChevronRight } from 'lucide-react'
import { type ReactElement, type ReactNode, type Ref, useState } from 'react'

import { QUICK_PANEL_ROW_HEIGHT } from './heights'

const QUICK_PANEL_KBD_CLASS =
  'min-w-0 rounded-sm bg-muted! px-1 py-0.5 font-normal text-[11px] text-muted-foreground! leading-none'

export interface QuickPanelRowData {
  id?: string
  label: ReactNode | string
  description?: ReactNode | string
  inlineDescription?: boolean
  tooltip?: ReactNode | string
  /** In-row element used as the controlled Tooltip trigger. */
  tooltipAnchor?: ReactElement
  icon?: ReactNode | string
  suffix?: ReactNode | string
  disabled?: boolean
  isSelected?: boolean
  isMenu?: boolean
  fixedToBottom?: boolean
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

export function firstQuickPanelSelectableIndex(items: readonly { disabled?: boolean }[]) {
  return items.findIndex((item) => !item.disabled)
}

function selectableIndexes(items: readonly { disabled?: boolean }[]) {
  return items.flatMap((item, index) => (item.disabled ? [] : [index]))
}

export function moveQuickPanelSelectableIndex(
  items: readonly { disabled?: boolean }[],
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
    // Wrap with a full modulo so a multi-page negative offset (e.g. Cmd/Ctrl+ArrowUp with
    // fewer selectable items than the page size) still lands on a valid index, not `undefined`.
    return indexes[((nextPosition % indexes.length) + indexes.length) % indexes.length]
  }

  return indexes[Math.min(Math.max(nextPosition, 0), indexes.length - 1)]
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
        <span className="inline-flex items-center gap-1">
          <Kbd className={QUICK_PANEL_KBD_CLASS}>Esc</Kbd>
          <span>{t('settings.quickPanel.close')}</span>
        </span>

        <span className="inline-flex items-center gap-1">
          <Kbd className={QUICK_PANEL_KBD_CLASS}>▲▼</Kbd>
          <span>{t('settings.quickPanel.select')}</span>
        </span>

        {assistiveKey && showPageHint ? (
          <span className="inline-flex items-center gap-1">
            <Kbd className={cn(QUICK_PANEL_KBD_CLASS, assistiveKeyActive && 'text-foreground!')}>{assistiveKey}</Kbd>
            <span>+</span>
            <Kbd className={QUICK_PANEL_KBD_CLASS}>▲▼</Kbd>
            <span>{t('settings.quickPanel.page')}</span>
          </span>
        ) : null}

        <span className="inline-flex items-center gap-1">
          <Kbd className={QUICK_PANEL_KBD_CLASS}>Tab/↩︎</Kbd>
          <span>{confirmLabel ?? t('settings.quickPanel.confirm')}</span>
        </span>
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
  // Read-only panels stay non-interactive, except pinned footer actions (e.g. "open config"), which
  // remain clickable so a status panel can still expose its one affordance.
  const isReadOnlyLocked = readOnly && !item.fixedToBottom
  const [tooltipOpen, setTooltipOpen] = useState(false)
  const suffixContent = item.suffix ? (
    item.suffix
  ) : selected ? (
    <Check />
  ) : item.isMenu && !item.disabled && !readOnly ? (
    <ChevronRight size={14} />
  ) : null
  const hasInlineDescription = item.inlineDescription === true && !!item.description
  const primaryContent = (
    <>
      {reserveIconSlot || item.icon ? (
        <span className="flex shrink-0 items-center justify-center text-[13px] text-muted-foreground [&>svg:not([class*='text-'])]:text-muted-foreground [&>svg]:size-[1em]">
          {item.icon}
        </span>
      ) : null}
      <span className={cn('min-w-0 truncate text-[13px] leading-4', !hasInlineDescription && 'flex-1')}>
        {item.label}
      </span>
    </>
  )
  const canHover = hoverEnabled && !isReadOnlyLocked && !item.disabled
  const isUnavailable = isReadOnlyLocked || item.disabled
  const tooltipAnchor =
    item.tooltip && item.tooltipAnchor ? (
      <NormalTooltip
        content={item.tooltip}
        side="top"
        sideOffset={6}
        open={active || tooltipOpen}
        onOpenChange={setTooltipOpen}>
        <span className="inline-flex shrink-0">{item.tooltipAnchor}</span>
      </NormalTooltip>
    ) : (
      item.tooltipAnchor
    )

  return (
    <div
      ref={rowRef}
      style={{ height: QUICK_PANEL_ROW_HEIGHT }}
      role="button"
      aria-current={active ? 'true' : undefined}
      aria-disabled={isUnavailable}
      aria-pressed={!isReadOnlyLocked && item.isSelected !== undefined ? selected : undefined}
      tabIndex={isUnavailable ? -1 : 0}
      className={cn(
        'mx-[5px] mb-px flex items-center justify-between gap-3 rounded-md px-2 py-1 transition-colors duration-100',
        isReadOnlyLocked ? 'cursor-default' : item.disabled ? 'cursor-not-allowed opacity-40' : 'cursor-pointer',
        !isReadOnlyLocked && selected && 'bg-muted',
        !isReadOnlyLocked && selected && active && 'bg-accent',
        !isReadOnlyLocked && !selected && active && 'bg-accent',
        canHover && 'hover:bg-accent',
        className
      )}
      data-active={active}
      data-id={dataId}
      data-selected={selected ? '' : undefined}
      onClick={(event) => {
        event.stopPropagation()
        if (isUnavailable) return
        onSelect()
      }}
      onKeyDown={(event) => {
        if (isUnavailable || !['Enter', ' '].includes(event.key)) return
        event.preventDefault()
        event.stopPropagation()
        onSelect()
      }}>
      {hasInlineDescription ? (
        <div className="flex min-w-0 flex-1 items-center gap-1.5">
          <div className="flex min-w-0 max-w-full shrink-0 items-center gap-1.5">{primaryContent}</div>
          <span className="min-w-0 flex-1 truncate text-[12px] text-muted-foreground leading-4">
            {item.description}
          </span>
        </div>
      ) : (
        <div className={cn('flex min-w-0 flex-1 items-center gap-1.5', contentClassName)}>{primaryContent}</div>
      )}
      {!hasInlineDescription || tooltipAnchor || suffixContent ? (
        <div
          className={cn(
            'flex items-center justify-end gap-1 text-[12px] text-muted-foreground leading-4',
            hasInlineDescription ? 'shrink-0' : 'min-w-[20%]'
          )}>
          {!hasInlineDescription && item.description ? (
            <span className="overflow-hidden text-ellipsis whitespace-nowrap">{item.description}</span>
          ) : null}
          {tooltipAnchor}
          {suffixContent ? (
            <span className="flex min-w-3 shrink-0 items-center justify-end gap-[3px] [&>svg]:size-[1em] [&>svg]:text-muted-foreground">
              {suffixContent}
            </span>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
