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
  // carries the same warning tone as its label.
  return <Icon size={size} className={mode === 'bypassPermissions' ? 'text-warning' : 'text-muted-foreground'} />
}

/**
 * Title + optional description for one mode. `caution` modes are rendered in the
 * warning tone: this is a standing risk label on a state, not a destructive action
 * trigger, so it uses `--warning` rather than `--destructive` (DESIGN.md).
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
    <div className="flex flex-col gap-0.5">
      <span className={cn('text-sm', card.caution && 'text-warning')}>{t(card.titleKey, card.titleFallback)}</span>
      {withDescription && (
        <span className={cn('text-xs', card.caution ? 'text-warning/80' : 'text-muted-foreground')}>
          {t(card.descriptionKey, card.descriptionFallback)}
        </span>
      )}
    </div>
  )
}
