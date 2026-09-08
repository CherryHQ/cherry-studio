import { Accordion } from '@cherrystudio/ui'
import { DiagnosticsPanel } from '@renderer/components/DiagnosticsPanel'
import { DoctorCheckAccordionItems } from '@renderer/components/doctor'
import type { DoctorController } from '@renderer/hooks/doctor'
import { useTranslation } from 'react-i18next'

interface ErrorDiagnosticsPanelProps {
  readonly controller: DoctorController
  readonly isPending: boolean
}

export function ErrorDiagnosticsPanel({ controller, isPending }: ErrorDiagnosticsPanelProps) {
  const { t } = useTranslation()
  const manualRows = controller.viewModel.rows.filter((row) => {
    const result = row.result
    return result && (result.status === 'warn' || result.status === 'fail') && result.attribution === 'user-fixable'
  })

  if (isPending || controller.viewModel.status !== 'completed' || manualRows.length === 0) return null

  return (
    <DiagnosticsPanel title={t('error.diagnostics.action_required')} variant="sectioned">
      <Accordion type="single" collapsible className="[&>[data-slot=accordion-item]:first-child]:border-t-0">
        <DoctorCheckAccordionItems compact defaultLocalDetailsExpanded controller={controller} rows={manualRows} />
      </Accordion>
    </DiagnosticsPanel>
  )
}
