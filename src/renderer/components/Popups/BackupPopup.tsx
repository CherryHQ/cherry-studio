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
import { loggerService } from '@logger'
import { getBackupProgressLabelKey } from '@renderer/i18n/label'
import { backup, backupToLanTransfer } from '@renderer/services/BackupService'
import { createPopup, type PopupInjectedProps } from '@renderer/services/popup'
import { IpcChannel } from '@shared/IpcChannel'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

const logger = loggerService.withContext('BackupPopup')

interface OwnProps {
  backupType?: 'direct' | 'lan-transfer'
}

type Props = OwnProps & PopupInjectedProps<any>

type ProgressStageType = 'preparing' | 'copying_database' | 'copying_files' | 'compressing' | 'completed'

interface ProgressData {
  stage: ProgressStageType
  progress: number
  total: number
}

const PopupContainer: React.FC<Props> = ({ backupType = 'direct', open, resolve }) => {
  const [progressData, setProgressData] = useState<ProgressData>()
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
    logger.debug(`skipBackupFile: ${skipBackupFile}, backupType: ${backupType}`)

    if (backupType === 'lan-transfer') {
      await backupToLanTransfer()
    } else {
      await backup(skipBackupFile)
    }
    resolve({})
  }

  const onCancel = () => {
    resolve({})
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

  const isDisabled = progressData ? progressData.stage !== 'completed' : false
  const isLanTransferMode = backupType === 'lan-transfer'

  const title = isLanTransferMode ? t('settings.data.export_to_phone.file.title') : t('backup.title')
  const okText = isLanTransferMode ? t('settings.data.export_to_phone.file.button') : t('backup.confirm.button')
  const content = isLanTransferMode ? t('settings.data.export_to_phone.file.content') : t('backup.content')

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => !nextOpen && onCancel()}>
      <DialogContent
        closeOnOverlayClick={false}
        className="sm:max-w-[520px]"
        onPointerDownOutside={(event) => event.preventDefault()}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        {!progressData && <div>{content}</div>}
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

const BackupPopupImpl = createPopup<OwnProps, any>(PopupContainer, { dismissResult: {} })

/**
 * Preserve the legacy positional `show(backupType)` API — call sites pass
 * `'lan-transfer'` or nothing — on top of createPopup's props-object handle.
 */
const BackupPopup = {
  show: (backupType: 'direct' | 'lan-transfer' = 'direct'): Promise<any> => BackupPopupImpl.show({ backupType }),
  hide: (): void => BackupPopupImpl.hide()
}

export default BackupPopup
