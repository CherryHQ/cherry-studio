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
import type { DoctorController } from '@renderer/hooks/doctor'
import {
  DOCTOR_CHECK_CONTENT,
  DOCTOR_DOMAIN_LABEL_KEYS,
  DOCTOR_FIX_LABEL_KEYS,
  DOCTOR_NAVIGATION_LABEL_KEYS,
  DOCTOR_STATUS_LABEL_KEYS
} from '@renderer/utils/doctor'
import type { DoctorAction, DoctorCheckId, DoctorCheckResult, DoctorFixRequest } from '@shared/types/doctor'
import { ChevronDown, CircleAlert, CircleCheck, CircleDashed, CircleMinus, CircleX } from 'lucide-react'
import { type ReactNode, useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'

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
              <span className="sr-only">
                {t(
                  group.status === 'running'
                    ? DOCTOR_STATUS_LABEL_KEYS.pending
                    : group.status === 'neutral'
                      ? DOCTOR_STATUS_LABEL_KEYS.skip
                      : DOCTOR_STATUS_LABEL_KEYS[group.status]
                )}
              </span>
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

export function DoctorCheckList({ controller }: { readonly controller: DoctorController }) {
  return (
    <div className="divide-y divide-border rounded-xl border border-border px-2">
      {controller.viewModel.rows.map((row) => (
        <DoctorCheckRow key={row.id} controller={controller} row={row} />
      ))}
    </div>
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

  if (interaction.kind === 'confirm-evidence') {
    const { checkId } = interaction
    return (
      <ConfirmationPanel
        title={t('settings.doctor.confirm_evidence.title')}
        description={t('settings.doctor.confirm_evidence.description')}
        confirmLabel={t('settings.doctor.actions.show_details')}
        onCancel={() => {
          onResolve(checkId)
          controller.cancelConfirmation()
        }}
        onConfirm={controller.confirmEvidence}
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
          <div className="grid min-w-0 gap-x-4 gap-y-1 sm:grid-cols-[minmax(0,1fr)_minmax(12rem,45%)] sm:items-start">
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <p className="font-medium text-sm">{t(content.title)}</p>
              <Badge variant="outline" className="font-normal text-xs">
                {t(DOCTOR_STATUS_LABEL_KEYS[row.status])}
              </Badge>
            </div>
            <CheckDescription result={result} align="end" />
          </div>
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
            <DropdownMenu modal={false}>
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
                    disabled={row.actionsDisabled || controller.isInteracting}
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
  const disabled = row.actionsDisabled || controller.isInteracting
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

function CheckDescription({
  align = 'start',
  result
}: {
  readonly align?: 'start' | 'end'
  readonly result?: DoctorCheckResult
}) {
  const { t } = useTranslation()
  const className = `text-muted-foreground text-xs${align === 'end' ? ' sm:text-right' : ''}`
  if (!result) return <p className={className}>{t('settings.doctor.checks.pending')}</p>
  if (result.status === 'error') {
    return <p className={className}>{t('settings.doctor.checks.error')}</p>
  }
  if (result.status === 'skip') {
    return (
      <p className={className}>
        {t('settings.doctor.checks.skipped', { check: t(DOCTOR_CHECK_CONTENT[result.skippedBy].title) })}
      </p>
    )
  }
  if (!result.detail) return <p className={className}>{t(DOCTOR_STATUS_LABEL_KEYS[result.status])}</p>
  const details = DOCTOR_CHECK_CONTENT[result.id].details as Readonly<Record<string, string>>
  return <p className={className}>{t(details[result.detail.variant], result.detail.params)}</p>
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
  onCancel,
  onConfirm,
  title
}: {
  readonly confirmLabel: string
  readonly description: ReactNode
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
        <Button variant="emphasis" onClick={onConfirm}>
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
        <span className="mt-0.5 inline-flex shrink-0 motion-safe:animate-spin" aria-hidden>
          <CircleDashed className="size-4 text-muted-foreground" />
        </span>
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
