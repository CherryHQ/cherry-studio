import { Accordion, Button } from '@cherrystudio/ui'
import { DiagnosticsPanel } from '@renderer/components/DiagnosticsPanel'
import { DoctorCheckList, DoctorCheckNotices } from '@renderer/components/doctor'
import { useDoctorController } from '@renderer/hooks/doctor'
import type { SerializedError } from '@renderer/types/error'
import type { DiagnosisContext, DiagnosisResult } from '@renderer/utils/errorDiagnosis'
import type { DoctorNavigateTarget } from '@shared/types/doctor'
import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import AiDiagnosisSectionWithStatus from './AiDiagnosisSection'

interface ErrorDiagnosticsPanelProps {
  readonly blockId?: string
  readonly cachedDiagnosis?: DiagnosisResult
  readonly diagnosisContext?: DiagnosisContext
  readonly error?: SerializedError
  readonly onCloseBlockedChange?: (blocked: boolean) => void
  readonly onDiagnosisComplete?: (partId: string, diagnosis: DiagnosisResult) => void | Promise<void>
  readonly onNavigate?: (target: DoctorNavigateTarget) => void
  readonly onReportProblem?: (description: string) => void
}

type DiagnosisStatus = 'idle' | 'loading' | 'done' | 'error'

const ignoreNavigation = () => undefined

export function ErrorDiagnosticsPanel({
  blockId,
  cachedDiagnosis,
  diagnosisContext,
  error,
  onCloseBlockedChange,
  onDiagnosisComplete,
  onNavigate = ignoreNavigation,
  onReportProblem
}: ErrorDiagnosticsPanelProps) {
  const { t } = useTranslation()
  const [diagnosisStatus, setDiagnosisStatus] = useState<DiagnosisStatus>(cachedDiagnosis ? 'done' : 'idle')
  const controller = useDoctorController({
    initialPanel: 'checks',
    onNavigate,
    onReportProblem
  })
  const { interaction } = controller.session
  const isLiveRun =
    (controller.viewModel.status === 'running' && controller.viewModel.tier === 'live') ||
    (interaction.kind === 'run' && interaction.tier === 'live')
  const hasAiDiagnosis = Boolean(error || cachedDiagnosis)
  const completedChecks = controller.viewModel.rows.filter((row) => row.status !== 'pending').length
  const summary =
    controller.viewModel.rows.length > 0
      ? `${t('settings.doctor.summary.progress', {
          completed: completedChecks,
          total: controller.viewModel.rows.length
        })} · ${t('settings.doctor.summary.problems', { count: controller.viewModel.problemCount })}`
      : undefined

  useEffect(() => {
    onCloseBlockedChange?.(controller.isCloseBlocked)
  }, [controller.isCloseBlocked, onCloseBlockedChange])

  const handleDiagnosisComplete = useCallback(
    async (partId: string, diagnosis: DiagnosisResult) => {
      await onDiagnosisComplete?.(partId, diagnosis)
    },
    [onDiagnosisComplete]
  )

  return (
    <DiagnosticsPanel
      title={t('settings.doctor.title')}
      description={summary}
      actions={
        <Button
          variant="outline"
          size="sm"
          loading={isLiveRun}
          disabled={
            controller.viewModel.status === 'running' || controller.isInteracting || !controller.viewModel.report
          }
          onClick={() => void controller.run('live')}>
          {t('settings.doctor.actions.run_network')}
        </Button>
      }
      bodyClassName="space-y-3 pb-3">
      {hasAiDiagnosis || controller.viewModel.rows.length > 0 ? (
        <Accordion
          type="single"
          collapsible
          defaultValue={hasAiDiagnosis ? 'ai-diagnosis' : undefined}
          className="border-border border-t bg-background px-2 [&>[data-slot=accordion-item]:first-child]:border-t-0">
          {hasAiDiagnosis ? (
            <AiDiagnosisSectionWithStatus
              key={blockId ?? error?.message ?? 'error-diagnosis'}
              error={error}
              status={diagnosisStatus}
              onStatusChange={setDiagnosisStatus}
              diagnosisContext={diagnosisContext}
              blockId={blockId}
              onDiagnosisComplete={handleDiagnosisComplete}
              cachedDiagnosis={cachedDiagnosis}
            />
          ) : null}
          {controller.viewModel.rows.length > 0 ? <DoctorCheckList controller={controller} /> : null}
        </Accordion>
      ) : null}

      <DoctorCheckNotices controller={controller} />
    </DiagnosticsPanel>
  )
}
