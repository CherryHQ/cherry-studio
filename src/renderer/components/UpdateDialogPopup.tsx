import type { ReleaseNoteInfo, UpdateInfo } from 'builder-util-runtime'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import {
  Button,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Divider,
  Scrollbar
} from '@cherrystudio/ui'
import { loggerService } from '@logger'
import { useAppUpdateState } from '@renderer/hooks/useAppUpdateState'
import { ipcApi } from '@renderer/ipc'
import { createPopup, type PopupInjectedProps } from '@renderer/services/popup'
import { toast } from '@renderer/services/toast'

import { ReleaseNotes } from './ReleaseNotes'

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
          <p className="text-sm text-muted-foreground">
            {t('update.message').replace('{{version}}', releaseInfo?.version || '')}
          </p>
        </DialogHeader>
        <Divider className="my-0" />
        <Scrollbar className="max-h-96 overflow-x-hidden pr-2">
          <ReleaseNotes content={releaseNotesText} />
        </Scrollbar>
        <Divider className="my-0" />
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
