import { Button } from '@cherrystudio/ui'
import { FileWarning } from 'lucide-react'
import { useTranslation } from 'react-i18next'

export function SupportDiagnosticReportButton({ onClick }: { readonly onClick: () => void }) {
  const { t } = useTranslation()
  return (
    <Button type="button" variant="outline" size="sm" onClick={onClick}>
      <FileWarning aria-hidden="true" size={14} />
      {t('agent.builtin.cherry_support.diagnostics.report_problem')}
    </Button>
  )
}
