import { Badge, Button, RadioGroup, RadioGroupItem } from '@cherrystudio/ui'
import { cn } from '@cherrystudio/ui/lib/utils'
import type { MigrationBackupMode } from '@shared/data/migration/v2/types'
import type { LucideIcon } from 'lucide-react'
import { ArrowRight, CheckCircle2, Database, Loader2, Shield } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { StatePanel, StepPage } from '../components'
import { MigrationScreenLayout } from './MigrationScreenLayout'

type BackupScreenStage = 'backup_required' | 'backup_in_progress' | 'backup_ready'

type Props = {
  stage: BackupScreenStage
  backupChoice: MigrationBackupMode
  confirmedBackupMode: MigrationBackupMode
  isStartingMigration: boolean
  onBackupChoiceChange: (choice: MigrationBackupMode) => void
  onBack: () => void
  onProceed: () => void
  onStartMigration: () => void
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
  value: MigrationBackupMode
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

export function BackupScreen({
  stage,
  backupChoice,
  confirmedBackupMode,
  isStartingMigration,
  onBackupChoiceChange,
  onBack,
  onProceed,
  onStartMigration
}: Props) {
  const { t } = useTranslation()

  switch (stage) {
    case 'backup_in_progress':
      return (
        <MigrationScreenLayout
          currentStep={2}
          footerMessage={t('migration.footer.backup_in_progress')}
          primaryAction={
            <Button className="min-h-10 rounded-md px-4 shadow-none" disabled loading>
              {t('migration.buttons.backing_up')}
            </Button>
          }>
          <StepPage
            title={t('migration.backup.progress_title')}
            description={t('migration.backup.progress_description')}
            headerClassName="mx-auto w-full max-w-xl">
            <div className="mx-auto w-full max-w-xl space-y-5">
              <StatePanel
                icon={Loader2}
                title={t('migration.backup.progress_title')}
                description={t('migration.backup.progress_hint')}
                loading
              />
            </div>
          </StepPage>
        </MigrationScreenLayout>
      )

    case 'backup_ready':
      return (
        <MigrationScreenLayout
          currentStep={2}
          footerMessage={t('migration.footer.backup_ready')}
          secondaryAction={
            <Button
              variant="ghost"
              className="min-h-10 rounded-md px-3.5 text-muted-foreground shadow-none hover:bg-accent hover:text-accent-foreground"
              onClick={onBack}>
              {t('migration.buttons.back')}
            </Button>
          }
          primaryAction={
            <Button
              className="min-h-10 rounded-md px-4 shadow-none"
              onClick={onStartMigration}
              loading={isStartingMigration}>
              {t('migration.buttons.start_migration')}
              <ArrowRight className="lucide-custom size-4" />
            </Button>
          }>
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
        </MigrationScreenLayout>
      )

    case 'backup_required':
    default:
      return (
        <MigrationScreenLayout
          currentStep={2}
          footerMessage={
            backupChoice === 'create'
              ? t('migration.footer.backup_required_create')
              : t('migration.footer.backup_required_existing')
          }
          secondaryAction={
            <Button
              variant="ghost"
              className="min-h-10 rounded-md px-3.5 text-muted-foreground shadow-none hover:bg-accent hover:text-accent-foreground"
              onClick={onBack}>
              {t('migration.buttons.back')}
            </Button>
          }
          primaryAction={
            <Button className="min-h-10 rounded-md px-4 shadow-none" onClick={onProceed}>
              {backupChoice === 'create' ? t('migration.buttons.create_backup') : t('migration.buttons.confirm_backup')}
              <ArrowRight className="lucide-custom size-4" />
            </Button>
          }>
          <StepPage
            title={t('migration.backup.title')}
            description={t('migration.backup.description')}
            headerClassName="mx-auto w-full max-w-xl">
            <RadioGroup
              value={backupChoice}
              onValueChange={(value) => onBackupChoiceChange(value as MigrationBackupMode)}
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
        </MigrationScreenLayout>
      )
  }
}
