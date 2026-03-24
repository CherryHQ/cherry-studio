import { Button } from '@cherrystudio/ui'
import type { MigratorProgress } from '@shared/data/migration/v2/types'
import { ArrowRight, CheckCircle2, RefreshCw } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { MigratorProgressList, SectionLabel, StepPage } from '../components'
import { MigrationScreenLayout } from './MigrationScreenLayout'

type CompletionScreenStage = 'migration_succeeded' | 'restart_required'

type Props = {
  stage: CompletionScreenStage
  operationMessage: string
  totalCount: number
  migrators: MigratorProgress[]
  onConfirm: () => void | Promise<unknown>
  onRestart: () => void | Promise<unknown>
}

function ProgressBar() {
  return (
    <div className="mt-4 h-2 w-full overflow-hidden rounded-full bg-primary/12">
      <div
        className="h-full rounded-full bg-primary transition-[width] duration-500 ease-out"
        style={{ width: '100%' }}
      />
    </div>
  )
}

export function CompletionScreen({ stage, operationMessage, totalCount, migrators, onConfirm, onRestart }: Props) {
  const { t } = useTranslation()

  switch (stage) {
    case 'migration_succeeded':
      return (
        <MigrationScreenLayout
          currentStep={4}
          footerMessage={t('migration.footer.migration_succeeded')}
          primaryAction={
            <Button className="min-h-10 rounded-md px-4 shadow-none" onClick={onConfirm}>
              {t('migration.buttons.confirm')}
              <ArrowRight className="lucide-custom size-4" />
            </Button>
          }>
          <StepPage
            title={t('migration.migration_succeeded.title')}
            description={t('migration.migration_succeeded.description')}>
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
                    100
                    <span className="ml-1 text-primary/70 text-xl">%</span>
                  </p>
                  <p className="mt-1 text-muted-foreground text-sm">
                    {t('migration.migration_run.summary.modules_count', {
                      completed: totalCount,
                      total: totalCount
                    })}
                  </p>
                </div>
              </div>
              <ProgressBar />
            </section>
            <section className="space-y-3">
              <div className="flex items-center justify-between gap-4">
                <SectionLabel>{t('migration.migration_run.checklist_title')}</SectionLabel>
                <p className="text-muted-foreground text-sm">
                  {totalCount}/{totalCount}
                </p>
              </div>
              <MigratorProgressList migrators={migrators} />
            </section>
          </StepPage>
        </MigrationScreenLayout>
      )

    case 'restart_required':
    default:
      return (
        <MigrationScreenLayout
          currentStep={4}
          footerMessage={t('migration.footer.restart_required')}
          primaryAction={
            <Button className="min-h-10 rounded-md px-4 shadow-none" onClick={onRestart}>
              {t('migration.buttons.restart')}
              <RefreshCw className="lucide-custom size-4" />
            </Button>
          }>
          <StepPage
            align="center"
            title={t('migration.restart_required.title')}
            description={t('migration.restart_required.description')}
            leading={
              <div className="zoom-in-95 flex size-16 animate-in items-center justify-center rounded-full border border-primary/25 bg-primary/10 duration-300">
                <CheckCircle2 className="lucide-custom size-8 text-primary" />
              </div>
            }>
            {null}
          </StepPage>
        </MigrationScreenLayout>
      )
  }
}
