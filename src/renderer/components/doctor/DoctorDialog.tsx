import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, SegmentedControl } from '@cherrystudio/ui'
import type { DiagnosticUploadDialogHandle } from '@renderer/components/feedback/DiagnosticUploadDialog'
import { loggerService } from '@renderer/services/LoggerService'
import { openSettingsTab } from '@renderer/services/mainWindowNavigation'
import { POPUP_EXIT_MS, type PopupInjectedProps } from '@renderer/services/popup'
import { toast } from '@renderer/services/toast'
import type { DoctorNavigateTarget } from '@shared/types/doctor'
import type { UpdateInfo } from 'builder-util-runtime'
import { lazy, Suspense, useCallback, useMemo, useRef } from 'react'
import { useTranslation } from 'react-i18next'

import { DoctorChecksPanel } from './DoctorChecksPanel'
import type { DoctorPanel } from './doctorSessionReducer'
import { useDoctorController } from './useDoctorController'

const DiagnosticBundleDialog = lazy(() => import('@renderer/components/feedback/DiagnosticBundleDialog'))
const DiagnosticUploadDialog = lazy(() =>
  import('@renderer/components/feedback/DiagnosticUploadDialog').then((module) => ({
    default: module.DiagnosticUploadDialog
  }))
)
const logger = loggerService.withContext('DoctorDialog')
const PANEL_DESCRIPTION_KEYS = {
  checks: 'settings.doctor.panel_descriptions.checks',
  export: 'settings.doctor.panel_descriptions.export',
  report: 'settings.doctor.panel_descriptions.report'
} as const satisfies Record<DoctorPanel, string>

export interface DoctorDialogParams {
  readonly initialPanel: DoctorPanel
  readonly initialDescription?: string
}

type DoctorDialogProps = DoctorDialogParams & PopupInjectedProps<Record<string, never>>

export function DoctorDialog({ initialDescription, initialPanel, open, resolve }: DoctorDialogProps) {
  const { t } = useTranslation()
  const reportPanelRef = useRef<DiagnosticUploadDialogHandle>(null)

  const finishHandoff = useCallback(
    async (action: () => void) => {
      if (reportPanelRef.current) {
        const canClose = await reportPanelRef.current.requestClose()
        if (!canClose) return
      } else {
        resolve({})
      }
      window.setTimeout(action, POPUP_EXIT_MS)
    },
    [resolve]
  )

  const navigate = useCallback(
    (target: DoctorNavigateTarget) => void finishHandoff(() => openSettingsTab(target)),
    [finishHandoff]
  )
  const installUpdate = useCallback(
    (releaseInfo: UpdateInfo) => {
      void finishHandoff(() => {
        void import('@renderer/components/UpdateDialogPopup')
          .then(({ default: UpdateDialogPopup }) => UpdateDialogPopup.show({ releaseInfo }))
          .catch((error) => {
            logger.error('Failed to open the update dialog from system diagnostics', error as Error)
            toast.error(t('settings.doctor.messages.action_failed'))
          })
      })
    },
    [finishHandoff, t]
  )
  const controller = useDoctorController({
    initialDescription,
    initialPanel,
    onInstallUpdate: installUpdate,
    onNavigate: navigate
  })
  const { setPanelInteraction } = controller

  const close = useCallback(async () => {
    if (controller.isCloseBlocked) return
    if (reportPanelRef.current) {
      await reportPanelRef.current.requestClose()
      return
    }
    resolve({})
  }, [controller.isCloseBlocked, resolve])

  const setBundleBusy = useCallback(
    (busy: boolean) => setPanelInteraction('bundle-operation', busy),
    [setPanelInteraction]
  )
  const setReportBusy = useCallback(
    (busy: boolean) => setPanelInteraction('report-operation', busy),
    [setPanelInteraction]
  )

  const panelOptions = useMemo(
    () => [
      { value: 'checks' as const, label: t('settings.doctor.panels.checks') },
      { value: 'export' as const, label: t('settings.doctor.panels.export') },
      { value: 'report' as const, label: t('settings.doctor.panels.report') }
    ],
    [t]
  )
  const panelDescription = t(PANEL_DESCRIPTION_KEYS[controller.session.activePanel])

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => !nextOpen && void close()}>
      <DialogContent
        size="xl"
        closeLabel={t('common.close')}
        closeOnOverlayClick={!controller.isCloseBlocked}
        showCloseButton={!controller.isCloseBlocked}
        className="grid h-[min(760px,calc(100vh-2rem))] max-h-[calc(100vh-2rem)] grid-rows-[auto_minmax(0,1fr)] gap-0 overflow-hidden p-0"
        onEscapeKeyDown={(event) => {
          if (controller.isCloseBlocked) event.preventDefault()
        }}>
        <DialogHeader className="gap-3 border-border border-b px-6 pt-6 pr-12 pb-4">
          <div className="space-y-1">
            <DialogTitle>{t('settings.doctor.title')}</DialogTitle>
            <DialogDescription>{panelDescription}</DialogDescription>
          </div>
          <SegmentedControl<DoctorPanel>
            value={controller.session.activePanel}
            options={panelOptions}
            disabled={!controller.canChangePanel}
            onValueChange={controller.setPanel}
            className="w-full"
          />
        </DialogHeader>

        <div hidden={controller.session.activePanel !== 'checks'} className="contents">
          <DoctorChecksPanel controller={controller} />
        </div>

        <Suspense fallback={controller.session.activePanel === 'export' ? <PanelLoading /> : null}>
          <DiagnosticBundleDialog
            appVersion={controller.viewModel.report?.basics.version ?? ''}
            embedded
            open={controller.session.activePanel === 'export'}
            onBusyChange={setBundleBusy}
            onOpenChange={(nextOpen) => !nextOpen && void close()}
          />
        </Suspense>

        <Suspense fallback={controller.session.activePanel === 'report' ? <PanelLoading /> : null}>
          <DiagnosticUploadDialog
            ref={reportPanelRef}
            description={controller.session.descriptionDraft}
            embedded
            open={controller.session.activePanel === 'report'}
            onBusyChange={setReportBusy}
            onDescriptionChange={controller.setDescription}
            onOpenChange={(nextOpen) => !nextOpen && resolve({})}
          />
        </Suspense>
      </DialogContent>
    </Dialog>
  )
}

function PanelLoading() {
  const { t } = useTranslation()
  return (
    <div className="flex min-h-0 flex-1 items-center justify-center text-muted-foreground text-sm" role="status">
      {t('common.loading')}
    </div>
  )
}
