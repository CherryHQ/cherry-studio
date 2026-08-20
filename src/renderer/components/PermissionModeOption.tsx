import { FormControl, Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@cherrystudio/ui'
import { cn } from '@cherrystudio/ui/lib/utils'
import type { PermissionMode, PermissionModeCard } from '@renderer/types/agent'
import type { TFunction } from 'i18next'
import { FolderPen, Hand, Route, ShieldAlert, ShieldCheck } from 'lucide-react'
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
  // Icons stay neutral except for the one mode that runs without asking, which
  // carries the same destructive tone as its label.
  return <Icon size={size} className={mode === 'bypassPermissions' ? 'text-destructive' : 'text-muted-foreground'} />
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
    <Select value={value} onValueChange={(next) => onValueChange(next as PermissionMode)}>
      <FormControl>
        <SelectTrigger className="h-9 w-full rounded-md" aria-label={ariaLabel}>
          <SelectValue>
            {selectedCard ? (
              <span className={selectedCard.dangerous ? 'text-destructive' : undefined}>
                {t(selectedCard.titleKey, selectedCard.titleFallback)}
              </span>
            ) : null}
          </SelectValue>
        </SelectTrigger>
      </FormControl>
      <SelectContent portalContainer={portalContainer}>
        {cards.map((card) => (
          <SelectItem key={card.mode} value={card.mode}>
            <div className="flex items-center gap-2">
              <PermissionModeIcon mode={card.mode} size={16} />
              <PermissionModeOptionLabel card={card} t={t} />
            </div>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

/**
 * Title + optional description for one mode. `dangerous` modes render in `--destructive`:
 * picking one hands the agent unattended file deletion and network access, so it needs
 * to read as dangerous at a glance rather than merely noteworthy.
 *
 * A mode's `warningKey` renders on its own line regardless of `withDescription`, since the
 * warning is what the user needs before choosing the mode. Containers that can only render
 * a single line (the composer quick panel row is a fixed 30px) pass `withWarning={false}`
 * and place the caveat themselves.
 */
export function PermissionModeOptionLabel({
  card,
  t,
  withDescription = true,
  withWarning = true
}: {
  card: PermissionModeCard
  t: TFunction
  withDescription?: boolean
  withWarning?: boolean
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className={cn('text-sm', card.dangerous && 'text-destructive')}>
        {t(card.titleKey, card.titleFallback)}
      </span>
      {withDescription && (
        <span className={cn('text-xs', card.dangerous ? 'text-destructive' : 'text-muted-foreground')}>
          {t(card.descriptionKey, card.descriptionFallback)}
        </span>
      )}
      {withWarning && card.warningKey && (
        <span className={cn('text-xs', card.dangerous ? 'text-destructive' : 'text-warning')}>
          {t(card.warningKey, card.warningFallback ?? '')}
        </span>
      )}
    </div>
  )
}
