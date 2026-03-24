import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

type Props = {
  currentStep: number
  totalSteps: number
  message: string
  secondaryAction?: ReactNode
  primaryAction?: ReactNode
}

export function MigrationFooter({ currentStep, totalSteps, message, secondaryAction, primaryAction }: Props) {
  const { t } = useTranslation()

  return (
    <footer className="border-black/8 border-t">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-4 px-6 py-4 md:flex-row md:items-center md:justify-between">
        <div className="min-w-0">
          <p className="font-medium text-muted-foreground text-xs uppercase tracking-[0.18em]">
            {t('migration.footer.step', { current: currentStep, total: totalSteps })}
          </p>
          <p className="mt-2 text-muted-foreground text-sm">{message}</p>
        </div>
        <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 md:min-w-[240px]">
          <div className="flex min-w-[96px] justify-end">{secondaryAction}</div>
          <div className="flex min-w-[96px] justify-start">{primaryAction}</div>
        </div>
      </div>
    </footer>
  )
}
