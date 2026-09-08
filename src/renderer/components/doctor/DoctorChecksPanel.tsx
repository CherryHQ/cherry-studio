import { ChevronDown, Copy, Download } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
  Badge,
  Button,
  DialogFooter,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Scrollbar
} from '@cherrystudio/ui'
import { DiagnosticsPanel } from '@renderer/components/DiagnosticsPanel'
import type { DoctorController } from '@renderer/hooks/doctor'
import { loggerService } from '@renderer/services/LoggerService'
import { toast } from '@renderer/services/toast'
import { DOCTOR_STATUS_LABEL_KEYS, formatDoctorReportForCopy } from '@renderer/utils/doctor'
import { doctorCheckTitleKey } from '@shared/utils/doctor'

import { DoctorCheckNotices } from './DoctorCheckNotices'
import { DoctorCheckAccordionItems } from './DoctorCheckResults'

const logger = loggerService.withContext('DoctorChecksPanel')

export function DoctorChecksPanel({ controller }: { readonly controller: DoctorController }) {
  const { t } = useTranslation()
  const { session, viewModel } = controller
  const dataPath = viewModel.report?.basics.userDataPath
  const actionRequiredRows = viewModel.rows.filter((row) => {
    const result = row.result
    return result && (result.status === 'warn' || result.status === 'fail') && result.attribution === 'user-fixable'
  })

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
          title: (id) => t(doctorCheckTitleKey(id)),
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

  return (
    <div className="grid min-h-0 flex-1 grid-rows-[minmax(0,1fr)_auto] gap-0 overflow-hidden">
      <Scrollbar className="min-h-0 px-6 py-2">
        <div className="space-y-4 pb-2">
          <DoctorSummary controller={controller} />

          {viewModel.status === 'completed' && actionRequiredRows.length > 0 ? (
            <DiagnosticsPanel title={t('error.diagnostics.action_required')} variant="sectioned">
              <Accordion
                type="single"
                collapsible
                defaultValue={`doctor-${actionRequiredRows[0].id}`}
                className="[&>[data-slot=accordion-item]:first-child]:border-t-0">
                <DoctorCheckAccordionItems
                  compact
                  defaultLocalDetailsExpanded
                  controller={controller}
                  rows={actionRequiredRows}
                />
              </Accordion>
            </DiagnosticsPanel>
          ) : null}
          {viewModel.status !== 'completed' && viewModel.status !== 'running' ? (
            <DoctorCheckNotices controller={controller} />
          ) : null}

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

      <DialogFooter className="px-6 py-4">
        {viewModel.canCancel ? (
          <Button
            variant="outline"
            loading={session.interaction.kind === 'cancel'}
            disabled={
              controller.isInteracting &&
              session.interaction.kind !== 'cancel' &&
              !(session.interaction.kind === 'run' && viewModel.canCancel)
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
          <DropdownMenuContent align="end" side="top">
            {viewModel.report ? (
              <DropdownMenuItem onSelect={() => void copyResults()}>
                <Copy className="size-4" />
                {t('settings.doctor.actions.copy')}
              </DropdownMenuItem>
            ) : null}
            <DropdownMenuItem onSelect={() => controller.setPanel('export')}>
              <Download className="size-4" />
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
  const { appUpdateState, session, viewModel } = controller
  if (viewModel.status === 'running') {
    const completed = viewModel.rows.filter((row) => row.status !== 'pending').length
    const activeCheckId = viewModel.activeCheckIds[0]
    const progress = activeCheckId
      ? t('error.diagnostics.checking_progress', {
          check: t(doctorCheckTitleKey(activeCheckId)),
          completed,
          total: viewModel.rows.length
        })
      : t('settings.doctor.summary.progress', { completed, total: viewModel.rows.length })
    return <DiagnosticsPanel role="status" aria-live="polite" title={progress} />
  }

  if (viewModel.report) {
    const summary =
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
        variant="sectioned"
        title={t('error.diagnostics.result')}
        actions={
          appUpdateState.downloading ? (
            <Badge variant="outline">
              {t('settings.doctor.actions.downloading_update', {
                progress: Math.round(appUpdateState.downloadProgress)
              })}
            </Badge>
          ) : undefined
        }
        bodyClassName="space-y-3 px-4 py-3">
        <p className="flex flex-wrap gap-x-3 gap-y-1 text-xs leading-5">
          <span className="text-success">
            {t('settings.doctor.summary.fixed', { count: session.fixedCheckIds.length })}
          </span>
          <span className="text-warning">
            {t('settings.doctor.summary.needs_attention', { count: viewModel.problemCount })}
          </span>
          <span className="text-muted-foreground">{summary}</span>
        </p>
        <DoctorCheckNotices controller={controller} />
      </DiagnosticsPanel>
    )
  }
  return null
}
