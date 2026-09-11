import { Trans, useTranslation } from 'react-i18next'
import { BeatLoader } from 'react-spinners'

import { Button } from '@cherrystudio/ui'
import { DiagnosticsPanel } from '@renderer/components/DiagnosticsPanel'
import { DoctorCheckNotices } from '@renderer/components/doctor'
import type { DoctorController } from '@renderer/hooks/doctor'
import { doctorCheckTitleKey } from '@shared/utils/doctor'

interface ErrorDiagnosisPanelProps {
  readonly doctorController: DoctorController
}

export function ErrorDiagnosisPanel({ doctorController }: ErrorDiagnosisPanelProps) {
  const { t } = useTranslation()
  const { interaction } = doctorController.session
  const activeDoctorTier =
    doctorController.viewModel.status === 'running'
      ? doctorController.viewModel.tier
      : interaction.kind === 'run'
        ? interaction.tier
        : undefined
  const isDoctorPending = doctorController.isAutoRunPending || activeDoctorTier !== undefined
  const completedChecks = doctorController.viewModel.rows.filter((row) => row.status !== 'pending').length
  const fixedCheckNames = doctorController.session.fixedCheckIds.map((checkId) => t(doctorCheckTitleKey(checkId)))
  const activeCheckId = doctorController.viewModel.activeCheckIds[0]
  const activeCheckName = activeCheckId ? t(doctorCheckTitleKey(activeCheckId)) : undefined
  const resultSummaryValues = {
    fixed: fixedCheckNames.length > 0 ? fixedCheckNames.join(', ') : t('common.none'),
    attention: t('message.tools.units.item', { count: doctorController.viewModel.summary.userFixable })
  }
  const hasDoctorNotices =
    doctorController.viewModel.isStale ||
    doctorController.session.relaunchRequired ||
    doctorController.viewModel.rows.length === 0

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
      title={t(isDoctorPending ? 'error.diagnostics.diagnosing' : 'error.diagnostics.result')}
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
        ) : !isDoctorPending ? (
          <Button
            variant="outline"
            size="sm"
            disabled={doctorController.isInteracting || !doctorController.viewModel.report}
            onClick={() => void doctorController.run('live')}>
            {t('settings.doctor.actions.run_network')}
          </Button>
        ) : null
      }>
      {isDoctorPending ? (
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
          {hasDoctorNotices ? (
            <div className="space-y-3 px-4 pb-4">
              <DoctorCheckNotices controller={doctorController} />
            </div>
          ) : null}
        </div>
      )}
    </DiagnosticsPanel>
  )
}
