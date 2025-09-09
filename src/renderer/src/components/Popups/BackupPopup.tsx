import { Button } from '@heroui/button'
import { Modal, ModalBody, ModalContent, ModalFooter, ModalHeader } from '@heroui/modal'
import { Progress } from '@heroui/progress'
import { loggerService } from '@logger'
import { getBackupProgressLabel } from '@renderer/i18n/label'
import { backup } from '@renderer/services/BackupService'
import store from '@renderer/store'
import { IpcChannel } from '@shared/IpcChannel'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { TopView } from '../TopView'

const logger = loggerService.withContext('BackupPopup')

interface Props {
  resolve: (data: any) => void
}

type ProgressStageType = 'reading_data' | 'preparing' | 'extracting' | 'extracted' | 'copying_files' | 'completed'

interface ProgressData {
  stage: ProgressStageType
  progress: number
  total: number
}

const PopupContainer: React.FC<Props> = ({ resolve }) => {
  const [isOpen, setIsOpen] = useState(true)
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

  const handleOk = async () => {
    logger.debug(`skipBackupFile: ${skipBackupFile}`)
    await backup(skipBackupFile)
    setIsOpen(false)
  }

  const handleCancel = () => {
    setIsOpen(false)
  }

  const handleClose = () => {
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

  BackupPopup.hide = handleCancel

  const isDisabled = progressData ? progressData.stage !== 'completed' : false

  return (
    <Modal
      isOpen={isOpen}
      onOpenChange={(open) => {
        if (!open && !isDisabled) {
          handleCancel()
        }
      }}
      isDismissable={!isDisabled}
      isKeyboardDismissDisabled={isDisabled}
      placement="center"
      onClose={handleClose}>
      <ModalContent>
        {(onClose) => (
          <>
            <ModalHeader>{t('backup.title')}</ModalHeader>
            <ModalBody>
              {!progressData && <div>{t('backup.content')}</div>}
              {progressData && (
                <div style={{ textAlign: 'center', padding: '20px 0' }}>
                  <Progress
                    value={Math.floor(progressData.progress)}
                    size="md"
                    color="primary"
                    showValueLabel={true}
                    aria-label="Backup progress"
                  />
                  <div style={{ marginTop: 16 }}>{getProgressText()}</div>
                </div>
              )}
            </ModalBody>
            <ModalFooter>
              <Button color="default" variant="ghost" onPress={onClose} isDisabled={isDisabled}>
                {t('common.cancel')}
              </Button>
              <Button color="primary" onPress={handleOk} isDisabled={isDisabled}>
                {t('backup.confirm.button')}
              </Button>
            </ModalFooter>
          </>
        )}
      </ModalContent>
    </Modal>
  )
}

const TopViewKey = 'BackupPopup'

export default class BackupPopup {
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
