import { AlertTriangle } from 'lucide-react'
import React from 'react'
import { useTranslation } from 'react-i18next'

import { StatePanel } from './StatePanel'
import { StepPage } from './StepPage'

interface Props {
  errorMessage: string
}

export const MigrationErrorStep: React.FC<Props> = ({ errorMessage }) => {
  const { t } = useTranslation()

  return (
    <StepPage
      align="center"
      title={t('migration.error.title')}
      description={t('migration.error.description')}
      leading={
        <div className="zoom-in-95 flex size-16 animate-in items-center justify-center rounded-full border border-red-500/25 bg-red-500/10 duration-300">
          <AlertTriangle className="lucide-custom size-8 text-red-700" />
        </div>
      }>
      <div className="mx-auto w-full max-w-md space-y-4 text-left">
        <StatePanel
          icon={AlertTriangle}
          title={t('migration.error.details_label')}
          description={errorMessage}
          tone="danger"
          mono
        />
        <p className="text-muted-foreground text-sm">{t('migration.error.retry_hint')}</p>
      </div>
    </StepPage>
  )
}
