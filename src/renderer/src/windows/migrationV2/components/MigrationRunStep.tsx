import type { MigratorProgress as MigratorProgressType } from '@shared/data/migration/v2/types'
import React from 'react'
import { useTranslation } from 'react-i18next'

import { MigratorProgressList } from './MigratorProgress'
import { SectionLabel, StepPage } from './StepPage'

interface Props {
  complete: boolean
  operationMessage: string
  progressValue: number
  completedCount: number
  totalCount: number
  migrators: MigratorProgressType[]
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

export const MigrationRunStep: React.FC<Props> = ({
  complete,
  operationMessage,
  progressValue,
  completedCount,
  totalCount,
  migrators
}) => {
  const { t } = useTranslation()

  return (
    <StepPage
      title={complete ? t('migration.migration_completed.title') : t('migration.migration_run.title')}
      description={
        complete ? t('migration.migration_completed.description') : t('migration.migration_run.description')
      }>
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
              {complete ? '100' : Math.round(progressValue)}
              <span className="ml-1 text-primary/70 text-xl">%</span>
            </p>
            <p className="mt-1 text-muted-foreground text-sm">
              {t('migration.migration_run.summary.modules_count', {
                completed: complete ? totalCount : completedCount,
                total: totalCount
              })}
            </p>
          </div>
        </div>
        <ProgressBar value={complete ? 100 : progressValue} />
      </section>
      <section className="space-y-3">
        <div className="flex items-center justify-between gap-4">
          <SectionLabel>{t('migration.migration_run.checklist_title')}</SectionLabel>
          <p className="text-muted-foreground text-sm">
            {complete ? totalCount : completedCount}/{totalCount}
          </p>
        </div>
        <MigratorProgressList migrators={migrators} />
      </section>
    </StepPage>
  )
}
