import { Package, Play } from 'lucide-react'
import type { FC } from 'react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button, Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@cherrystudio/ui'
import { loggerService } from '@logger'
import { useOptionalRightPanelActions } from '@renderer/components/chat/panes/Shell'
import { InstallConsentDialog } from '@renderer/components/MiniApp/InstallConsentDialog'
import { usePreference } from '@renderer/data/hooks/usePreference'
import { useExitPresence } from '@renderer/hooks/useExitPresence'
import { useMiniAppInstallPreview } from '@renderer/hooks/useMiniAppInstallPreview'
import { ipcApi } from '@renderer/ipc'
import { toast } from '@renderer/services/toast'
import type { FileHandle } from '@shared/data/types/file'

const logger = loggerService.withContext('MiniAppArtifactActions')

interface Props {
  /** The attachment's handle, passed straight through — main resolves it, never this component. */
  handle: FileHandle
  /** The session that owns the artifact; tokens and previews are bound to it. */
  topicId: string
}

/**
 * The `.miniapp` artifact card's actions (issue #21646, stage 3, AC7/AC8).
 *
 * "Preview and test" is the preview consent: the click asks main for a preview
 * of the session's OWN validated artifact (main looks the token up by file,
 * re-checks the digest and the repair cap). "Install to Mini Apps" is a separate
 * decision that flows through the same consent dialog as any package install,
 * and the Launchpad choice after it is a third, persisted one ("Not now" reads
 * back from the dismissed preference; "Add to Launchpad" pins the app).
 */
export const MiniAppArtifactActions: FC<Props> = ({ handle, topicId }) => {
  const { t } = useTranslation()
  const rightPanel = useOptionalRightPanelActions()
  const [previewing, setPreviewing] = useState(false)
  // The app the consent dialog is installing; set at confirm time so the
  // Launchpad prompt that follows knows what it is deciding about.
  const installedAppIdRef = useRef<string | null>(null)
  const [launchpadAppId, setLaunchpadAppId] = useState<string | null>(null)
  const [launchpadBusy, setLaunchpadBusy] = useState(false)
  const [dismissed] = usePreference('feature.mini_app.launchpad_prompt_dismissed')

  // Install completed: the third decision's turn, unless it was already answered.
  // The read-back is main's `isLaunchpadAnswered` contract — pinned OR dismissed —
  // because "Add to Launchpad" writes the STATUS, not the dismissed list: a
  // reinstall or upgrade that checked only the list would re-ask an answered
  // question. A failed read-back falls back to the list alone (the pre-route
  // behavior) rather than swallowing a legitimate prompt.
  const onInstallDone = useCallback(() => {
    const appId = installedAppIdRef.current
    installedAppIdRef.current = null
    if (!appId) return
    void ipcApi
      .request('mini_app.authoring.launchpad_answered', { appId })
      .catch(() => dismissed.includes(appId))
      .then((answered) => {
        if (!answered) setLaunchpadAppId(appId)
      })
  }, [dismissed])

  const { preview, busy, error, settle, cancelPreview, confirm } = useMiniAppInstallPreview(onInstallDone)
  const previewDialog = useExitPresence(preview)
  const launchpadDialog = useExitPresence(launchpadAppId)

  useEffect(() => {
    if (error) toast.error(t(error.key, error.params))
  }, [error, t])

  const handlePreview = async () => {
    setPreviewing(true)
    try {
      await ipcApi.request('mini_app.authoring.request_preview', { sessionId: topicId, handle })
      // The pane polls and picks the new preview up; it just needs to be open.
      rightPanel?.tryOpen('mini-app-previews')
    } catch (e) {
      logger.error('Failed to open mini app preview from artifact card', e as Error)
      toast.error(t('miniApp.authoring.preview_error', { message: e instanceof Error ? e.message : String(e) }))
    } finally {
      setPreviewing(false)
    }
  }

  const handleInstall = () =>
    settle(
      () => ipcApi.request('mini_app.authoring.request_install', { sessionId: topicId, handle }),
      'miniApp.install.preview_error'
    )

  const handleConfirm = async (decision: Parameters<typeof confirm>[0]) => {
    // Pin the app id BEFORE the install: onDone fires inside confirm, and a
    // cleared preview no longer carries the manifest.
    if (preview) installedAppIdRef.current = preview.manifest.id
    await confirm(decision)
  }

  const answerLaunchpad = async (action: 'pin' | 'dismiss') => {
    if (!launchpadAppId) return
    setLaunchpadBusy(true)
    try {
      await ipcApi.request('mini_app.authoring.set_launchpad', { appId: launchpadAppId, action })
      if (action === 'pin') toast.success(t('miniApp.authoring.launchpad_pinned'))
      setLaunchpadAppId(null)
    } catch (e) {
      logger.error('Failed to record launchpad decision', e as Error)
      toast.error(t('miniApp.authoring.launchpad_error'))
    } finally {
      setLaunchpadBusy(false)
    }
  }

  return (
    <>
      <div className="mt-1.5 flex flex-wrap gap-1.5">
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="h-7 gap-1 px-2 text-xs"
          onClick={() => void handlePreview()}
          disabled={previewing || busy}>
          <Play size={12} />
          {t('miniApp.authoring.preview_and_test')}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="h-7 gap-1 px-2 text-xs"
          onClick={handleInstall}
          disabled={previewing || busy}>
          <Package size={12} />
          {t('miniApp.authoring.install_to_mini_apps')}
        </Button>
      </div>

      {previewDialog.value && (
        <InstallConsentDialog
          key={
            previewDialog.value.kind === 'upgrade'
              ? previewDialog.value.update.updateToken
              : previewDialog.value.installToken
          }
          open={preview !== null}
          preview={previewDialog.value}
          busy={busy}
          onCancel={cancelPreview}
          onConfirm={handleConfirm}
        />
      )}

      {launchpadDialog.value && (
        <Dialog open={launchpadAppId !== null} onOpenChange={(open) => !open && answerLaunchpad('dismiss')}>
          <DialogContent aria-describedby={undefined} className="max-w-sm">
            <DialogHeader>
              <DialogTitle>{t('miniApp.authoring.launchpad_title')}</DialogTitle>
            </DialogHeader>
            <p className="text-muted-foreground text-sm">{t('miniApp.authoring.launchpad_hint')}</p>
            <DialogFooter>
              <Button variant="outline" disabled={launchpadBusy} onClick={() => void answerLaunchpad('dismiss')}>
                {t('miniApp.authoring.launchpad_not_now')}
              </Button>
              <Button loading={launchpadBusy} onClick={() => void answerLaunchpad('pin')}>
                {t('miniApp.authoring.launchpad_add')}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </>
  )
}

export default MiniAppArtifactActions
