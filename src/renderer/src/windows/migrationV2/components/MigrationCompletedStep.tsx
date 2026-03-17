import { CheckCircle2 } from 'lucide-react'
import React from 'react'
import { useTranslation } from 'react-i18next'

import { StepPage } from './StepPage'

export const MigrationCompletedStep: React.FC = () => {
  const { t } = useTranslation()

  return (
    <StepPage
      align="center"
      title={t('migration.completed.title')}
      description={t('migration.completed.description')}
      leading={
        <div className="zoom-in-95 flex size-16 animate-in items-center justify-center rounded-full border border-primary/25 bg-primary/10 duration-300">
          <CheckCircle2 className="lucide-custom size-8 text-primary" />
        </div>
      }>
      {null}
    </StepPage>
  )
}
