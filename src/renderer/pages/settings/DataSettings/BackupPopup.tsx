import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import {
  Button,
  CircularProgress,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@cherrystudio/ui'
import { usePreference } from '@data/hooks/usePreference'
import { getBackupProgressLabelKey } from '@renderer/i18n/label'
import { ipcApi } from '@renderer/ipc'
import { backup } from '@renderer/services/BackupService'
import { createPopup, type PopupInjectedProps } from '@renderer/services/popup'
import { toast } from '@renderer/services/toast'
import { getLocalizedBackupErrorMessage } from '@renderer/utils/backup'
import { IpcChannel } from '@shared/IpcChannel'
import { AbsoluteFilePathSchema } from '@shared/types/file'

interface OwnProps {
  forceFullBackup?: boolean
  scope?: 'configuration'
}

type Props = OwnProps & PopupInjectedProps<void>

type ProgressStageType = 'preparing' | 'copying_database' | 'copying_files' | 'compressing' | 'completed'

interface ProgressData {
  stage: ProgressStageType
  progress: number
  total: number
}

const PopupContainer: React.FC<Props> = ({ forceFullBackup = false, scope, open, resolve }) => {
  const [progressData, setProgressData] = useState<ProgressData>()
  const [submitting, setSubmitting] = useState(false)
  const { t } = useTranslation()
  const [skipBackupFile] = usePreference('data.backup.general.skip_backup_file')

  useEffect(() => {
    const removeListener = window.electron.ipcRenderer.on(IpcChannel.BackupProgress, (_, data: ProgressData) => {
      setProgressData(data)
    })

    return () => {
      removeListener()
    }
  }, [])

  const onOk = async () => {
    setSubmitting(true)
    try {
      if (scope === 'configuration') {
        const destinationPath = await window.api.file.selectFolder()
        if (!destinationPath) {
          setSubmitting(false)
          return
        }
        await ipcApi.request('backup.export_configuration', {
          destinationPath: AbsoluteFilePathSchema.parse(destinationPath)
        })
      } else {
        await backup(forceFullBackup ? false : skipBackupFile)
      }
      resolve()
    } catch (error) {
      toast.error(getLocalizedBackupErrorMessage(error))
      setProgressData(undefined)
      setSubmitting(false)
    }
  }

  const onCancel = () => {
    resolve()
  }

  const getProgressText = () => {
    if (!progressData) return ''

    if (progressData.stage === 'copying_files') {
      return t('backup.progress.copying_files', {
        progress: Math.floor(progressData.progress)
      })
    }
    return t(getBackupProgressLabelKey(progressData.stage))
  }

  const isDisabled = submitting || (progressData ? progressData.stage !== 'completed' : false)

  const title = t(scope === 'configuration' ? 'backup.configuration.title' : 'backup.title')
  const okText = t(scope === 'configuration' ? 'backup.configuration.confirm.button' : 'backup.confirm.button')
  const content = t(scope === 'configuration' ? 'backup.configuration.content' : 'backup.content')

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => !nextOpen && onCancel()}>
      <DialogContent
        closeOnOverlayClick={false}
        className="sm:max-w-[520px]"
        onPointerDownOutside={(event) => event.preventDefault()}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        {!progressData && (
          <div className={scope === 'configuration' ? 'max-h-[55vh] overflow-y-auto' : undefined}>{content}</div>
        )}
        {progressData && (
          <div className="flex flex-col items-center gap-4 py-5 text-center">
            <CircularProgress
              value={Math.floor(progressData.progress)}
              size={72}
              strokeWidth={6}
              showLabel
              renderLabel={(progress) => `${progress}%`}
            />
            <div>{getProgressText()}</div>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" disabled={isDisabled} onClick={onCancel}>
            {t('common.cancel')}
          </Button>
          <Button disabled={isDisabled} onClick={onOk}>
            {okText}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

const BackupPopup = createPopup<OwnProps, void>(PopupContainer)

export default BackupPopup
