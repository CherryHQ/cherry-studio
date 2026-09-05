import { Button, Kbd, NormalTooltip } from '@cherrystudio/ui'
import { cn } from '@cherrystudio/ui/lib/utils'
import { t } from 'i18next'
import { Check, ChevronRight } from 'lucide-react'
import { type ReactElement, type ReactNode, type Ref, useState } from 'react'

import { QUICK_PANEL_ROW_HEIGHT } from './heights'
import type { QuickPanelFooterAction } from './types'

const QUICK_PANEL_KBD_CLASS =
  'min-w-0 rounded-sm bg-muted! px-1 py-0.5 font-normal text-[11px] text-muted-foreground! leading-none'

export interface QuickPanelRowData {
  id?: string
  label: ReactNode | string
  description?: ReactNode | string
  tooltip?: ReactNode | string
  /** In-row element used as the controlled Tooltip trigger. */
  tooltipAnchor?: ReactElement
  icon?: ReactNode | string
  suffix?: ReactNode | string
  disabled?: boolean
  isSelected?: boolean
  isMenu?: boolean
}

interface QuickPanelFooterProps {
  actions?: QuickPanelFooterAction[]
  activeActionId?: string
  title?: ReactNode
  showPageHint?: boolean
  assistiveKey?: string
  assistiveKeyActive?: boolean
  confirmLabel?: ReactNode
  compact?: boolean
  className?: string
  containerRef?: Ref<HTMLDivElement>
  onAction?: (action: QuickPanelFooterAction) => void
  onActionFocus?: (action: QuickPanelFooterAction) => void
}

interface QuickPanelReadOnlyHeaderProps {
  containerRef?: Ref<HTMLDivElement>
  title?: ReactNode
  onClose: () => void
}

interface QuickPanelFooterHintProps {
  children: ReactNode
  compact: boolean
  label: ReactNode
  testId: string
}

interface QuickPanelRowProps<T extends QuickPanelRowData> {
  active: boolean
  className?: string
  dataId?: string
  /** The cursor reached this row through keyboard navigation, so the anchored tooltip mirrors hover. */
  keyboardActive?: boolean
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

export function initialQuickPanelFocusIndex(items: readonly { disabled?: boolean }[], preferredIndex: number) {
  const preferred = items[preferredIndex]
  if (preferredIndex >= 0 && preferred && !preferred.disabled) {
    return preferredIndex
  }

  return firstQuickPanelSelectableIndex(items)
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

function QuickPanelFooterHint({ children, compact, label, testId }: QuickPanelFooterHintProps) {
  const hint = (
    <span
      aria-label={compact && typeof label === 'string' ? label : undefined}
      className="inline-flex items-center gap-1"
      data-testid={testId}>
      {children}
    </span>
  )

  return compact ? (
    <NormalTooltip content={label} side="top" sideOffset={6}>
      {hint}
    </NormalTooltip>
  ) : (
    hint
  )
}

export function QuickPanelFooter({
  actions = [],
  activeActionId,
  assistiveKey,
  assistiveKeyActive = false,
  className,
  compact = false,
  confirmLabel,
  containerRef,
  onAction,
  onActionFocus,
  showPageHint = false,
  title
}: QuickPanelFooterProps) {
  return (
    <div
      ref={containerRef}
      data-testid="quick-panel-footer"
      className={cn('flex w-full items-center gap-2 px-3 pt-2 pb-[5px]', className)}>
      <div className="flex min-w-0 items-center gap-2">
        <div className="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-[12px] text-muted-foreground">
          {title || ''}
        </div>
        <div
          className="flex shrink-0 flex-nowrap items-center justify-start gap-1"
          data-testid="quick-panel-footer-actions">
          {actions.map((action) => (
            <NormalTooltip key={action.id} content={action.tooltip ?? action.ariaLabel} side="top" sideOffset={6}>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                aria-label={action.ariaLabel}
                aria-current={activeActionId === action.id ? 'true' : undefined}
                disabled={action.disabled}
                className={cn(
                  'h-6 max-w-full shrink-0 gap-1 text-[12px] text-muted-foreground',
                  compact ? 'px-1' : 'px-1.5',
                  activeActionId === action.id && 'bg-accent text-accent-foreground'
                )}
                onFocus={() => onActionFocus?.(action)}
                onClick={(event) => {
                  event.stopPropagation()
                  onAction?.(action)
                }}>
                {action.icon ? <span className="shrink-0 [&>svg]:size-3.5">{action.icon}</span> : null}
                <span className={cn('truncate', compact && 'sr-only')}>{action.label}</span>
              </Button>
            </NormalTooltip>
          ))}
        </div>
      </div>
      <div
        className={cn(
          'ml-auto flex shrink-0 items-center justify-end text-[12px] text-muted-foreground',
          compact ? 'gap-1' : 'gap-4'
        )}>
        <QuickPanelFooterHint compact={compact} label={t('settings.quickPanel.close')} testId="quick-panel-hint-close">
          <Kbd className={QUICK_PANEL_KBD_CLASS}>Esc</Kbd>
          {!compact ? <span>{t('settings.quickPanel.close')}</span> : null}
        </QuickPanelFooterHint>

        <QuickPanelFooterHint
          compact={compact}
          label={t('settings.quickPanel.select')}
          testId="quick-panel-hint-select">
          <Kbd className={QUICK_PANEL_KBD_CLASS}>▲▼</Kbd>
          {!compact ? <span>{t('settings.quickPanel.select')}</span> : null}
        </QuickPanelFooterHint>

        {assistiveKey && showPageHint ? (
          <QuickPanelFooterHint compact={compact} label={t('settings.quickPanel.page')} testId="quick-panel-hint-page">
            <Kbd className={cn(QUICK_PANEL_KBD_CLASS, assistiveKeyActive && 'text-foreground!')}>{assistiveKey}</Kbd>
            <span>+</span>
            <Kbd className={QUICK_PANEL_KBD_CLASS}>▲▼</Kbd>
            {!compact ? <span>{t('settings.quickPanel.page')}</span> : null}
          </QuickPanelFooterHint>
        ) : null}

        <QuickPanelFooterHint
          compact={compact}
          label={confirmLabel ?? t('settings.quickPanel.confirm')}
          testId="quick-panel-hint-confirm">
          <Kbd className={QUICK_PANEL_KBD_CLASS}>Tab/↩︎</Kbd>
          {!compact ? <span>{confirmLabel ?? t('settings.quickPanel.confirm')}</span> : null}
        </QuickPanelFooterHint>
      </div>
    </div>
  )
}

export function QuickPanelReadOnlyHeader({ containerRef, onClose, title }: QuickPanelReadOnlyHeaderProps) {
  return (
    <div ref={containerRef} className="flex w-full items-center justify-between gap-4 px-3 pt-2 pb-[7px]">
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
  dataId,
  keyboardActive = false,
  hoverEnabled = true,
  item,
  onSelect,
  reserveIconSlot = false,
  readOnly = false,
  rowRef,
  selected = false
}: QuickPanelRowProps<T>) {
  const isReadOnlyLocked = readOnly
  const [tooltipOpen, setTooltipOpen] = useState(false)
  const suffixContent = item.suffix ? (
    item.suffix
  ) : selected ? (
    <Check />
  ) : item.isMenu && !item.disabled && !readOnly ? (
    <ChevronRight size={14} />
  ) : null
  const hasDescription = Boolean(item.description)
  const canHover = hoverEnabled && !isReadOnlyLocked && !item.disabled
  const isUnavailable = isReadOnlyLocked || item.disabled
  const tooltipAnchor =
    item.tooltip && item.tooltipAnchor ? (
      <NormalTooltip
        content={item.tooltip}
        side="top"
        sideOffset={6}
        open={(active && keyboardActive) || tooltipOpen}
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
        // Selection is marked by the check suffix alone: bg-accent and bg-muted share the same
        // token value, so a selected tint would read as a second keyboard cursor on the row.
        !isReadOnlyLocked && active && 'bg-accent',
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
      <div className={cn('flex min-w-0 items-center gap-1.5', hasDescription ? 'max-w-[40%] shrink-0' : 'flex-1')}>
        {reserveIconSlot || item.icon ? (
          <span className="flex shrink-0 items-center justify-center text-[13px] text-muted-foreground [&>svg:not([class*='text-'])]:text-muted-foreground [&>svg]:size-[1em]">
            {item.icon}
          </span>
        ) : null}
        <span className="min-w-0 flex-1 truncate text-[13px] leading-4">{item.label}</span>
      </div>
      <div
        className={cn(
          'flex min-w-0 items-center justify-end gap-1 text-[12px] text-muted-foreground leading-4',
          hasDescription ? 'flex-1' : 'shrink-0'
        )}>
        {hasDescription ? <span className="min-w-0 flex-1 truncate text-right">{item.description}</span> : null}
        {tooltipAnchor}
        {suffixContent ? (
          <span className="flex min-w-3 max-w-full shrink-0 items-center justify-end gap-[3px] truncate [&>svg]:size-[1em] [&>svg]:text-muted-foreground">
            {suffixContent}
          </span>
        ) : null}
      </div>
    </div>
  )
}
