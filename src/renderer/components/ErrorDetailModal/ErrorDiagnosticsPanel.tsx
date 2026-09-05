import { Accordion, Alert, Button, Dialog, DialogContent, DialogTitle } from '@cherrystudio/ui'
import { DiagnosticsPanel } from '@renderer/components/DiagnosticsPanel'
import { DoctorCheckList, DoctorConfirmationView } from '@renderer/components/doctor'
import { useDoctorController } from '@renderer/hooks/doctor'
import type { SerializedError } from '@renderer/types/error'
import type { DiagnosisContext, DiagnosisResult } from '@renderer/utils/errorDiagnosis'
import type { DoctorCheckId, DoctorNavigateTarget } from '@shared/types/doctor'
import { RotateCcw } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
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
  const restoreActionCheckRef = useRef<DoctorCheckId | null>(null)
  const controller = useDoctorController({
    autoRunPolicy: 'when-not-running',
    initialPanel: 'checks',
    onNavigate,
    onReportProblem
  })
  const { interaction } = controller.session
  const isConfirming = interaction.kind === 'confirm-evidence'
  const isLiveRun =
    (controller.viewModel.status === 'running' && controller.viewModel.tier === 'live') ||
    (interaction.kind === 'run' && interaction.tier === 'live')
  const confirmationTitle =
    interaction.kind === 'confirm-evidence' ? t('settings.doctor.confirm_evidence.title') : t('settings.doctor.title')
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

  useEffect(() => {
    if (interaction.kind !== 'idle' || !restoreActionCheckRef.current) return
    const checkId = restoreActionCheckRef.current
    restoreActionCheckRef.current = null
    document
      .querySelector<HTMLButtonElement>(
        `[data-doctor-action-check="${checkId}"], [data-doctor-evidence-trigger="${checkId}"]`
      )
      ?.focus()
  }, [interaction.kind])

  const handleDiagnosisComplete = useCallback(
    async (partId: string, diagnosis: DiagnosisResult) => {
      await onDiagnosisComplete?.(partId, diagnosis)
    },
    [onDiagnosisComplete]
  )

  const cancelConfirmation = useCallback(() => {
    const currentInteraction = controller.session.interaction
    if (currentInteraction.kind !== 'confirm-evidence') return
    restoreActionCheckRef.current = currentInteraction.checkId
    controller.cancelConfirmation()
  }, [controller])

  return (
    <>
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

        {controller.viewModel.isStale ? (
          <Alert
            type="warning"
            showIcon
            description={t('settings.doctor.stale.description')}
            action={
              <Button
                variant="outline"
                size="sm"
                disabled={controller.isInteracting}
                onClick={() => void controller.run('quick')}>
                <RotateCcw className="size-4" aria-hidden />
                {t('settings.doctor.actions.run_basic')}
              </Button>
            }
          />
        ) : null}

        {controller.session.relaunchRequired ? (
          <Alert type="info" showIcon description={t('settings.doctor.messages.relaunch_required')} />
        ) : null}

        {controller.viewModel.rows.length === 0 ? (
          <Alert
            type="info"
            showIcon
            message={t(
              controller.viewModel.status === 'canceled'
                ? 'settings.doctor.empty.canceled_title'
                : 'settings.doctor.empty.title'
            )}
            description={t(
              controller.viewModel.status === 'canceled'
                ? 'settings.doctor.empty.canceled_description'
                : 'settings.doctor.empty.description'
            )}
          />
        ) : null}
      </DiagnosticsPanel>

      <Dialog open={isConfirming} onOpenChange={(open) => !open && cancelConfirmation()}>
        <DialogContent
          aria-describedby={undefined}
          closeOnOverlayClick={false}
          showCloseButton={false}
          className="max-h-[calc(100vh-2rem)] gap-0 overflow-hidden p-0 sm:max-w-xl">
          <DialogTitle className="sr-only">{confirmationTitle}</DialogTitle>
          <DoctorConfirmationView
            controller={controller}
            onResolve={(checkId) => {
              restoreActionCheckRef.current = checkId
            }}
          />
        </DialogContent>
      </Dialog>
    </>
  )
}
