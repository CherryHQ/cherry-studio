import { Button } from '@cherrystudio/ui'
import { AlertTriangle, RefreshCw } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { StatePanel, StepPage } from '../components'
import { MigrationScreenLayout } from './MigrationScreenLayout'

type Props = {
  errorMessage: string
  onRetry: () => void
}

export function FailedScreen({ errorMessage, onRetry }: Props) {
  const { t } = useTranslation()

  return (
    <MigrationScreenLayout
      currentStep={3}
      footerMessage={t('migration.footer.failed')}
      primaryAction={
        <Button className="min-h-10 rounded-md px-4 shadow-none" onClick={onRetry}>
          {t('migration.buttons.retry')}
          <RefreshCw className="lucide-custom size-4" />
        </Button>
      }>
      <StepPage
        align="center"
        title={t('migration.failed.title')}
        description={t('migration.failed.description')}
        leading={
          <div className="zoom-in-95 flex size-16 animate-in items-center justify-center rounded-full border border-red-500/25 bg-red-500/10 duration-300">
            <AlertTriangle className="lucide-custom size-8 text-red-700" />
          </div>
        }>
        <div className="mx-auto w-full max-w-md space-y-4 text-left">
          <StatePanel
            icon={AlertTriangle}
            title={t('migration.failed.details_label')}
            description={errorMessage}
            tone="danger"
            mono
          />
          <p className="text-muted-foreground text-sm">{t('migration.failed.retry_hint')}</p>
        </div>
      </StepPage>
    </MigrationScreenLayout>
  )
}
