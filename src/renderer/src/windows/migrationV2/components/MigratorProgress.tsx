import { cn } from '@cherrystudio/ui/lib/utils'
import type { MigratorProgress as MigratorProgressType, MigratorStatus } from '@shared/data/migration/v2/types'
import { Check } from 'lucide-react'
import React from 'react'
import { useTranslation } from 'react-i18next'

interface Props {
  migrators: MigratorProgressType[]
}

const statusTextKey = {
  pending: 'migration.status.pending',
  running: 'migration.status.running',
  completed: 'migration.status.completed',
  failed: 'migration.status.failed'
} satisfies Record<MigratorStatus, string>

function StatusSummary({ status, text }: { status: MigratorStatus; text: string }) {
  if (status === 'completed') {
    return (
      <span className="inline-flex items-center justify-end text-primary" aria-label={text} title={text}>
        <Check className="lucide-custom size-4" />
        <span className="sr-only">{text}</span>
      </span>
    )
  }

  return <span>{text}</span>
}

export const MigratorProgressList: React.FC<Props> = ({ migrators }) => {
  const { t } = useTranslation()

  if (migrators.length === 0) {
    return <p className="py-6 text-muted-foreground text-sm">{t('migration.migration_run.empty')}</p>
  }

  return (
    <div className="space-y-2">
      {migrators.map((migrator, index) => {
        const statusText = t(statusTextKey[migrator.status])

        return (
          <div
            key={migrator.id}
            className={cn(
              'grid gap-3 py-3 transition-all duration-300 md:grid-cols-[minmax(0,1fr)_auto] md:items-center',
              migrator.status === 'running' && 'translate-x-1',
              migrator.status === 'pending' && 'opacity-65'
            )}>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-muted-foreground text-xs uppercase tracking-[0.16em]">
                  {String(index + 1).padStart(2, '0')}
                </span>
                <p className="truncate font-medium text-foreground text-sm">{migrator.name}</p>
              </div>
              {migrator.error ? <p className="mt-1 text-red-700 text-sm leading-6">{migrator.error}</p> : null}
            </div>
            <p
              className={cn(
                'flex items-center justify-start text-sm transition-colors duration-300 md:justify-end',
                migrator.status === 'running' && 'text-primary',
                migrator.status === 'completed' && 'text-primary/80',
                migrator.status === 'failed' && 'text-red-700',
                migrator.status === 'pending' && 'text-muted-foreground'
              )}>
              <StatusSummary status={migrator.status} text={statusText} />
            </p>
          </div>
        )
      })}
    </div>
  )
}
