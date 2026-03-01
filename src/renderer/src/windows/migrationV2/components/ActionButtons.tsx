/**
 * Action buttons component for migration flow
 */

import { Button } from '@cherrystudio/ui'
import type { MigrationStage } from '@shared/data/migration/v2/types'
import React from 'react'
import { useTranslation } from 'react-i18next'

interface Props {
  stage: MigrationStage
  onProceedToBackup: () => void
  onConfirmBackup: () => void
  onStartMigration: () => void
  onRetry: () => void
  onCancel: () => void
  onRestart: () => void
  isLoading?: boolean
}

export const ActionButtons: React.FC<Props> = ({
  stage,
  onProceedToBackup,
  onConfirmBackup,
  onStartMigration,
  onRetry,
  onCancel,
  onRestart,
  isLoading = false
}) => {
  const { t } = useTranslation()

  switch (stage) {
    case 'introduction':
      return (
        <div className="flex justify-end gap-3">
          <Button variant="ghost" onClick={onCancel}>
            {t('migration.buttons.cancel')}
          </Button>
          <Button variant="default" onClick={onProceedToBackup}>
            {t('migration.buttons.next')}
          </Button>
        </div>
      )

    case 'backup_required':
      return (
        <div className="flex justify-end gap-3">
          <Button variant="ghost" onClick={onCancel}>
            {t('migration.buttons.cancel')}
          </Button>
          <Button variant="default" onClick={onConfirmBackup}>
            {t('migration.buttons.backup_completed')}
          </Button>
        </div>
      )

    case 'backup_confirmed':
      return (
        <div className="flex justify-end gap-3">
          <Button variant="ghost" onClick={onCancel}>
            {t('migration.buttons.cancel')}
          </Button>
          <Button variant="default" onClick={onStartMigration} loading={isLoading}>
            {t('migration.buttons.start_migration')}
          </Button>
        </div>
      )

    case 'migration':
      return (
        <div className="flex justify-end gap-3">
          <Button variant="default" disabled loading>
            {t('migration.buttons.migrating')}
          </Button>
        </div>
      )

    case 'completed':
      return (
        <div className="flex justify-end gap-3">
          <Button variant="default" onClick={onRestart} className="bg-green-600 hover:bg-green-700">
            {t('migration.buttons.restart')}
          </Button>
        </div>
      )

    case 'error':
      return (
        <div className="flex justify-end gap-3">
          <Button variant="ghost" onClick={onCancel}>
            {t('migration.buttons.exit')}
          </Button>
          <Button variant="default" onClick={onRetry}>
            {t('migration.buttons.retry')}
          </Button>
        </div>
      )

    default:
      return null
  }
}
