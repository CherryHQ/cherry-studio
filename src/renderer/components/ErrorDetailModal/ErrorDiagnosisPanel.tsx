import { Button } from '@cherrystudio/ui'
import { loggerService } from '@logger'
import { DiagnosticsPanel } from '@renderer/components/DiagnosticsPanel'
import { DoctorCheckNotices } from '@renderer/components/doctor'
import type { DoctorController } from '@renderer/hooks/doctor'
import type { SerializedError } from '@renderer/types/error'
import type { DiagnosisContext, DiagnosisResult } from '@renderer/utils/errorDiagnosis'
import { doctorCheckTitleKey } from '@shared/utils/doctor'
import { TriangleAlert } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import { BeatLoader } from 'react-spinners'

const logger = loggerService.withContext('ErrorDiagnosisPanel')

interface ErrorDiagnosisPanelProps {
  readonly blockId?: string
  readonly cachedDiagnosis?: DiagnosisResult
  readonly diagnosisContext?: DiagnosisContext
  readonly doctorController: DoctorController
  readonly error?: SerializedError
  readonly onDiagnosisComplete?: (partId: string, diagnosis: DiagnosisResult) => void | Promise<void>
  readonly onPendingChange: (pending: boolean) => void
}

type DiagnosisState =
  | { readonly status: 'loading' }
  | { readonly status: 'done'; readonly result: DiagnosisResult }
  | { readonly status: 'error'; readonly message: string }

export function ErrorDiagnosisPanel({
  blockId,
  cachedDiagnosis,
  diagnosisContext,
  doctorController,
  error,
  onDiagnosisComplete,
  onPendingChange
}: ErrorDiagnosisPanelProps) {
  const { t, i18n } = useTranslation()
  const [diagnosis, setDiagnosis] = useState<DiagnosisState>(
    cachedDiagnosis ? { status: 'done', result: cachedDiagnosis } : { status: 'loading' }
  )
  const autoDiagnosisStartedRef = useRef(Boolean(cachedDiagnosis))
  const requestIdRef = useRef(0)
  const mountedRef = useRef(true)
  const { interaction } = doctorController.session
  const activeDoctorTier =
    doctorController.viewModel.status === 'running'
      ? doctorController.viewModel.tier
      : interaction.kind === 'run'
        ? interaction.tier
        : undefined
  const isDoctorPending = doctorController.isAutoRunPending || activeDoctorTier !== undefined
  const isPending = isDoctorPending || diagnosis.status === 'loading'
  const completedChecks = doctorController.viewModel.rows.filter((row) => row.status !== 'pending').length
  const fixedCheckNames = doctorController.session.fixedCheckIds.map((checkId) => t(doctorCheckTitleKey(checkId)))
  const activeCheckId = doctorController.viewModel.activeCheckIds[0]
  const activeCheckName = activeCheckId ? t(doctorCheckTitleKey(activeCheckId)) : undefined
  const resultSummaryValues = {
    fixed: fixedCheckNames.length > 0 ? fixedCheckNames.join(', ') : t('common.none'),
    attention: t('message.tools.units.item', { count: doctorController.viewModel.summary.userFixable }),
    summary: diagnosis.status === 'done' ? diagnosis.result.summary : t('common.none')
  }
  const hasDoctorNotices =
    doctorController.viewModel.isStale ||
    doctorController.session.relaunchRequired ||
    doctorController.viewModel.rows.length === 0

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  const runDiagnosis = useCallback(async () => {
    if (!error) return
    const requestId = requestIdRef.current + 1
    requestIdRef.current = requestId
    onPendingChange(true)
    setDiagnosis({ status: 'loading' })
    try {
      const { diagnoseError } = await import('@renderer/utils/errorDiagnosis')
      const result = await diagnoseError(error, i18n.language, diagnosisContext)
      if (!mountedRef.current || requestIdRef.current !== requestId) return
      setDiagnosis({ status: 'done', result })
      onPendingChange(false)
      if (blockId && onDiagnosisComplete) {
        void Promise.resolve()
          .then(() => onDiagnosisComplete(blockId, result))
          .catch((error) => {
            logger.warn(`Failed to persist diagnosis for ${blockId}:`, { error })
          })
      }
    } catch (diagnosisError: unknown) {
      if (!mountedRef.current || requestIdRef.current !== requestId) return
      setDiagnosis({
        status: 'error',
        message: diagnosisError instanceof Error ? diagnosisError.message : t('error.diagnosis.unknown')
      })
      onPendingChange(false)
    }
  }, [blockId, diagnosisContext, error, i18n.language, onDiagnosisComplete, onPendingChange, t])

  useEffect(() => {
    if (autoDiagnosisStartedRef.current || cachedDiagnosis || !error) return
    autoDiagnosisStartedRef.current = true
    void runDiagnosis()
  }, [cachedDiagnosis, error, runDiagnosis])

  const progress =
    doctorController.viewModel.status === 'running'
      ? activeCheckName
        ? t('error.diagnostics.checking_progress', {
            check: activeCheckName,
            completed: completedChecks,
            total: doctorController.viewModel.rows.length
          })
        : t('settings.doctor.summary.progress', {
            completed: completedChecks,
            total: doctorController.viewModel.rows.length
          })
      : activeDoctorTier !== undefined
        ? t(
            activeDoctorTier === 'live'
              ? 'settings.doctor.summary.running_full'
              : 'settings.doctor.summary.running_basic'
          )
        : isDoctorPending
          ? t('settings.doctor.summary.running_basic')
          : t('error.diagnostics.preparing_result')

  return (
    <DiagnosticsPanel
      title={t(isPending ? 'error.diagnostics.diagnosing' : 'error.diagnostics.result')}
      variant="sectioned"
      actions={
        doctorController.viewModel.canCancel ? (
          <Button
            variant="outline"
            size="sm"
            loading={interaction.kind === 'cancel'}
            disabled={
              doctorController.isInteracting &&
              interaction.kind !== 'cancel' &&
              !(interaction.kind === 'run' && doctorController.viewModel.canCancel)
            }
            onClick={() => void doctorController.cancel()}>
            {t('settings.doctor.actions.cancel_run')}
          </Button>
        ) : !isPending ? (
          <Button
            variant="outline"
            size="sm"
            disabled={doctorController.isInteracting || !doctorController.viewModel.report}
            onClick={() => void doctorController.run('live')}>
            {t('settings.doctor.actions.run_network')}
          </Button>
        ) : null
      }>
      {isPending ? (
        <div
          className="flex min-w-0 items-center gap-1.5 px-4 py-3 text-[13px] text-foreground-tertiary leading-5"
          role="status"
          aria-live="polite">
          <span className="min-w-0 truncate whitespace-nowrap">{progress}</span>
          <span className="flex shrink-0 items-center" aria-hidden>
            <BeatLoader color="currentColor" size={4} speedMultiplier={0.8} />
          </span>
        </div>
      ) : (
        <div>
          <p className="px-4 py-3 text-xs leading-5">
            <Trans
              t={t}
              i18nKey="error.diagnostics.result_summary"
              values={resultSummaryValues}
              components={{
                fixed: <span key="fixed" className="text-success" />,
                attention: <span key="attention" className="text-warning" />
              }}
            />
          </p>
          {diagnosis.status === 'error' || hasDoctorNotices ? (
            <div className="space-y-3 px-4 pb-4">
              {diagnosis.status === 'error' ? (
                <div
                  className="flex flex-wrap items-center gap-2 rounded-md bg-warning-subtle px-3 py-2 text-warning-subtle-foreground"
                  role="alert">
                  <TriangleAlert className="size-4 shrink-0 text-warning" aria-hidden />
                  <p className="min-w-0 flex-1 text-xs">{diagnosis.message}</p>
                  <Button variant="ghost" size="sm" onClick={() => void runDiagnosis()}>
                    {t('common.retry')}
                  </Button>
                </div>
              ) : null}
              <DoctorCheckNotices controller={doctorController} />
            </div>
          ) : null}
        </div>
      )}
    </DiagnosticsPanel>
  )
}
