import { Button, Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@cherrystudio/ui'
import type { DiagnosticUploadPanelHandle } from '@renderer/components/feedback/DiagnosticUploadPanel'
import { useDoctorController } from '@renderer/hooks/doctor'
import { openSettingsTab } from '@renderer/services/mainWindowNavigation'
import { POPUP_EXIT_MS, type PopupInjectedProps } from '@renderer/services/popup'
import type { DoctorNavigateTarget, DoctorPanel } from '@shared/types/doctor'
import { ArrowLeft } from 'lucide-react'
import { lazy, Suspense, useCallback, useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'

import { DoctorChecksPanel } from './DoctorChecksPanel'

const DiagnosticBundlePanel = lazy(() => import('@renderer/components/feedback/DiagnosticBundlePanel'))
const DiagnosticUploadPanel = lazy(() =>
  import('@renderer/components/feedback/DiagnosticUploadPanel').then((module) => ({
    default: module.DiagnosticUploadPanel
  }))
)
const PANEL_DESCRIPTION_KEYS = {
  checks: 'settings.doctor.panel_descriptions.checks',
  export: 'settings.doctor.panel_descriptions.export',
  report: 'settings.doctor.panel_descriptions.report'
} as const satisfies Record<DoctorPanel, string>
const PANEL_TITLE_KEYS = {
  checks: 'settings.doctor.title',
  export: 'settings.doctor.panels.export',
  report: 'settings.doctor.panels.report'
} as const satisfies Record<DoctorPanel, string>

export interface DoctorDialogParams {
  readonly initialPanel: DoctorPanel
  readonly initialDescription?: string
}

type DoctorDialogProps = DoctorDialogParams & PopupInjectedProps<Record<string, never>>

export function DoctorDialog({ initialDescription, initialPanel, open, resolve }: DoctorDialogProps) {
  const { t } = useTranslation()
  const reportPanelRef = useRef<DiagnosticUploadPanelHandle>(null)
  const panelHeadingRef = useRef<HTMLDivElement>(null)
  const canReturnToChecks = initialPanel === 'checks'

  const finishHandoff = useCallback(
    async (action: () => void) => {
      if (reportPanelRef.current) {
        const canClose = await reportPanelRef.current.requestClose()
        if (!canClose) return
      }
      resolve({})
      window.setTimeout(action, POPUP_EXIT_MS)
    },
    [resolve]
  )

  const navigate = useCallback(
    (target: DoctorNavigateTarget) => void finishHandoff(() => openSettingsTab(target)),
    [finishHandoff]
  )
  const controller = useDoctorController({
    initialDescription,
    initialPanel,
    onNavigate: navigate
  })
  const { setPanelInteraction } = controller

  const close = useCallback(async () => {
    if (controller.isCloseBlocked) return
    if (reportPanelRef.current) {
      const canClose = await reportPanelRef.current.requestClose()
      if (!canClose) return
    }
    resolve({})
  }, [controller.isCloseBlocked, resolve])

  const returnToChecks = useCallback(async () => {
    if (!controller.canChangePanel) return
    if (controller.session.activePanel === 'report' && reportPanelRef.current) {
      const canClose = await reportPanelRef.current.requestClose()
      if (canClose) controller.setPanel('checks')
      return
    }
    controller.setPanel('checks')
  }, [controller])

  const setBundleBusy = useCallback(
    (busy: boolean) => setPanelInteraction('bundle-operation', busy),
    [setPanelInteraction]
  )
  const setReportBusy = useCallback(
    (busy: boolean) => setPanelInteraction('report-operation', busy),
    [setPanelInteraction]
  )
  const finishSecondaryPanel = useCallback(() => {
    if (canReturnToChecks) {
      controller.setPanel('checks')
      return
    }
    resolve({})
  }, [canReturnToChecks, controller, resolve])

  const panelTitle = t(PANEL_TITLE_KEYS[controller.session.activePanel])
  const panelDescription = t(PANEL_DESCRIPTION_KEYS[controller.session.activePanel])

  useEffect(() => {
    panelHeadingRef.current?.focus()
  }, [controller.session.activePanel])

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => !nextOpen && void close()}>
      <DialogContent
        size="xl"
        closeLabel={t('common.close')}
        closeOnOverlayClick={!controller.isCloseBlocked}
        showCloseButton={!controller.isCloseBlocked}
        className="grid max-h-[calc(100vh-2rem)] grid-rows-[auto_minmax(0,1fr)] gap-0 overflow-hidden p-0"
        onEscapeKeyDown={(event) => {
          if (controller.isCloseBlocked) event.preventDefault()
        }}>
        <DialogHeader className="flex-row items-start gap-3 border-border border-b px-6 pt-6 pr-12 pb-4">
          {controller.session.activePanel !== 'checks' && canReturnToChecks ? (
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label={t('settings.doctor.actions.back_to_checks')}
              disabled={!controller.canChangePanel}
              onClick={() => void returnToChecks()}>
              <ArrowLeft className="size-4" aria-hidden />
            </Button>
          ) : null}
          <div ref={panelHeadingRef} tabIndex={-1} className="min-w-0 flex-1 space-y-1">
            <DialogTitle>{panelTitle}</DialogTitle>
            <DialogDescription>{panelDescription}</DialogDescription>
          </div>
        </DialogHeader>

        <div hidden={controller.session.activePanel !== 'checks'} className="contents">
          <DoctorChecksPanel controller={controller} />
        </div>

        {controller.session.activePanel === 'export' ? (
          <Suspense fallback={<PanelLoading />}>
            <DiagnosticBundlePanel
              appVersion={controller.viewModel.report?.basics.version ?? ''}
              onBusyChange={setBundleBusy}
              onClose={finishSecondaryPanel}
            />
          </Suspense>
        ) : null}

        {controller.session.activePanel === 'report' ? (
          <Suspense fallback={<PanelLoading />}>
            <DiagnosticUploadPanel
              ref={reportPanelRef}
              description={controller.session.descriptionDraft}
              onBusyChange={setReportBusy}
              onDescriptionChange={controller.setDescription}
              onClose={finishSecondaryPanel}
            />
          </Suspense>
        ) : null}
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
