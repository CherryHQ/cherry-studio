import {
  FormControl,
  NormalTooltip,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@cherrystudio/ui'
import { cn } from '@cherrystudio/ui/lib/utils'
import type { PermissionMode, PermissionModeCard } from '@renderer/types/agent'
import type { TFunction } from 'i18next'
import { CircleAlert, FolderPen, Hand, Route, ShieldAlert, ShieldCheck } from 'lucide-react'
import type { ReactNode } from 'react'

/**
 * Shared presentation for the agent permission modes.
 *
 * Every surface that offers the modes (composer switcher, agent editor, channel
 * override) renders them from here so a mode always looks the same and the risky
 * one is always marked as such.
 */

const PERMISSION_MODE_ICONS: Record<PermissionMode, typeof Hand> = {
  default: Hand,
  plan: Route,
  acceptEdits: FolderPen,
  auto: ShieldCheck,
  bypassPermissions: ShieldAlert
}

export function PermissionModeIcon({ mode, size = 18 }: { mode: PermissionMode; size?: number }): ReactNode {
  const Icon = PERMISSION_MODE_ICONS[mode] ?? Hand
  return (
    <Icon
      size={size}
      className={mode === 'bypassPermissions' ? 'lucide-custom text-destructive' : 'text-muted-foreground'}
    />
  )
}

function getPermissionModeWarning(card: PermissionModeCard, t: TFunction) {
  return card.warningKey ? t(card.warningKey, card.warningFallback ?? '') : ''
}

function PermissionModeWarningIndicator({ dangerous }: { dangerous?: boolean }) {
  return (
    <CircleAlert aria-hidden className={cn('size-3.5 shrink-0', dangerous ? 'text-destructive' : 'text-warning')} />
  )
}

export function PermissionModeWarning({
  card,
  portalContainer,
  showTooltip = true,
  t
}: {
  card: PermissionModeCard
  portalContainer?: HTMLElement | null
  showTooltip?: boolean
  t: TFunction
}) {
  const warning = getPermissionModeWarning(card, t)
  if (!warning) return null

  const trigger = (
    <span
      aria-label={warning}
      className={cn(
        'inline-flex size-5 shrink-0 items-center justify-center rounded-sm',
        card.dangerous ? 'text-destructive' : 'text-warning'
      )}>
      <PermissionModeWarningIndicator dangerous={card.dangerous} />
    </span>
  )

  return showTooltip ? (
    <NormalTooltip
      content={warning}
      side="top"
      sideOffset={6}
      contentProps={{ portalContainer: portalContainer ?? undefined }}>
      {trigger}
    </NormalTooltip>
  ) : (
    trigger
  )
}

export function PermissionModeSelectItem({
  card,
  compact = false,
  portalContainer,
  t
}: {
  card: PermissionModeCard
  compact?: boolean
  portalContainer?: HTMLElement | null
  t: TFunction
}) {
  const warning = getPermissionModeWarning(card, t)
  const option = (
    <SelectItem
      value={card.mode}
      className={cn(
        'py-2 data-[state=checked]:bg-accent! data-[state=checked]:text-accent-foreground! [&_.lucide-check]:text-muted-foreground!',
        warning && 'pr-14 [&>span:first-child]:right-8!'
      )}>
      <div className="flex w-full min-w-0 items-center gap-2">
        <span className={cn('flex shrink-0 items-center justify-center', !compact && 'mx-1')}>
          <PermissionModeIcon mode={card.mode} size={compact ? 14 : 16} />
        </span>
        <PermissionModeOptionLabel card={card} t={t} withDescription={!compact} />
        {warning ? (
          <span className="absolute right-2 flex size-5 shrink-0 items-center justify-center">
            <PermissionModeWarningIndicator dangerous={card.dangerous} />
          </span>
        ) : null}
      </div>
    </SelectItem>
  )

  return warning ? (
    <NormalTooltip
      content={warning}
      side="right"
      sideOffset={8}
      contentProps={{ portalContainer: portalContainer ?? undefined }}>
      {option}
    </NormalTooltip>
  ) : (
    option
  )
}

export function PermissionModeSelect({
  cards,
  value,
  onValueChange,
  portalContainer,
  ariaLabel,
  t
}: {
  cards: PermissionModeCard[]
  value: PermissionMode
  onValueChange: (value: PermissionMode) => void
  portalContainer: HTMLElement | null
  ariaLabel: string
  t: TFunction
}) {
  const selectedCard = cards.find((card) => card.mode === value)

  return (
    <Select
      value={value}
      onValueChange={(next) => {
        // Radix's hidden native select can briefly emit an empty value while its dynamic options change.
        if (next) onValueChange(next as PermissionMode)
      }}>
      <FormControl>
        <SelectTrigger className="h-9 w-full rounded-md" aria-label={ariaLabel}>
          <SelectValue>
            {selectedCard ? (
              <span className={cn('flex min-w-0 items-center gap-2', selectedCard.dangerous && 'text-destructive')}>
                <PermissionModeIcon mode={selectedCard.mode} size={16} />
                <span className="truncate">{t(selectedCard.titleKey, selectedCard.titleFallback)}</span>
              </span>
            ) : null}
          </SelectValue>
        </SelectTrigger>
      </FormControl>
      <SelectContent portalContainer={portalContainer} className="min-w-[360px]">
        {cards.map((card) => (
          <PermissionModeSelectItem key={card.mode} card={card} portalContainer={portalContainer} t={t} />
        ))}
      </SelectContent>
    </Select>
  )
}

/**
 * Title + optional description for one mode. Warning copy belongs to the owning
 * interactive surface so it can be exposed without expanding every row.
 */
export function PermissionModeOptionLabel({
  card,
  t,
  withDescription = true
}: {
  card: PermissionModeCard
  t: TFunction
  withDescription?: boolean
}) {
  return (
    <div className="flex min-w-0 flex-1 flex-col gap-0.5">
      <span
        className={cn(
          'truncate text-foreground',
          withDescription ? 'font-medium text-sm' : 'font-normal text-[13px] leading-4',
          card.dangerous && 'text-destructive'
        )}>
        {t(card.titleKey, card.titleFallback)}
      </span>
      {withDescription ? (
        <span
          className={cn('truncate text-xs leading-4', card.dangerous ? 'text-destructive' : 'text-muted-foreground')}>
          {t(card.descriptionKey, card.descriptionFallback)}
        </span>
      ) : null}
    </div>
  )
}
