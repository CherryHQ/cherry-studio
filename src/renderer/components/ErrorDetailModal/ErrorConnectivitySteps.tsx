import { Loader2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { AccordionContent, AccordionItem, AccordionTrigger, Badge, Button } from '@cherrystudio/ui'
import { DoctorCheckActions } from '@renderer/components/doctor'
import type { DoctorController } from '@renderer/hooks/doctor'
import { DOCTOR_STATUS_LABEL_KEYS, doctorCheckDetailParams } from '@renderer/utils/doctor'
import type { DoctorCheckId, DoctorCheckResult, DoctorNavigateTarget, DoctorPendingCheck } from '@shared/types/doctor'
import { DOCTOR_CONNECTIVITY_CHECK_IDS } from '@shared/types/doctorConnectivity'
import { doctorCheckDetailKey, doctorCheckTitleKey } from '@shared/utils/doctor'

type DoctorRow = DoctorController['viewModel']['rows'][number]

export function isConnectivityCheckId(id: DoctorCheckId): boolean {
  return (DOCTOR_CONNECTIVITY_CHECK_IDS as readonly DoctorCheckId[]).includes(id)
}

export function actionRequiredRows(controller: DoctorController): DoctorRow[] {
  return controller.viewModel.rows.filter((row) => {
    const result = row.result
    return (
      result &&
      (result.status === 'warn' || result.status === 'fail') &&
      result.attribution === 'user-fixable' &&
      !isConnectivityCheckId(row.id)
    )
  })
}

function actionRequiredNavigateTargets(rows: readonly DoctorRow[]): ReadonlySet<DoctorNavigateTarget> {
  const targets = new Set<DoctorNavigateTarget>()
  for (const row of rows) {
    if (isConnectivityCheckId(row.id)) continue
    const result = row.result
    if (!result || (result.status !== 'warn' && result.status !== 'fail')) continue
    if (result.attribution !== 'user-fixable') continue
    for (const action of row.actions) {
      if (action.kind === 'navigate') targets.add(action.target)
    }
  }
  return targets
}

function withoutCoveredNavigates(row: DoctorRow, covered: ReadonlySet<DoctorNavigateTarget>): DoctorRow {
  const actions = row.actions.filter((action) => action.kind !== 'navigate' || !covered.has(action.target))
  return actions.length === row.actions.length ? row : { ...row, actions }
}

interface ErrorConnectivityStepsProps {
  readonly controller: DoctorController
}

type ConnectivityStepStatus = DoctorController['viewModel']['rows'][number]['status']

interface ConnectivityStep {
  readonly id: (typeof DOCTOR_CONNECTIVITY_CHECK_IDS)[number]
  readonly pending?: DoctorPendingCheck
  readonly result?: DoctorCheckResult
  readonly status: ConnectivityStepStatus
}

function resolveConnectivitySteps(controller: DoctorController): readonly ConnectivityStep[] {
  const { viewModel } = controller
  const rowById = new Map(viewModel.rows.map((row) => [row.id, row]))
  const pendingById = new Map(viewModel.pendingChecks.map((pending) => [pending.checkId, pending]))
  const terminal = viewModel.status === 'completed' || viewModel.status === 'canceled' || viewModel.status === 'failed'

  return DOCTOR_CONNECTIVITY_CHECK_IDS.map((id) => {
    const pending = pendingById.get(id)
    const row = rowById.get(id)
    if (pending) {
      return { id, pending, result: row?.result, status: 'pending' as const }
    }
    if (row) {
      return { id, result: row.result, status: row.status }
    }
    return { id, status: terminal || viewModel.status === 'running' ? ('skip' as const) : ('pending' as const) }
  })
}

function stepDetail(
  t: ReturnType<typeof useTranslation>['t'],
  result: DoctorCheckResult | undefined,
  status: ConnectivityStepStatus,
  pending?: DoctorPendingCheck
): string {
  if (pending) return t(pending.confirmation.messageKey, pending.confirmation.params)
  if (!result) return t(DOCTOR_STATUS_LABEL_KEYS[status])
  if (result.status === 'error') return t('settings.doctor.checks.error')
  if (result.status === 'skip' && 'skippedBy' in result) {
    return t('settings.doctor.checks.skipped', { check: t(doctorCheckTitleKey(result.skippedBy)) })
  }
  if (!result.detail) return t(DOCTOR_STATUS_LABEL_KEYS[result.status])
  return t(doctorCheckDetailKey(result.id, result.detail.variant), doctorCheckDetailParams(t, result.detail.params))
}

function statusTone(status: ConnectivityStepStatus): 'success' | 'error' | 'warning' | 'muted' {
  switch (status) {
    case 'pass':
      return 'success'
    case 'fail':
    case 'error':
      return 'error'
    case 'pending':
    case 'warn':
      return 'warning'
    default:
      return 'muted'
  }
}

const STATUS_BADGE_CLASS = {
  success: 'border-success-border text-success',
  error: 'border-error-border text-error',
  warning: 'border-warning-border text-warning',
  muted: ''
} as const

export function ErrorConnectivitySteps({ controller }: ErrorConnectivityStepsProps) {
  const { t } = useTranslation()
  const { interaction } = controller.session
  const steps = resolveConnectivitySteps(controller)
  const activeIds = new Set(controller.viewModel.activeCheckIds)
  const rowById = new Map(controller.viewModel.rows.map((row) => [row.id, row]))
  const coveredNavigates = actionRequiredNavigateTargets(controller.viewModel.rows)

  return (
    <>
      {steps.map((step) => {
        const tone = statusTone(step.status)
        const detail = stepDetail(t, step.result, step.status, step.pending)
        const row = rowById.get(step.id)
        const actionRow = row ? withoutCoveredNavigates(row, coveredNavigates) : undefined
        return (
          <AccordionItem key={step.id} value={`doctor-${step.id}`} className="px-4">
            <AccordionTrigger className="rounded-none py-3 font-normal hover:bg-transparent focus:bg-transparent focus-visible:bg-transparent">
              <span className="flex min-w-0 items-center gap-2">
                {activeIds.has(step.id) ? (
                  <Loader2 className="text-muted-foreground size-3.5 shrink-0 motion-safe:animate-spin" aria-hidden />
                ) : null}
                <span className="min-w-0 truncate text-xs font-medium">{t(doctorCheckTitleKey(step.id))}</span>
                <Badge variant="outline" className={`shrink-0 text-xs font-normal ${STATUS_BADGE_CLASS[tone]}`}>
                  {t(DOCTOR_STATUS_LABEL_KEYS[step.status])}
                </Badge>
              </span>
            </AccordionTrigger>
            <AccordionContent className="space-y-2 pb-3">
              <p className="min-w-0 break-words text-muted-foreground text-xs">{detail}</p>
              {step.pending ? (
                <div className="flex flex-wrap justify-end gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    loading={interaction.kind === 'confirm-check'}
                    disabled={controller.isInteracting}
                    onClick={() => {
                      const pending = step.pending
                      if (pending) void controller.confirmCheck(pending)
                    }}>
                    {t('settings.doctor.actions.confirm_check')}
                  </Button>
                </div>
              ) : actionRow ? (
                <DoctorCheckActions controller={controller} row={actionRow} />
              ) : null}
            </AccordionContent>
          </AccordionItem>
        )
      })}
    </>
  )
}
