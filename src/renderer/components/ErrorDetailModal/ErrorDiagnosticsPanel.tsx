import { Alert, Button, Dialog, DialogContent, DialogTitle } from '@cherrystudio/ui'
import { DoctorCheckResults, DoctorConfirmationView } from '@renderer/components/doctor/DoctorCheckResults'
import { useDoctorController } from '@renderer/components/doctor/useDoctorController'
import type { SerializedError } from '@renderer/types/error'
import type { DiagnosisContext, DiagnosisResult } from '@renderer/utils/errorDiagnosis'
import type { DoctorCheckId, DoctorNavigateTarget } from '@shared/types/doctor'
import type { UpdateInfo } from 'builder-util-runtime'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import AiDiagnosisSectionWithStatus from './AiDiagnosisSection'

interface ErrorDiagnosticsPanelProps {
  readonly blockId?: string
  readonly cachedDiagnosis?: DiagnosisResult
  readonly diagnosisContext?: DiagnosisContext
  readonly error?: SerializedError
  readonly onDiagnosisComplete?: (partId: string, diagnosis: DiagnosisResult) => void | Promise<void>
  readonly onInstallUpdate?: (releaseInfo: UpdateInfo) => void
  readonly onNavigate?: (target: DoctorNavigateTarget) => void
  readonly onReportProblem?: (description: string) => void
}

type DiagnosisStatus = 'idle' | 'loading' | 'done' | 'error'

const ignoreInstallUpdate = () => undefined
const ignoreNavigation = () => undefined

export function ErrorDiagnosticsPanel({
  blockId,
  cachedDiagnosis,
  diagnosisContext,
  error,
  onDiagnosisComplete,
  onInstallUpdate = ignoreInstallUpdate,
  onNavigate = ignoreNavigation,
  onReportProblem
}: ErrorDiagnosticsPanelProps) {
  const { t } = useTranslation()
  const [diagnosisStatus, setDiagnosisStatus] = useState<DiagnosisStatus>(
    cachedDiagnosis ? 'done' : error ? 'loading' : 'idle'
  )
  const restoreActionCheckRef = useRef<DoctorCheckId | null>(null)
  const controller = useDoctorController({
    autoRunPolicy: 'when-not-running',
    initialPanel: 'checks',
    onInstallUpdate,
    onNavigate,
    onReportProblem
  })
  const { interaction } = controller.session
  const isConfirming = interaction.kind === 'confirm-fix' || interaction.kind === 'confirm-evidence'
  const isLiveRun =
    (controller.viewModel.status === 'running' && controller.viewModel.tier === 'live') ||
    (interaction.kind === 'run' && interaction.tier === 'live')
  const confirmationTitle =
    interaction.kind === 'confirm-fix'
      ? t('settings.doctor.confirm_fix.title')
      : interaction.kind === 'confirm-evidence'
        ? t('settings.doctor.confirm_evidence.title')
        : t('settings.doctor.title')

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
    if (currentInteraction.kind !== 'confirm-fix' && currentInteraction.kind !== 'confirm-evidence') return
    restoreActionCheckRef.current =
      currentInteraction.kind === 'confirm-fix' ? currentInteraction.request.checkId : currentInteraction.checkId
    controller.cancelFixConfirmation()
  }, [controller])

  return (
    <section aria-labelledby="error-system-diagnostics-heading">
      <div className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id="error-system-diagnostics-heading" className="font-medium text-sm">
            {t('settings.doctor.title')}
          </h2>
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
        </div>

        {error || cachedDiagnosis ? (
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

        {controller.viewModel.isStale ? (
          <Alert type="warning" showIcon description={t('settings.doctor.stale.description')} />
        ) : null}

        {controller.session.relaunchRequired ? (
          <Alert type="info" showIcon description={t('settings.doctor.messages.relaunch_required')} />
        ) : null}

        {controller.viewModel.rows.length > 0 ? (
          <DoctorCheckResults controller={controller} />
        ) : (
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
        )}
      </div>

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
    </section>
  )
}
