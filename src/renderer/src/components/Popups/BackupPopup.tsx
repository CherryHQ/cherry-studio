import { loggerService } from '@logger'
import { getBackupProgressLabel } from '@renderer/i18n/label'
import { backup, backupToLanTransfer } from '@renderer/services/BackupService'
import store from '@renderer/store'
import { IpcChannel } from '@shared/IpcChannel'
import { Modal, Progress } from 'antd'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { TopView } from '../TopView'

const logger = loggerService.withContext('BackupPopup')

interface Props {
  resolve: (data: any) => void
  backupType?: 'direct' | 'lan-transfer'
}

type ProgressStageType = 'preparing' | 'copying_database' | 'copying_files' | 'compressing' | 'completed'

interface ProgressData {
  stage: ProgressStageType
  progress: number
  total: number
}

const PopupContainer: React.FC<Props> = ({ resolve, backupType = 'direct' }) => {
  const [open, setOpen] = useState(true)
  const [progressData, setProgressData] = useState<ProgressData>()
  const { t } = useTranslation()
  const skipBackupFile = store.getState().settings.skipBackupFile

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
    setOpen(false)
  }

  const onCancel = () => {
    setOpen(false)
  }

  const onClose = () => {
    resolve({})
  }

  const getProgressText = () => {
    if (!progressData) return ''

    if (progressData.stage === 'copying_files') {
      return t('backup.progress.copying_files', {
        progress: Math.floor(progressData.progress)
      })
    }
    return getBackupProgressLabel(progressData.stage)
  }

  BackupPopup.hide = onCancel

  const isDisabled = progressData ? progressData.stage !== 'completed' : false
  const isLanTransfterMode = backupType === 'lan-transfer'

  const title = isLanTransfterMode ? t('settings.data.export_to_phone.file.title') : t('backup.title')
  const okText = isLanTransfterMode ? t('settings.data.export_to_phone.file.button') : t('backup.confirm.button')
  const content = isLanTransfterMode ? t('settings.data.export_to_phone.file.content') : t('backup.content')

  return (
    <Modal
      title={title}
      open={open}
      onOk={onOk}
      onCancel={onCancel}
      afterClose={onClose}
      okButtonProps={{ disabled: isDisabled }}
      cancelButtonProps={{ disabled: isDisabled }}
      okText={okText}
      maskClosable={false}
      transitionName="animation-move-down"
      centered>
      {!progressData && <div>{content}</div>}
      {progressData && (
        <div style={{ textAlign: 'center', padding: '20px 0' }}>
          <Progress percent={Math.floor(progressData.progress)} strokeColor="var(--color-primary)" />
          <div style={{ marginTop: 16 }}>{getProgressText()}</div>
        </div>
      )}
    </Modal>
  )
}

const TopViewKey = 'BackupPopup'

export default class BackupPopup {
  static topviewId = 0
  static hide() {
    TopView.hide(TopViewKey)
  }
  static show(backupType: 'direct' | 'lan-transfer' = 'direct') {
    return new Promise<any>((resolve) => {
      TopView.show(
        <PopupContainer
          backupType={backupType}
          resolve={(v) => {
            resolve(v)
            TopView.hide(TopViewKey)
          }}
        />,
        TopViewKey
      )
    })
  }
}
