import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@cherrystudio/ui'
import { cn } from '@cherrystudio/ui/lib/utils'
import { LocalModelDownloadProgress } from '@renderer/components/LocalModelDownloadProgress'
import { useLocalModel } from '@renderer/hooks/useLocalModel'
import { createPopup, type PopupInjectedProps } from '@renderer/services/popup'
import { toast } from '@renderer/services/toast'
import type { LocalModelKind } from '@shared/data/presets/localModel'
import { Download, RefreshCw } from 'lucide-react'
import type React from 'react'
import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'

export interface LocalModelDownloadParams {
  model: LocalModelKind
  /** What is being fetched, e.g. "PaddleOCR PP-OCRv6 · ~140 MB". */
  description: string
}

type Props = LocalModelDownloadParams & PopupInjectedProps<boolean>

const PopupContainer: React.FC<Props> = ({ open, resolve, model, description }) => {
  const { t } = useTranslation()
  const { status, percent, download, cancel } = useLocalModel(model)
  const [failed, setFailed] = useState(false)

  const downloading = status === 'downloading'

  const handleDownload = useCallback(async () => {
    setFailed(false)

    try {
      // download() resolves true once the model is on disk and false when the user
      // cancels it — which is already exactly this dialog's answer.
      resolve(await download())
    } catch {
      // Stay open so the user can retry without re-opening the dropdown; the cause is
      // already logged by the main-process download service.
      toast.error(t('settings.dependencies.localModels.notice.downloadFailed'))
      setFailed(true)
    }
  }, [download, resolve, t])

  const handleCancel = useCallback(() => {
    if (!downloading) {
      resolve(false)
      return
    }

    // Do not resolve here: let the in-flight download() settle the dialog once main
    // confirms the cancellation, so the bar cannot be left frozen on screen.
    void cancel()
  }, [cancel, downloading, resolve])

  const handleOpenChange = useCallback(
    (next: boolean) => {
      if (!next) {
        handleCancel()
      }
    },
    [handleCancel]
  )

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        showCloseButton={false}
        // Dismissing mid-download would leave it running with nothing on screen
        // reporting it; Cancel is the only way out, and it actually stops the download.
        closeOnOverlayClick={!downloading}
        overlayClassName="z-[90]"
        className={cn('confirm-popup z-[90] gap-5 sm:max-w-lg')}
        onInteractOutside={(event) => {
          if (downloading) {
            event.preventDefault()
          }
        }}>
        <DialogHeader className="gap-3">
          <div className="flex items-start gap-3">
            <Download className="mt-0.5 size-5 shrink-0 text-muted-foreground" />
            <div className="min-w-0 flex-1">
              <DialogTitle className="text-base leading-6">{t('knowledge.rag.download_local_model')}</DialogTitle>
              <DialogDescription asChild>
                <div className="wrap-anywhere mt-2 min-w-0 max-w-full text-muted-foreground text-sm leading-5">
                  {description}
                </div>
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        {downloading ? <LocalModelDownloadProgress percent={percent} /> : null}

        <DialogFooter>
          <Button variant="outline" onClick={handleCancel}>
            {t('common.cancel')}
          </Button>
          {downloading ? null : (
            <Button onClick={() => void handleDownload()} className="gap-1">
              {failed ? <RefreshCw className="size-4" /> : <Download className="size-4" />}
              {t(failed ? 'common.retry' : 'settings.dependencies.localModels.download')}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/**
 * Ask to download a local model, then stay open and report the download.
 *
 * Resolves true only once the model is on disk, so a caller can gate on it — picking a
 * processor whose model never arrived would just fail later in the job. The plain
 * confirm this replaces closed on click and left the download running with nothing on
 * screen tracking it: the dropdown that started it is shut by then, and the settings
 * panel that shows progress is a page away.
 *
 * Not reusable as ConfirmActionPopup: that one disables Cancel while its action runs,
 * and a ~140 MB download has to stay interruptible.
 */
const LocalModelDownloadPopup = createPopup<LocalModelDownloadParams, boolean>(PopupContainer, {
  dismissResult: false
})

export default LocalModelDownloadPopup
