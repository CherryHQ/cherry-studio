import { Button } from '@cherrystudio/ui'
import type { MigratorProgress } from '@shared/data/migration/v2/types'
import { useTranslation } from 'react-i18next'

import { MigratorProgressList, SectionLabel, StepPage } from '../components'
import { MigrationScreenLayout } from './MigrationScreenLayout'

type Props = {
  operationMessage: string
  progressValue: number
  completedCount: number
  totalCount: number
  migrators: MigratorProgress[]
}

function ProgressBar({ value }: { value: number }) {
  return (
    <div className="mt-4 h-2 w-full overflow-hidden rounded-full bg-primary/12">
      <div
        className="h-full rounded-full bg-primary transition-[width] duration-500 ease-out"
        style={{ width: `${Math.max(0, Math.min(100, value))}%` }}
      />
    </div>
  )
}

export function MigrationScreen({ operationMessage, progressValue, completedCount, totalCount, migrators }: Props) {
  const { t } = useTranslation()

  return (
    <MigrationScreenLayout
      currentStep={3}
      footerMessage={operationMessage}
      primaryAction={
        <Button className="min-h-10 rounded-md px-4 shadow-none" disabled loading>
          {t('migration.buttons.migrating')}
        </Button>
      }>
      <StepPage title={t('migration.migration_run.title')} description={t('migration.migration_run.description')}>
        <section className="space-y-4">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
            <div className="min-w-0">
              <SectionLabel>{t('migration.migration_run.summary.current_operation')}</SectionLabel>
              <div key={operationMessage} className="fade-in slide-in-from-bottom-2 mt-3 animate-in duration-300">
                <p className="text-foreground text-lg leading-8">{operationMessage}</p>
              </div>
            </div>
            <div className="shrink-0">
              <p className="font-semibold text-4xl text-primary tabular-nums tracking-tight">
                {Math.round(progressValue)}
                <span className="ml-1 text-primary/70 text-xl">%</span>
              </p>
              <p className="mt-1 text-muted-foreground text-sm">
                {t('migration.migration_run.summary.modules_count', {
                  completed: completedCount,
                  total: totalCount
                })}
              </p>
            </div>
          </div>
          <ProgressBar value={progressValue} />
        </section>
        <section className="space-y-3">
          <div className="flex items-center justify-between gap-4">
            <SectionLabel>{t('migration.migration_run.checklist_title')}</SectionLabel>
            <p className="text-muted-foreground text-sm">
              {completedCount}/{totalCount}
            </p>
          </div>
          <MigratorProgressList migrators={migrators} />
        </section>
      </StepPage>
    </MigrationScreenLayout>
  )
}
