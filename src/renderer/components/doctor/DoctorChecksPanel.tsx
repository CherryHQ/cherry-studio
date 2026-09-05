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
  Scrollbar,
  Skeleton
} from '@cherrystudio/ui'
import { DiagnosticsPanel } from '@renderer/components/DiagnosticsPanel'
import type { DoctorController } from '@renderer/hooks/doctor'
import { loggerService } from '@renderer/services/LoggerService'
import { toast } from '@renderer/services/toast'
import { DOCTOR_CHECK_CONTENT, DOCTOR_STATUS_LABEL_KEYS, formatDoctorReportForCopy } from '@renderer/utils/doctor'
import type { DoctorCheckId } from '@shared/types/doctor'
import { ChevronDown, Copy, RotateCcw } from 'lucide-react'
import { useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'

import { DoctorCheckResults, DoctorConfirmationView } from './DoctorCheckResults'
const logger = loggerService.withContext('DoctorChecksPanel')

export function DoctorChecksPanel({ controller }: { readonly controller: DoctorController }) {
  const { t } = useTranslation()
  const { session, viewModel } = controller
  const interaction = session.interaction
  const dataPath = viewModel.report?.basics.userDataPath
  const restoreActionCheckRef = useRef<DoctorCheckId | null>(null)

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

  const copyResults = async () => {
    if (!viewModel.report) return
    try {
      await navigator.clipboard.writeText(
        formatDoctorReportForCopy(viewModel.report, {
          heading: t('settings.doctor.copy.heading'),
          basicsHeading: t('settings.doctor.copy.basics_heading'),
          checksHeading: t('settings.doctor.copy.checks_heading'),
          basics: {
            version: t('settings.doctor.copy.version'),
            edition: t('settings.doctor.copy.edition'),
            channel: t('settings.doctor.copy.channel'),
            system: t('settings.doctor.copy.system'),
            osRelease: t('settings.doctor.copy.os_release'),
            isPackaged: t('settings.doctor.copy.packaged'),
            isPortable: t('settings.doctor.copy.portable')
          },
          runtime: {
            electron: t('settings.doctor.copy.electron'),
            node: t('settings.doctor.copy.node'),
            chrome: t('settings.doctor.copy.chrome'),
            v8: t('settings.doctor.copy.v8')
          },
          title: (id) => t(DOCTOR_CHECK_CONTENT[id].title),
          status: (status) => t(DOCTOR_STATUS_LABEL_KEYS[status]),
          boolean: (value) => t(value ? 'settings.doctor.copy.yes' : 'settings.doctor.copy.no')
        })
      )
      toast.success(t('settings.doctor.messages.copied'))
    } catch (error) {
      logger.error('Failed to copy system diagnostics results', error as Error)
      toast.error(t('settings.doctor.messages.copy_failed'))
    }
  }

  if (interaction.kind === 'confirm-evidence') {
    return (
      <DoctorConfirmationView
        controller={controller}
        onResolve={(checkId) => {
          restoreActionCheckRef.current = checkId
        }}
      />
    )
  }

  return (
    <div className="grid min-h-0 flex-1 grid-rows-[minmax(0,1fr)_auto] gap-0 overflow-hidden">
      <Scrollbar className="min-h-0 px-6 py-2">
        <div className="space-y-4 pb-2">
          <DoctorSummary controller={controller} />

          {viewModel.isStale ? (
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

          {session.relaunchRequired ? (
            <Alert type="info" showIcon description={t('settings.doctor.messages.relaunch_required')} />
          ) : null}

          {viewModel.rows.length > 0 ? (
            <DoctorCheckResults controller={controller} />
          ) : (
            <Alert
              type="info"
              showIcon
              message={t(
                viewModel.status === 'canceled' ? 'settings.doctor.empty.canceled_title' : 'settings.doctor.empty.title'
              )}
              description={t(
                viewModel.status === 'canceled'
                  ? 'settings.doctor.empty.canceled_description'
                  : 'settings.doctor.empty.description'
              )}
              action={
                viewModel.status === 'canceled' ? (
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={controller.isInteracting}
                    onClick={() => void controller.run('quick')}>
                    <RotateCcw className="size-4" aria-hidden />
                    {t('settings.doctor.actions.rerun')}
                  </Button>
                ) : undefined
              }
            />
          )}

          <Accordion type="single" collapsible className="rounded-xl border border-border px-4">
            <AccordionItem value="advanced-tools" className="border-0 first:border-t-0">
              <AccordionTrigger className="py-3 font-medium">{t('settings.doctor.advanced.title')}</AccordionTrigger>
              <AccordionContent className="flex flex-wrap gap-2 pt-0 pb-3">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={controller.isInteracting}
                  onClick={() => void controller.toggleDevTools()}>
                  {t('settings.about.debug.title')}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={controller.isInteracting}
                  onClick={() => void controller.openLogsPath()}>
                  {t('settings.about.diagnostics.sources.logs.title')}
                </Button>
                {dataPath ? (
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={controller.isInteracting}
                    onClick={() => void controller.openPath(dataPath)}>
                    {t('settings.doctor.basics.data_path')}
                  </Button>
                ) : null}
              </AccordionContent>
            </AccordionItem>
          </Accordion>
        </div>
      </Scrollbar>

      <DialogFooter className="border-border border-t px-6 py-4">
        {viewModel.canCancel ? (
          <Button
            variant="outline"
            loading={session.interaction.kind === 'cancel'}
            disabled={
              controller.isInteracting &&
              session.interaction.kind !== 'cancel' &&
              !(session.interaction.kind === 'run' && session.interaction.tier === 'live')
            }
            onClick={() => void controller.cancel()}>
            {t('settings.doctor.actions.cancel_run')}
          </Button>
        ) : null}
        <DropdownMenu modal={false}>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" disabled={!controller.canChangePanel}>
              {t('settings.doctor.actions.more')}
              <ChevronDown className="size-3.5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {viewModel.report ? (
              <DropdownMenuItem onSelect={() => void copyResults()}>
                <Copy className="size-4" />
                {t('settings.doctor.actions.copy')}
              </DropdownMenuItem>
            ) : null}
            <DropdownMenuItem onSelect={() => controller.setPanel('export')}>
              {t('settings.doctor.panels.export')}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <Button
          variant="emphasis"
          loading={session.interaction.kind === 'run' && session.interaction.tier === 'live'}
          disabled={viewModel.status === 'running' || controller.isInteracting || !viewModel.report}
          onClick={() => void controller.run('live')}>
          {t('settings.doctor.actions.run_network')}
        </Button>
      </DialogFooter>
    </div>
  )
}

function DoctorSummary({ controller }: { readonly controller: DoctorController }) {
  const { t } = useTranslation()
  const { appUpdateState, viewModel } = controller
  if (viewModel.status === 'running') {
    const completed = viewModel.rows.filter((row) => row.status !== 'pending').length
    return (
      <DiagnosticsPanel
        role="status"
        aria-live="polite"
        title={t(
          viewModel.tier === 'live' ? 'settings.doctor.summary.running_full' : 'settings.doctor.summary.running_basic'
        )}
        description={t('settings.doctor.summary.progress', { completed, total: viewModel.rows.length })}
        bodyClassName="px-4 pb-4">
        <div className="grid grid-cols-3 gap-2">
          <Skeleton className="h-2" />
          <Skeleton className="h-2" />
          <Skeleton className="h-2" />
        </div>
      </DiagnosticsPanel>
    )
  }

  if (viewModel.report) {
    const { basics } = viewModel.report
    const dataPath = basics.userDataPath
    const summaryItems = [
      ['userFixable', 'settings.doctor.summary.user_fixable'],
      ['appBug', 'settings.doctor.summary.app_bug'],
      ['transient', 'settings.doctor.summary.transient'],
      ['error', 'settings.doctor.summary.error'],
      ['skip', 'settings.doctor.summary.skip']
    ] as const
    const title =
      viewModel.problemCount > 0
        ? t('settings.doctor.summary.problems', { count: viewModel.problemCount })
        : viewModel.summary.error > 0 || viewModel.summary.skip > 0
          ? t('settings.doctor.summary.incomplete')
          : t(
              viewModel.report.tier === 'quick'
                ? 'settings.doctor.summary.basic_healthy'
                : 'settings.doctor.summary.live_healthy'
            )
    return (
      <DiagnosticsPanel
        title={title}
        description={t('settings.doctor.summary.version', { version: viewModel.report.basics.version })}
        actions={
          appUpdateState.downloading ? (
            <Badge variant="outline">
              {t('settings.doctor.actions.downloading_update', {
                progress: Math.round(appUpdateState.downloadProgress)
              })}
            </Badge>
          ) : undefined
        }
        bodyClassName="space-y-4 px-4 pb-4">
        {summaryItems.some(([key]) => viewModel.summary[key] > 0) ? (
          <div className="flex flex-wrap gap-2">
            {summaryItems.map(([key, label]) =>
              viewModel.summary[key] > 0 ? (
                <Badge key={key} variant="outline" className="font-normal">
                  {t(label, { count: viewModel.summary[key] })}
                </Badge>
              ) : null
            )}
          </div>
        ) : null}

        <dl className="grid gap-2 text-xs sm:grid-cols-[auto_minmax(0,1fr)]">
          <dt className="text-muted-foreground">{t('settings.doctor.basics.app')}</dt>
          <dd>
            {basics.version} · {basics.channel}
          </dd>
          <dt className="text-muted-foreground">{t('settings.doctor.basics.system')}</dt>
          <dd>
            {basics.platform} {basics.osRelease} · {basics.arch}
          </dd>
          {dataPath ? (
            <>
              <dt className="text-muted-foreground">{t('settings.doctor.basics.data_path')}</dt>
              <dd className="flex min-w-0 items-center gap-2">
                <span className="selectable min-w-0 flex-1 truncate" title={dataPath}>
                  {dataPath}
                </span>
                <Button
                  variant="link"
                  className="h-auto shrink-0 px-0 py-0 text-xs"
                  disabled={controller.isInteracting}
                  onClick={() => void controller.openPath(dataPath)}>
                  {t('settings.doctor.actions.open_path')}
                </Button>
              </dd>
            </>
          ) : null}
        </dl>
      </DiagnosticsPanel>
    )
  }
  return null
}
