import { Badge, RadioGroup, RadioGroupItem } from '@cherrystudio/ui'
import { cn } from '@cherrystudio/ui/lib/utils'
import type { MigrationStage } from '@shared/data/migration/v2/types'
import type { LucideIcon } from 'lucide-react'
import { CheckCircle2, Database, Loader2, Shield } from 'lucide-react'
import React from 'react'
import { useTranslation } from 'react-i18next'

import { StatePanel } from './StatePanel'
import { StepPage } from './StepPage'

export type BackupChoice = 'create' | 'existing'

interface Props {
  stage: MigrationStage
  backupChoice: BackupChoice
  confirmedBackupMode: BackupChoice
  progressMessage: string
  progressValue: number
  onBackupChoiceChange: (choice: BackupChoice) => void
}

function ChoiceRow({
  value,
  icon: Icon,
  title,
  description,
  selected,
  badge,
  onSelect
}: {
  value: BackupChoice
  icon: LucideIcon
  title: string
  description: string
  selected: boolean
  badge?: string
  onSelect: () => void
}) {
  return (
    <div onClick={onSelect} className="flex w-full items-start gap-3 py-3 text-left">
      <Icon
        className={cn(
          'lucide-custom size-5 shrink-0 transition-colors duration-200',
          selected ? 'text-primary' : 'text-muted-foreground'
        )}
      />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className="font-medium text-foreground text-sm">{title}</p>
          {badge ? <Badge variant="secondary">{badge}</Badge> : null}
        </div>
        <p className="mt-1 text-muted-foreground text-sm leading-6">{description}</p>
      </div>
      <RadioGroupItem
        value={value}
        size="sm"
        aria-label={title}
        className={cn(
          'border-black/15 text-primary shadow-none transition-all duration-200 hover:bg-primary/10',
          selected && 'border-primary'
        )}
      />
    </div>
  )
}

export const MigrationBackupStep: React.FC<Props> = ({
  stage,
  backupChoice,
  confirmedBackupMode,
  progressMessage,
  progressValue,
  onBackupChoiceChange
}) => {
  const { t } = useTranslation()
  const isCreatingBackup = stage === 'backup_progress'
  const isReadyToMigrate = stage === 'backup_confirmed'

  if (isCreatingBackup) {
    return (
      <StepPage
        title={t('migration.backup.progress_title')}
        description={t('migration.backup.progress_description')}
        headerClassName="mx-auto w-full max-w-xl">
        <div className="mx-auto w-full max-w-xl space-y-5">
          <StatePanel
            icon={Loader2}
            title={t('migration.backup.progress_title')}
            description={progressMessage}
            loading
          />
          <div className="space-y-3 rounded-2xl border border-border/70 bg-muted/30 p-5">
            <div className="flex items-center justify-between gap-4">
              <p className="font-medium text-muted-foreground text-xs uppercase tracking-[0.18em]">
                {t('migration.migration_run.summary.overall_progress')}
              </p>
              <p className="font-semibold text-foreground text-lg tabular-nums">{Math.round(progressValue)}%</p>
            </div>
            <div className="h-2 w-full overflow-hidden rounded-full bg-primary/12">
              <div
                className="h-full rounded-full bg-primary transition-[width] duration-500 ease-out"
                style={{ width: `${Math.max(0, Math.min(100, progressValue))}%` }}
              />
            </div>
            <p className="text-muted-foreground text-sm leading-6">{t('migration.backup.progress_hint')}</p>
          </div>
        </div>
      </StepPage>
    )
  }

  if (isReadyToMigrate) {
    return (
      <StepPage
        title={t('migration.backup.ready_title')}
        description={t('migration.backup.ready_description')}
        headerClassName="mx-auto w-full max-w-xl">
        <div className="mx-auto w-full max-w-xl space-y-5">
          <StatePanel
            icon={CheckCircle2}
            title={t('migration.backup.ready_title')}
            description={
              confirmedBackupMode === 'create'
                ? t('migration.backup.selected.create')
                : t('migration.backup.selected.existing')
            }
          />
        </div>
      </StepPage>
    )
  }

  return (
    <StepPage
      title={t('migration.backup.title')}
      description={t('migration.backup.description')}
      headerClassName="mx-auto w-full max-w-xl">
      <RadioGroup
        value={backupChoice}
        onValueChange={(value) => onBackupChoiceChange(value as BackupChoice)}
        className="mx-auto w-full max-w-xl gap-2">
        <ChoiceRow
          value="create"
          icon={Database}
          title={t('migration.backup.primary.title')}
          description={t('migration.backup.primary.description')}
          badge={t('migration.backup.primary.badge')}
          selected={backupChoice === 'create'}
          onSelect={() => onBackupChoiceChange('create')}
        />
        <ChoiceRow
          value="existing"
          icon={Shield}
          title={t('migration.backup.secondary.title')}
          description={t('migration.backup.secondary.description')}
          selected={backupChoice === 'existing'}
          onSelect={() => onBackupChoiceChange('existing')}
        />
      </RadioGroup>
      <div
        key={backupChoice}
        className="fade-in slide-in-from-bottom-2 mx-auto w-full max-w-xl animate-in duration-200">
        <p className="text-muted-foreground text-sm leading-6">
          {backupChoice === 'create'
            ? t('migration.backup.selection_hint_create')
            : t('migration.backup.selection_hint_existing')}
        </p>
      </div>
    </StepPage>
  )
}
