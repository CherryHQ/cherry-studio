import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
  Alert,
  Badge,
  Button,
  DialogFooter,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Scrollbar
} from '@cherrystudio/ui'
import { formatDiagnosticBytes } from '@renderer/utils/diagnosticSourceSummary'
import type { DoctorAction, DoctorCheckId, DoctorCheckResult, DoctorFixRequest } from '@shared/types/doctor'
import { ChevronDown, CircleAlert, CircleCheck, CircleDashed, CircleMinus, CircleX } from 'lucide-react'
import { type ReactNode, useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'

import {
  DOCTOR_CHECK_CONTENT,
  DOCTOR_DOMAIN_LABEL_KEYS,
  DOCTOR_FIX_LABEL_KEYS,
  DOCTOR_NAVIGATION_LABEL_KEYS,
  DOCTOR_STATUS_LABEL_KEYS
} from './doctorContent'
import type { DoctorController } from './useDoctorController'

const CONFIRM_FIX_CONTENT = {
  'storage-diagnostic-data-size': {
    evidenceKey: 'bytes',
    scopeKey: 'settings.doctor.confirm_fix.diagnostic_data_scope'
  },
  'storage-disk-space': {
    evidenceKey: 'reclaimableBytes',
    scopeKey: 'settings.doctor.confirm_fix.storage_disk_space_scope'
  }
} as const

type ConfirmFixCheckId = keyof typeof CONFIRM_FIX_CONTENT

export function DoctorCheckResults({ controller }: { readonly controller: DoctorController }) {
  const { t } = useTranslation()
  const { session, viewModel } = controller

  return (
    <Accordion
      type="multiple"
      value={[...session.expandedDomains]}
      onValueChange={(values) => controller.setExpandedDomains(values as typeof session.expandedDomains)}
      className="rounded-xl border border-border px-4">
      {viewModel.groups.map((group) => (
        <AccordionItem key={group.domain} value={group.domain}>
          <AccordionTrigger className="py-3">
            <span className="flex min-w-0 items-center gap-2">
              <StatusIcon status={group.status} />
              <span>{t(DOCTOR_DOMAIN_LABEL_KEYS[group.domain])}</span>
              <Badge variant="outline" className="font-normal text-xs">
                {group.rows.length}
              </Badge>
            </span>
          </AccordionTrigger>
          <AccordionContent className="space-y-1 pt-0 pb-3">
            {group.rows.map((row) => (
              <DoctorCheckRow key={row.id} controller={controller} row={row} />
            ))}
          </AccordionContent>
        </AccordionItem>
      ))}
    </Accordion>
  )
}

export function DoctorConfirmationView({
  controller,
  onResolve
}: {
  readonly controller: DoctorController
  readonly onResolve: (checkId: DoctorCheckId) => void
}) {
  const { t } = useTranslation()
  const { interaction } = controller.session

  if (interaction.kind === 'confirm-fix') {
    const { checkId } = interaction.request
    const affectedResult = controller.viewModel.rows.find((row) => row.id === checkId)?.result
    return (
      <ConfirmationPanel
        title={t('settings.doctor.confirm_fix.title')}
        description={<FixConfirmationDescription checkId={checkId} result={affectedResult} />}
        confirmLabel={fixLabel(t, interaction.request, controller.mcpServerName(interaction.request.target))}
        destructive
        onCancel={() => {
          onResolve(checkId)
          controller.cancelFixConfirmation()
        }}
        onConfirm={() => {
          onResolve(checkId)
          void controller.confirmFix()
        }}
      />
    )
  }

  if (interaction.kind === 'confirm-evidence') {
    const { checkId } = interaction
    return (
      <ConfirmationPanel
        title={t('settings.doctor.confirm_evidence.title')}
        description={t('settings.doctor.confirm_evidence.description')}
        confirmLabel={t('settings.doctor.actions.show_details')}
        onCancel={() => {
          onResolve(checkId)
          controller.cancelFixConfirmation()
        }}
        onConfirm={() => {
          onResolve(checkId)
          controller.confirmEvidence()
        }}
      />
    )
  }

  return null
}

function DoctorCheckRow({
  controller,
  row
}: {
  readonly controller: DoctorController
  readonly row: DoctorController['viewModel']['rows'][number]
}) {
  const { t } = useTranslation()
  const result = row.result
  const content = DOCTOR_CHECK_CONTENT[row.id]
  const isEvidenceRevealed = controller.session.revealedEvidence.includes(row.id)
  const publicEvidence = result?.evidence?.filter((item) => item.dataClass === 'public') ?? []
  const localEvidence = result?.evidence?.filter((item) => item.dataClass === 'local_only') ?? []
  const sensitiveEvidence = result?.evidence?.filter((item) => item.dataClass === 'consent_required') ?? []
  const runId = controller.viewModel.report?.runId
  const primaryAction = row.actions[0]
  const sensitiveEvidenceRef = useRef<HTMLDListElement>(null)

  useEffect(() => {
    if (isEvidenceRevealed) sensitiveEvidenceRef.current?.focus()
  }, [isEvidenceRevealed])

  return (
    <div className="rounded-lg px-2 py-3 hover:bg-accent/40">
      <div className="flex items-start gap-3">
        <StatusIcon status={row.status} />
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="font-medium text-sm">{t(content.title)}</p>
            <Badge variant="outline" className="font-normal text-xs">
              {t(DOCTOR_STATUS_LABEL_KEYS[row.status])}
            </Badge>
          </div>
          <CheckDescription result={result} />
          {publicEvidence.length > 0 ? (
            <dl className="selectable grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 pt-1 text-xs">
              {publicEvidence.map((item) => (
                <Evidence key={`${item.key}-${String(item.value)}`} name={item.key} value={String(item.value)} />
              ))}
            </dl>
          ) : null}
          {localEvidence.length > 0 || sensitiveEvidence.length > 0 ? (
            <details className="pt-1 text-xs" open={isEvidenceRevealed || undefined}>
              <summary className="cursor-pointer text-muted-foreground">
                {t('settings.doctor.evidence.local_details')}
              </summary>
              <dl
                ref={sensitiveEvidenceRef}
                tabIndex={isEvidenceRevealed ? -1 : undefined}
                className="selectable mt-2 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1">
                {localEvidence.map((item) => (
                  <Evidence
                    key={`${item.key}-${String(item.value)}`}
                    name={`${item.key} · ${t('settings.doctor.evidence.local_only')}`}
                    value={String(item.value)}
                  />
                ))}
                {sensitiveEvidence.map((item) => (
                  <Evidence
                    key={`${item.key}-${String(item.value)}`}
                    name={`${item.key} · ${t('settings.doctor.evidence.consent_required')}`}
                    value={isEvidenceRevealed ? String(item.value) : '••••••'}
                  />
                ))}
              </dl>
              {sensitiveEvidence.length > 0 && !isEvidenceRevealed ? (
                <Button
                  variant="link"
                  className="mt-2 h-auto px-0 py-0 text-xs"
                  data-doctor-evidence-trigger={row.id}
                  onClick={() => controller.requestEvidence(row.id)}>
                  {t('settings.doctor.actions.show_details')}
                </Button>
              ) : null}
            </details>
          ) : null}
        </div>
      </div>
      {primaryAction ? (
        <div className="mt-2 flex flex-wrap justify-end gap-2 pl-7">
          <DoctorActionButton controller={controller} row={row} action={primaryAction} primary runId={runId} />
          {row.actions.length > 1 ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" disabled={row.actionsDisabled || controller.isInteracting}>
                  {t('settings.doctor.actions.more')}
                  <ChevronDown className="size-3.5" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {row.actions.slice(1).map((action, index) => (
                  <DropdownMenuItem
                    key={`${action.kind}-${index}`}
                    disabled={
                      row.actionsDisabled ||
                      controller.isInteracting ||
                      (action.kind === 'install_update' && !controller.appUpdateState.downloaded)
                    }
                    onSelect={() => void controller.executeAction(row.id, action, runId)}>
                    {actionLabel(t, controller, row.id, action)}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

function DoctorActionButton({
  action,
  controller,
  primary,
  row,
  runId
}: {
  readonly action: DoctorAction
  readonly controller: DoctorController
  readonly primary?: boolean
  readonly row: DoctorController['viewModel']['rows'][number]
  readonly runId?: string
}) {
  const { t } = useTranslation()
  const disabled =
    row.actionsDisabled ||
    controller.isInteracting ||
    (action.kind === 'install_update' && !controller.appUpdateState.downloaded)
  const loading =
    (controller.session.interaction.kind === 'fixing' && controller.session.interaction.request.checkId === row.id) ||
    (controller.session.interaction.kind === 'action' && controller.session.interaction.checkId === row.id)
  return (
    <Button
      variant={primary ? 'emphasis' : 'outline'}
      size="sm"
      loading={loading}
      disabled={disabled}
      data-doctor-action-check={row.id}
      onClick={() => void controller.executeAction(row.id, action, runId)}>
      {actionLabel(t, controller, row.id, action)}
    </Button>
  )
}

function CheckDescription({ result }: { readonly result?: DoctorCheckResult }) {
  const { t } = useTranslation()
  if (!result) return <p className="text-muted-foreground text-xs">{t('settings.doctor.checks.pending')}</p>
  if (result.status === 'error') {
    return <p className="text-muted-foreground text-xs">{t('settings.doctor.checks.error')}</p>
  }
  if (result.status === 'skip') {
    return (
      <p className="text-muted-foreground text-xs">
        {t('settings.doctor.checks.skipped', { check: t(DOCTOR_CHECK_CONTENT[result.skippedBy].title) })}
      </p>
    )
  }
  if (!result.detail) return null
  const details = DOCTOR_CHECK_CONTENT[result.id].details as Readonly<Record<string, string>>
  return <p className="text-muted-foreground text-xs">{t(details[result.detail.variant], result.detail.params)}</p>
}

function FixConfirmationDescription({
  checkId,
  result
}: {
  readonly checkId: DoctorFixRequest['checkId']
  readonly result?: DoctorCheckResult
}) {
  const { t } = useTranslation()
  if (!isConfirmFixCheckId(checkId)) {
    throw new Error(`Missing confirmation content for Doctor fix: ${checkId}`)
  }
  const content = CONFIRM_FIX_CONTENT[checkId]
  const evidence = result?.evidence?.find(
    (item) => item.key === content.evidenceKey && item.dataClass === 'public' && typeof item.value === 'number'
  )
  const estimatedBytes =
    typeof evidence?.value === 'number' && Number.isFinite(evidence.value) && evidence.value >= 0
      ? evidence.value
      : undefined

  return (
    <div className="space-y-3">
      <dl className="grid gap-2 text-xs sm:grid-cols-[auto_minmax(0,1fr)]">
        <dt className="text-muted-foreground">{t('settings.doctor.confirm_fix.scope')}</dt>
        <dd>{t(content.scopeKey)}</dd>
        <dt className="text-muted-foreground">{t('settings.doctor.confirm_fix.reclaimable_label')}</dt>
        <dd>
          {estimatedBytes === undefined
            ? t('settings.doctor.confirm_fix.reclaimable_unavailable')
            : t('settings.doctor.confirm_fix.reclaimable', { size: formatDiagnosticBytes(estimatedBytes) })}
        </dd>
        <dt className="text-muted-foreground">{t('settings.doctor.confirm_fix.irreversible_label')}</dt>
        <dd>{t('settings.doctor.confirm_fix.irreversible')}</dd>
        <dt className="text-muted-foreground">{t('settings.doctor.confirm_fix.duration_label')}</dt>
        <dd>{t('settings.doctor.confirm_fix.duration')}</dd>
      </dl>
      <CheckDescription result={result} />
    </div>
  )
}

function isConfirmFixCheckId(checkId: DoctorFixRequest['checkId']): checkId is ConfirmFixCheckId {
  return Object.hasOwn(CONFIRM_FIX_CONTENT, checkId)
}

function Evidence({ name, value }: { readonly name: string; readonly value: string }) {
  return (
    <>
      <dt className="text-muted-foreground">{name}</dt>
      <dd className="min-w-0 break-words">{value}</dd>
    </>
  )
}

function ConfirmationPanel({
  confirmLabel,
  description,
  destructive = false,
  onCancel,
  onConfirm,
  title
}: {
  readonly confirmLabel: string
  readonly description: ReactNode
  readonly destructive?: boolean
  readonly onCancel: () => void
  readonly onConfirm: () => void
  readonly title: string
}) {
  const { t } = useTranslation()
  const focusRef = useRef<HTMLDivElement>(null)

  useEffect(() => focusRef.current?.focus(), [])

  return (
    <div ref={focusRef} tabIndex={-1} className="grid min-h-0 flex-1 grid-rows-[minmax(0,1fr)_auto]">
      <Scrollbar className="min-h-0 px-6 py-4">
        <Alert type="warning" showIcon message={title} description={description} />
      </Scrollbar>
      <DialogFooter className="border-border border-t px-6 py-4">
        <Button variant="outline" onClick={onCancel}>
          {t('common.cancel')}
        </Button>
        <Button variant={destructive ? 'destructive' : 'emphasis'} onClick={onConfirm}>
          {confirmLabel}
        </Button>
      </DialogFooter>
    </div>
  )
}

function fixLabel(
  t: ReturnType<typeof useTranslation>['t'],
  request: DoctorFixRequest,
  mcpServerName?: string
): string {
  const labels = DOCTOR_FIX_LABEL_KEYS[request.checkId] as Readonly<Record<string, string>>
  if (request.checkId === 'mcp-servers-connected' && !mcpServerName) {
    return t('settings.doctor.fixes.restart_mcp_generic')
  }
  return t(labels[request.fixId], mcpServerName ? { name: mcpServerName } : undefined)
}

function actionLabel(
  t: ReturnType<typeof useTranslation>['t'],
  controller: DoctorController,
  checkId: DoctorCheckId,
  action: DoctorAction
): string {
  switch (action.kind) {
    case 'fix':
      return fixLabel(
        t,
        {
          runId: '',
          checkId,
          fixId: action.fixId,
          ...(action.target ? { target: action.target } : {})
        } as DoctorFixRequest,
        controller.mcpServerName(action.target)
      )
    case 'navigate':
      return t(DOCTOR_NAVIGATION_LABEL_KEYS[action.target])
    case 'open_path':
      return t('settings.doctor.actions.open_path')
    case 'open_external':
      return t('settings.doctor.actions.open_link')
    case 'open_cherry_account':
      return t('settings.doctor.actions.sign_in')
    case 'install_update':
      return controller.appUpdateState.downloading
        ? t('settings.doctor.actions.downloading_update', {
            progress: Math.round(controller.appUpdateState.downloadProgress)
          })
        : t('settings.doctor.actions.install_update')
    case 'relaunch':
      return t('settings.doctor.actions.relaunch')
    case 'report':
      return t('settings.doctor.actions.report_problem')
    default:
      return assertNever(action)
  }
}

function StatusIcon({ status }: { readonly status: string }): ReactNode {
  switch (status) {
    case 'pass':
      return <CircleCheck className="mt-0.5 size-4 shrink-0 text-success" aria-hidden />
    case 'warn':
      return <CircleAlert className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
    case 'fail':
    case 'error':
      return <CircleX className="mt-0.5 size-4 shrink-0 text-error" aria-hidden />
    case 'pending':
    case 'running':
      return (
        <CircleDashed className="mt-0.5 size-4 shrink-0 text-muted-foreground motion-safe:animate-spin" aria-hidden />
      )
    case 'skip':
    case 'neutral':
      return <CircleMinus className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
    default:
      return null
  }
}

function assertNever(value: never): never {
  throw new Error(`Unhandled Doctor action: ${JSON.stringify(value)}`)
}
