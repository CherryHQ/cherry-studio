import { Button } from '@heroui/button'
import { Modal, ModalBody, ModalContent, ModalFooter, ModalHeader } from '@heroui/modal'
import { Progress } from '@heroui/progress'
import { exportToPhone } from '@renderer/services/BackupService'
import { IpcChannel } from '@shared/IpcChannel'
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
  const [isOpen, setIsOpen] = useState(true)
  const [progressData, setProgressData] = useState<ProgressData>()
  const { t } = useTranslation()

  useEffect(() => {
    const removeListener = window.electron.ipcRenderer.on(IpcChannel.BackupProgress, (_, data: ProgressData) => {
      setProgressData(data)
    })

    return () => {
      removeListener()
    }
  }, [])

  const handleOk = async () => {
    await exportToPhone()
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
      return t(`backup.progress.${progressData.stage}`, {
        progress: Math.floor(progressData.progress)
      })
    }
    return t(`backup.progress.${progressData.stage}`)
  }

  ExportToPhonePopup.hide = handleCancel

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
            <ModalHeader>{t('exportToPhone.title')}</ModalHeader>
            <ModalBody>
              {!progressData && <div>{t('exportToPhone.content')}</div>}
              {progressData && (
                <div style={{ textAlign: 'center', padding: '20px 0' }}>
                  <Progress
                    value={Math.floor(progressData.progress)}
                    size="md"
                    color="primary"
                    showValueLabel={true}
                    aria-label="Export progress"
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
                {t('exportToPhone.confirm.button')}
              </Button>
            </ModalFooter>
          </>
        )}
      </ModalContent>
    </Modal>
  )
}

const TopViewKey = 'ExportToPhonePopup'

export default class ExportToPhonePopup {
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
