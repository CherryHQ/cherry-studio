import { ChevronDown, Copy, Download, FileText, FolderOpen, Terminal } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import {
  Accordion,
  Button,
  DialogFooter,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Scrollbar
} from '@cherrystudio/ui'
import type { DoctorController } from '@renderer/hooks/doctor'
import { loggerService } from '@renderer/services/LoggerService'
import { toast } from '@renderer/services/toast'
import { DOCTOR_STATUS_LABEL_KEYS, formatDoctorReportForCopy } from '@renderer/utils/doctor'
import { doctorCheckTitleKey } from '@shared/utils/doctor'

import { DoctorCheckAccordionItems } from './DoctorCheckAccordionItems'
import { DoctorCheckNotices } from './DoctorCheckNotices'

const logger = loggerService.withContext('DoctorChecksPanel')

const CHECK_STATUS_PRIORITY = { fail: 0, error: 0, warn: 1, pending: 2, skip: 2, pass: 2 }

export function DoctorChecksPanel({ controller }: { readonly controller: DoctorController }) {
  const { t } = useTranslation()
  const { session, viewModel } = controller
  const dataPath = viewModel.report?.basics.userDataPath
  const sortedRows = viewModel.rows.toSorted(
    (a, b) => CHECK_STATUS_PRIORITY[a.status] - CHECK_STATUS_PRIORITY[b.status]
  )
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
          {viewModel.status !== 'running' ? <DoctorCheckNotices controller={controller} /> : null}

          {viewModel.rows.length > 0 ? (
            <Accordion
              type="single"
              collapsible
              role="region"
              aria-label={t('settings.doctor.copy.checks_heading')}
              className="min-w-0 overflow-hidden rounded-xl border border-border bg-background [&>[data-slot=accordion-item]:first-child]:border-t-0">
              <DoctorCheckAccordionItems
                compact
                defaultLocalDetailsExpanded
                controller={controller}
                rows={sortedRows}
              />
            </Accordion>
          ) : null}
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
            <DropdownMenuSeparator />
            <DropdownMenuItem disabled={controller.isInteracting} onSelect={() => void controller.toggleDevTools()}>
              <Terminal className="size-4" />
              {t('settings.about.debug.title')}
            </DropdownMenuItem>
            <DropdownMenuItem disabled={controller.isInteracting} onSelect={() => void controller.openLogsPath()}>
              <FileText className="size-4" />
              {t('settings.about.diagnostics.sources.logs.title')}
            </DropdownMenuItem>
            {dataPath ? (
              <DropdownMenuItem disabled={controller.isInteracting} onSelect={() => void controller.openPath(dataPath)}>
                <FolderOpen className="size-4" />
                {t('settings.doctor.basics.data_path')}
              </DropdownMenuItem>
            ) : null}
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
