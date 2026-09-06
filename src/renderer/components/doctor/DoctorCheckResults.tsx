import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
  Alert,
  Badge,
  Button,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogTitle,
  DialogTrigger,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Scrollbar
} from '@cherrystudio/ui'
import type { DoctorController } from '@renderer/hooks/doctor'
import {
  defaultExpandedDoctorDomains,
  DOCTOR_CHECK_CONTENT,
  DOCTOR_DOMAIN_LABEL_KEYS,
  DOCTOR_FIX_LABEL_KEYS,
  DOCTOR_NAVIGATION_LABEL_KEYS,
  DOCTOR_STATUS_LABEL_KEYS,
  isDoctorRowExpandedByDefault
} from '@renderer/utils/doctor'
import type { DoctorAction, DoctorCheckId, DoctorCheckResult, DoctorFixRequest } from '@shared/types/doctor'
import { ChevronDown, CircleAlert, CircleCheck, CircleDashed, CircleMinus, CircleX } from 'lucide-react'
import { type ReactNode, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

export function DoctorCheckResults({ controller }: { readonly controller: DoctorController }) {
  const { t } = useTranslation()
  const { viewModel } = controller
  const defaultExpandedDomains = defaultExpandedDoctorDomains(viewModel.groups)

  return (
    <Accordion
      key={viewModel.report?.runId ?? `${viewModel.status}-${viewModel.tier ?? 'none'}`}
      type="multiple"
      defaultValue={[...defaultExpandedDomains]}
      className="rounded-xl border border-border px-4 [&>[data-slot=accordion-item]:first-child]:border-t-0">
      {viewModel.groups.map((group) => {
        const defaultRow = group.rows.find(isDoctorRowExpandedByDefault)

        return (
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
            <AccordionContent className="pb-3">
              <Accordion
                type="single"
                collapsible
                defaultValue={`doctor-${defaultRow?.id ?? group.rows[0]?.id}`}
                className="rounded-lg border border-border px-2 [&>[data-slot=accordion-item]:first-child]:border-t-0">
                <DoctorCheckList controller={controller} rows={group.rows} />
              </Accordion>
            </AccordionContent>
          </AccordionItem>
        )
      })}
    </Accordion>
  )
}

export function DoctorCheckList({
  controller,
  rows = controller.viewModel.rows
}: {
  readonly controller: DoctorController
  readonly rows?: DoctorController['viewModel']['rows']
}) {
  return (
    <>
      {rows.map((row) => (
        <DoctorCheckListItem key={row.id} controller={controller} row={row} />
      ))}
    </>
  )
}

function DoctorCheckListItem({
  controller,
  row
}: {
  readonly controller: DoctorController
  readonly row: DoctorController['viewModel']['rows'][number]
}) {
  const { t } = useTranslation()
  const content = DOCTOR_CHECK_CONTENT[row.id]

  return (
    <AccordionItem value={`doctor-${row.id}`} className="px-2">
      <AccordionTrigger className="py-3 font-normal">
        <span className="flex min-w-0 items-center gap-2">
          <StatusIcon status={row.status} />
          <span className="min-w-0 truncate font-medium text-sm">{t(content.title)}</span>
          <Badge variant="outline" className="shrink-0 font-normal text-xs">
            {t(DOCTOR_STATUS_LABEL_KEYS[row.status])}
          </Badge>
        </span>
      </AccordionTrigger>
      <AccordionContent className="space-y-2 pb-3 pl-6">
        <CheckDescription result={row.result} />
        <DoctorCheckEvidence controller={controller} row={row} />
        <DoctorCheckActions controller={controller} row={row} className="flex flex-wrap justify-end gap-2" />
      </AccordionContent>
    </AccordionItem>
  )
}

function DoctorCheckEvidence({
  controller,
  row
}: {
  readonly controller: DoctorController
  readonly row: DoctorController['viewModel']['rows'][number]
}) {
  const { t } = useTranslation()
  const result = row.result
  const isEvidenceRevealed = controller.session.revealedEvidence.includes(row.id)
  const publicEvidence = result?.evidence?.filter((item) => item.dataClass === 'public') ?? []
  const localEvidence = result?.evidence?.filter((item) => item.dataClass === 'local_only') ?? []
  const sensitiveEvidence = result?.evidence?.filter((item) => item.dataClass === 'consent_required') ?? []
  const sensitiveEvidenceRef = useRef<HTMLDListElement>(null)
  const evidenceItemValue = `doctor-evidence-${row.id}`
  const [isEvidenceExpanded, setIsEvidenceExpanded] = useState(isEvidenceRevealed)
  const isConfirming =
    controller.session.interaction.kind === 'confirm-evidence' && controller.session.interaction.checkId === row.id

  useEffect(() => {
    if (isEvidenceRevealed) sensitiveEvidenceRef.current?.focus()
  }, [isEvidenceRevealed])

  return (
    <>
      {publicEvidence.length > 0 ? (
        <dl className="selectable grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 pt-1 text-xs">
          {publicEvidence.map((item) => (
            <Evidence key={`${item.key}-${String(item.value)}`} name={item.key} value={String(item.value)} />
          ))}
        </dl>
      ) : null}
      {localEvidence.length > 0 || sensitiveEvidence.length > 0 ? (
        <Accordion
          type="single"
          collapsible
          value={isEvidenceExpanded ? evidenceItemValue : ''}
          onValueChange={(value) => setIsEvidenceExpanded(value === evidenceItemValue)}
          className="pt-1 text-xs">
          <AccordionItem value={evidenceItemValue} className="border-0 first:border-t-0">
            <AccordionTrigger className="py-1 font-normal text-muted-foreground text-xs">
              {t('settings.doctor.evidence.local_details')}
            </AccordionTrigger>
            <AccordionContent className="pb-0">
              <dl
                ref={sensitiveEvidenceRef}
                tabIndex={isEvidenceRevealed ? -1 : undefined}
                className="selectable grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-xs">
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
                <Dialog
                  open={isConfirming}
                  onOpenChange={(open) => {
                    if (!open && isConfirming) controller.cancelConfirmation()
                  }}>
                  <DialogTrigger asChild>
                    <Button
                      variant="link"
                      className="mt-2 h-auto px-0 py-0 text-xs"
                      onClick={() => controller.requestEvidence(row.id)}>
                      {t('settings.doctor.actions.show_details')}
                    </Button>
                  </DialogTrigger>
                  <DialogContent
                    aria-describedby={undefined}
                    closeOnOverlayClick={false}
                    showCloseButton={false}
                    className="max-h-[calc(100vh-2rem)] gap-0 overflow-hidden p-0 sm:max-w-xl">
                    <DialogTitle className="sr-only">{t('settings.doctor.confirm_evidence.title')}</DialogTitle>
                    <ConfirmationPanel
                      title={t('settings.doctor.confirm_evidence.title')}
                      description={t('settings.doctor.confirm_evidence.description')}
                      confirmLabel={t('settings.doctor.actions.show_details')}
                      onCancel={controller.cancelConfirmation}
                      onConfirm={controller.confirmEvidence}
                    />
                  </DialogContent>
                </Dialog>
              ) : null}
            </AccordionContent>
          </AccordionItem>
        </Accordion>
      ) : null}
    </>
  )
}

function DoctorCheckActions({
  className,
  controller,
  row
}: {
  readonly className: string
  readonly controller: DoctorController
  readonly row: DoctorController['viewModel']['rows'][number]
}) {
  const { t } = useTranslation()
  const runId = controller.viewModel.report?.runId
  const primaryAction = row.actions[0]

  if (!primaryAction) return null

  return (
    <div className={className}>
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
      onClick={() => void controller.executeAction(row.id, action, runId)}>
      {actionLabel(t, controller, row.id, action)}
    </Button>
  )
}

function CheckDescription({ result }: { readonly result?: DoctorCheckResult }) {
  const { t } = useTranslation()
  const className = 'min-w-0 break-words text-muted-foreground text-xs'
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
