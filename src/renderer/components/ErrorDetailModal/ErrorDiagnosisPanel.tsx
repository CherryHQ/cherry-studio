import { RotateCcw } from 'lucide-react'
import type { ReactNode } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import { BeatLoader } from 'react-spinners'

import { Accordion, Button, Tooltip } from '@cherrystudio/ui'
import { DiagnosticsPanel } from '@renderer/components/DiagnosticsPanel'
import { DoctorCheckAccordionItems, DoctorCheckNotices } from '@renderer/components/doctor'
import type { DoctorController } from '@renderer/hooks/doctor'
import { getProviderLabelKey } from '@renderer/i18n/label'
import type { DoctorSubjectRef } from '@shared/types/doctor'
import { doctorCheckTitleKey } from '@shared/utils/doctor'

import { actionRequiredRows, ErrorConnectivitySteps } from './ErrorConnectivitySteps'

interface ErrorDiagnosisPanelProps {
  readonly doctorController: DoctorController
  readonly subject: DoctorSubjectRef
}

function FixedSummary({ children, enabled }: { children?: ReactNode; enabled: boolean }) {
  return enabled ? <span className="text-success">{children}</span> : null
}

export function ErrorDiagnosisPanel({ doctorController, subject }: ErrorDiagnosisPanelProps) {
  const { t } = useTranslation()
  const { interaction } = doctorController.session
  const showConnectivitySteps = subject.kind !== 'global'
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
    fixed: fixedCheckNames.join(', '),
    attention: t('message.tools.units.item', { count: doctorController.viewModel.summary.userFixable })
  }
  const hasDoctorNotices =
    doctorController.viewModel.isStale ||
    doctorController.session.relaunchRequired ||
    doctorController.viewModel.status === 'canceled' ||
    doctorController.viewModel.status === 'failed' ||
    (doctorController.viewModel.rows.length === 0 && !showConnectivitySteps)

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

  const providerId = subject.kind !== 'global' ? subject.providerId : undefined
  const providerName = providerId ? t(getProviderLabelKey(providerId, providerId)) : ''
  const extraRows =
    !isDoctorPending && doctorController.viewModel.status === 'completed'
      ? actionRequiredRows(doctorController).map((row) => {
          const result = row.result
          if (
            row.id !== 'provider-api-key-present' ||
            !result ||
            result.id !== 'provider-api-key-present' ||
            (result.status !== 'warn' && result.status !== 'fail') ||
            result.detail.params?.provider ||
            !providerName
          ) {
            return row
          }
          return {
            ...row,
            result: {
              ...result,
              detail: {
                ...result.detail,
                params: { ...result.detail.params, provider: providerName }
              }
            }
          }
        })
      : []
  const extraFindings =
    extraRows.length > 0 ? (
      <DoctorCheckAccordionItems
        compact
        showActionRequiredTag
        showEvidence={false}
        showStatusIcon={false}
        controller={doctorController}
        rows={extraRows}
      />
    ) : null

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
        ) : (
          <Tooltip content={t('settings.doctor.actions.run_network')}>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className="-mr-1.5 text-muted-foreground dark:text-muted-foreground"
              aria-label={t('settings.doctor.actions.run_network')}
              disabled={isDoctorPending || doctorController.isInteracting}
              onClick={() => void doctorController.run(subject.kind === 'global' ? 'quick' : 'contextual')}>
              <RotateCcw className="size-4" />
            </Button>
          </Tooltip>
        )
      }>
      {showConnectivitySteps ? (
        <div>
          <Accordion type="single" collapsible className="[&>[data-slot=accordion-item]:first-child]:border-t-0">
            <ErrorConnectivitySteps controller={doctorController} />
            {extraFindings}
          </Accordion>
          {hasDoctorNotices ? (
            <div className="space-y-3 px-4 pb-4">
              <DoctorCheckNotices
                controller={doctorController}
                onRetry={() => doctorController.run('contextual')}
                retryLabel="rerun"
              />
            </div>
          ) : null}
        </div>
      ) : isDoctorPending ? (
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
                fixed: <FixedSummary key="fixed" enabled={fixedCheckNames.length > 0} />,
                attention: <span key="attention" className="text-warning" />
              }}
            />
          </p>
          {extraFindings ? (
            <Accordion type="single" collapsible>
              {extraFindings}
            </Accordion>
          ) : null}
          {doctorController.viewModel.pendingChecks.length > 0 ? (
            <div className="space-y-3 border-t border-border px-4 py-3">
              {doctorController.viewModel.pendingChecks.map((pending) => (
                <div key={pending.requestId} className="flex flex-col gap-2">
                  <p className="text-xs leading-5 text-foreground">
                    {t(pending.confirmation.messageKey, pending.confirmation.params)}
                  </p>
                  <div>
                    <Button
                      variant="outline"
                      size="sm"
                      loading={interaction.kind === 'confirm-check'}
                      disabled={doctorController.isInteracting}
                      onClick={() => void doctorController.confirmCheck(pending)}>
                      {t('settings.doctor.actions.confirm_check')}
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          ) : null}
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
