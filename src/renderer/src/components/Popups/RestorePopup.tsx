import { getProgressLabel } from '@renderer/i18n/label'
import { restore } from '@renderer/services/BackupService'
import { IpcChannel } from '@shared/IpcChannel'
import { Modal, Progress } from 'antd'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { TopView } from '../TopView'

interface Props {
  resolve: (data: any) => void
}

interface ProgressData {
  stage: string
  progress: number
  total: number
}

const PopupContainer: React.FC<Props> = ({ resolve }) => {
  const [open, setOpen] = useState(true)
  const [progressData, setProgressData] = useState<ProgressData>()
  const { t } = useTranslation()

  useEffect(() => {
    const removeListener = window.electron.ipcRenderer.on(IpcChannel.RestoreProgress, (_, data: ProgressData) => {
      setProgressData(data)
    })

    return () => {
      removeListener()
    }
  }, [])

  const onOk = async () => {
    await restore()
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
    return getProgressLabel(progressData.stage)
  }

  RestorePopup.hide = onCancel

  const isDisabled = progressData ? progressData.stage !== 'completed' : false

  return (
    <Modal
      title={t('restore.title')}
      open={open}
      onOk={onOk}
      onCancel={onCancel}
      afterClose={onClose}
      okText={t('restore.confirm.button')}
      okButtonProps={{ disabled: isDisabled }}
      cancelButtonProps={{ disabled: isDisabled }}
      maskClosable={false}
      transitionName="animation-move-down"
      centered>
      {!progressData && <div>{t('restore.content')}</div>}
      {progressData && (
        <div style={{ textAlign: 'center', padding: '20px 0' }}>
          <Progress percent={Math.floor(progressData.progress)} strokeColor="var(--color-primary)" />
          <div style={{ marginTop: 16 }}>{getProgressText()}</div>
        </div>
      )}
    </Modal>
  )
}

const TopViewKey = 'RestorePopup'

export default class RestorePopup {
  static topviewId = 0
  static hide() {
    TopView.hide(TopViewKey)
  }
  static show() {
    return new Promise<any>((resolve) => {
      TopView.show(
        <PopupContainer
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
