import { Button, Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@cherrystudio/ui'
import { loggerService } from '@logger'
import { StaticMarkdown } from '@renderer/components/markdown'
import { useAppUpdateState } from '@renderer/hooks/useAppUpdateState'
import { ipcApi } from '@renderer/ipc'
import { createPopup, type PopupInjectedProps } from '@renderer/services/popup'
import { toast } from '@renderer/services/toast'
import type { ReleaseNoteInfo, UpdateInfo } from 'builder-util-runtime'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

const logger = loggerService.withContext('UpdateDialog')

interface ShowParams {
  releaseInfo: UpdateInfo | null
}

type Props = ShowParams & PopupInjectedProps<Record<string, never>>

const PopupContainer: React.FC<Props> = ({ releaseInfo, open, resolve }) => {
  const { t } = useTranslation()
  const [isInstalling, setIsInstalling] = useState(false)
  const { updateAppUpdateState } = useAppUpdateState()
  useEffect(() => {
    if (releaseInfo) {
      logger.info('Update dialog opened', { version: releaseInfo.version })
    }
  }, [releaseInfo])

  const handleInstall = async () => {
    setIsInstalling(true)
    try {
      // [v2] Removed: Redux persistor flush is no longer needed after v2 data refactoring
      // await handleSaveData()
      await ipcApi.request('app.updater.quit_and_install')
      resolve({})
    } catch (error) {
      logger.error('Failed to save data before update', error as Error)
      setIsInstalling(false)
      toast.error(t('update.saveDataError'))
    }
  }

  const onCancel = () => {
    updateAppUpdateState({ manualCheck: false })
    resolve({})
  }

  const onIgnore = () => {
    updateAppUpdateState({ ignore: true, manualCheck: false })
    resolve({})
  }

  const onOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) {
      onCancel()
    }
  }

  const releaseNotes = releaseInfo?.releaseNotes
  const releaseNotesText =
    typeof releaseNotes === 'string'
      ? releaseNotes
      : Array.isArray(releaseNotes)
        ? releaseNotes
            .map((note: ReleaseNoteInfo) => note.note)
            .filter(Boolean)
            .join('\n\n')
        : t('update.noReleaseNotes')

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[720px]">
        <DialogHeader className="pr-8">
          <DialogTitle>{t('update.title')}</DialogTitle>
          <p className="text-muted-foreground text-sm">
            {t('update.message').replace('{{version}}', releaseInfo?.version || '')}
          </p>
        </DialogHeader>
        <div className="max-h-[450px] overflow-y-auto py-3">
          <div className="markdown rounded-md bg-muted p-4 text-muted-foreground text-sm leading-6 [&_code]:rounded [&_code]:bg-background [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-[13px] [&_h1:first-child]:mt-0 [&_h1]:mt-4 [&_h1]:mb-2 [&_h1]:font-semibold [&_h1]:text-foreground [&_h2:first-child]:mt-0 [&_h2]:mt-4 [&_h2]:mb-2 [&_h2]:font-semibold [&_h2]:text-foreground [&_h3:first-child]:mt-0 [&_h3]:mt-4 [&_h3]:mb-2 [&_h3]:font-semibold [&_h3]:text-foreground [&_h4:first-child]:mt-0 [&_h4]:mt-4 [&_h4]:mb-2 [&_h4]:font-semibold [&_h4]:text-foreground [&_h5:first-child]:mt-0 [&_h5]:mt-4 [&_h5]:mb-2 [&_h5]:font-semibold [&_h5]:text-foreground [&_h6:first-child]:mt-0 [&_h6]:mt-4 [&_h6]:mb-2 [&_h6]:font-semibold [&_h6]:text-foreground [&_li]:my-1 [&_ol]:my-2 [&_ol]:list-decimal [&_ol]:pl-6 [&_p:last-child]:mb-0 [&_p]:mb-3 [&_pre]:overflow-x-auto [&_pre]:rounded-md [&_pre]:bg-background [&_pre]:p-3 [&_pre_code]:bg-transparent [&_pre_code]:p-0 [&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-6">
            <StaticMarkdown id="update-release-notes">{releaseNotesText}</StaticMarkdown>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onIgnore} disabled={isInstalling}>
            {t('update.later')}
          </Button>
          <Button onClick={handleInstall} loading={isInstalling}>
            {t('update.install')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

const UpdateDialogPopup = createPopup<ShowParams, Record<string, never>>(PopupContainer, { dismissResult: {} })

export default UpdateDialogPopup
