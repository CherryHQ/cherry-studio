/**
 * Migrator progress list component
 * Shows the status of each migrator
 */

import { cn } from '@cherrystudio/ui/lib/utils'
import type { MigratorProgress as MigratorProgressType, MigratorStatus } from '@shared/data/migration/v2/types'
import { Check, Loader2, XCircle } from 'lucide-react'
import React from 'react'
import { useTranslation } from 'react-i18next'

interface Props {
  migrators: MigratorProgressType[]
}

const ICON_WRAP = 'flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-lg'

const StatusIcon: React.FC<{ status: MigratorStatus }> = ({ status }) => {
  switch (status) {
    case 'completed':
      return (
        <span className={cn(ICON_WRAP, 'bg-success-bg text-success')}>
          <Check size={12} strokeWidth={3} className="lucide-custom text-success" />
        </span>
      )
    case 'running':
      return (
        <span className={cn(ICON_WRAP, 'bg-primary-mute text-primary')}>
          <Loader2 size={12} className="animate-spin" />
        </span>
      )
    case 'failed':
      return (
        <span className={cn(ICON_WRAP, 'bg-error-bg text-error-text')}>
          <XCircle size={12} />
        </span>
      )
    default:
      return <span className={cn(ICON_WRAP, 'bg-muted/40 text-foreground-muted')} />
  }
}

const statusTextClass = (status: MigratorStatus): string => {
  switch (status) {
    case 'failed':
      return 'text-destructive'
    case 'completed':
      return 'text-success'
    case 'running':
      return 'text-primary'
    default:
      return 'text-foreground-muted'
  }
}

const STATUS_KEY: Record<MigratorStatus, string> = {
  pending: 'migration.status.pending',
  running: 'migration.status.running',
  completed: 'migration.status.completed',
  failed: 'migration.status.failed'
}

export const MigratorProgressList: React.FC<Props> = ({ migrators }) => {
  const { t } = useTranslation()

  return (
    <div className="divide-y divide-border overflow-hidden rounded-xl border border-border">
      {migrators.map((migrator) => (
        <div key={migrator.id} className="flex items-center gap-3 px-3.5 py-2.5">
          <StatusIcon status={migrator.status} />
          <span
            className={cn(
              'flex-1 truncate text-sm',
              migrator.status === 'pending' ? 'text-foreground-muted' : 'text-foreground'
            )}>
            {migrator.name}
          </span>
          <span className={cn('shrink-0 text-xs', statusTextClass(migrator.status))}>
            {migrator.error || t(STATUS_KEY[migrator.status])}
          </span>
        </div>
      ))}
    </div>
  )
}
