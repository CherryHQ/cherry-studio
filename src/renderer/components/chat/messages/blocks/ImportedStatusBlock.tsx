import { useTranslation } from 'react-i18next'

export function ImportedStatusBlock({ status }: { status: string }) {
  const { t } = useTranslation()
  return <p className="text-sm text-muted-foreground">{t('agent.import.source_status', { status })}</p>
}
