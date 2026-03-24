import { cn } from '@cherrystudio/ui/lib/utils'
import type { MigrationStage } from '@shared/data/migration/v2/types'
import { Check } from 'lucide-react'
import { useTranslation } from 'react-i18next'

type Props = {
  stage: MigrationStage
}

const steps = [
  { id: 'overview', labelKey: 'migration.flow.overview.label' },
  { id: 'backup', labelKey: 'migration.flow.backup.label' },
  { id: 'migrate', labelKey: 'migration.flow.migrate.label' },
  { id: 'finish', labelKey: 'migration.flow.finish.label' }
] as const

function getCurrentStepIndex(stage: MigrationStage): number {
  switch (stage) {
    case 'introduction':
      return 0
    case 'backup_required':
    case 'backup_in_progress':
    case 'backup_ready':
      return 1
    case 'preparing_migration':
    case 'migration_in_progress':
    case 'failed':
      return 2
    case 'migration_succeeded':
    case 'restart_required':
      return 3
    default:
      return 0
  }
}

export function StageIndicator({ stage }: Props) {
  const { t } = useTranslation()
  const currentIndex = getCurrentStepIndex(stage)
  const isFinished = stage === 'restart_required'

  return (
    <ol className="flex items-center justify-center gap-3">
      {steps.map((step, index) => {
        const isCompleted = index < currentIndex || (isFinished && index === currentIndex)
        const isCurrent = !isFinished && index === currentIndex
        const isActiveConnector = index < currentIndex

        return (
          <li key={step.id} className="flex items-center gap-3">
            <div className="flex items-center gap-2">
              <span
                className={cn(
                  'flex size-7 items-center justify-center rounded-full border font-medium text-xs transition-colors duration-300',
                  isCompleted && 'border-primary bg-primary text-primary-foreground',
                  isCurrent && 'border-primary bg-primary/8 text-primary',
                  !isCompleted && !isCurrent && 'border-black/14 text-muted-foreground'
                )}>
                {isCompleted ? <Check className="lucide-custom size-3.5" /> : index + 1}
              </span>
              <span
                className={cn(
                  'hidden font-medium text-sm transition-colors duration-300 sm:block',
                  isCurrent && 'text-primary',
                  isCompleted && 'text-foreground/80',
                  !isCompleted && !isCurrent && 'text-muted-foreground'
                )}>
                {t(step.labelKey)}
              </span>
            </div>
            {index < steps.length - 1 ? (
              <span
                className={cn(
                  'hidden h-px w-6 transition-colors duration-300 sm:block',
                  isActiveConnector && 'bg-primary/40',
                  !isActiveConnector && 'bg-black/10'
                )}
              />
            ) : null}
          </li>
        )
      })}
    </ol>
  )
}
