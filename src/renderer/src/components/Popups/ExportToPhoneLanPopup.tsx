import { Button } from '@heroui/button'
import { Modal, ModalBody, ModalContent, ModalHeader } from '@heroui/modal'
import { Progress } from '@heroui/progress'
import { Spinner } from '@heroui/spinner'
import { loggerService } from '@logger'
import { SettingHelpText, SettingRow } from '@renderer/pages/settings'
import { QRCodeSVG } from 'qrcode.react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { TopView } from '../TopView'

const logger = loggerService.withContext('ExportToPhoneLanPopup')
interface Props {
  resolve: (data: any) => void
}

const PopupContainer: React.FC<Props> = ({ resolve }) => {
  const [isOpen, setIsOpen] = useState(true)
  const [connectionStatus, setConnectionStatus] = useState<'disconnected' | 'connected'>('disconnected')
  const [qrCodeValue, setQrCodeValue] = useState('')
  const [isLoading, setIsLoading] = useState(true)
  const [isSending, setIsSending] = useState(false)
  const [selectedFolderPath, setSelectedFolderPath] = useState<string | null>(null)
  const [sendProgress, setSendProgress] = useState(0)

  const { t } = useTranslation()

  const isConnected = connectionStatus === 'connected'

  useEffect(() => {
    const initWebSocket = async () => {
      try {
        await window.api.webSocket.start()
        const { port, ip } = await window.api.webSocket.status()

        if (ip && port) {
          const connectionInfo = {
            type: 'cherry-studio-app',
            host: ip,
            port: port,
            timestamp: Date.now()
          }
          setQrCodeValue(JSON.stringify(connectionInfo))
        } else {
          logger.error('Failed to get IP address or port.')
        }
      } catch (error) {
        logger.error('Failed to initialize WebSocket:', error as Error)
      } finally {
        setIsLoading(false)
      }
    }

    initWebSocket()

    const handleClientConnected = (_event: any, data: { connected: boolean }) => {
      setConnectionStatus(data.connected ? 'connected' : 'disconnected')
    }

    const handleMessageReceived = (_event: any, data: any) => {
      logger.info(`Received message from mobile: ${JSON.stringify(data)}`)
    }

    const handleSendProgress = (_event: any, data: { progress: number }) => {
      setSendProgress(data.progress)
    }

    const removeClientConnectedListener = window.electron.ipcRenderer.on(
      'websocket-client-connected',
      handleClientConnected
    )
    const removeMessageReceivedListener = window.electron.ipcRenderer.on(
      'websocket-message-received',
      handleMessageReceived
    )
    const removeSendProgressListener = window.electron.ipcRenderer.on('file-send-progress', handleSendProgress)

    return () => {
      removeClientConnectedListener()
      removeMessageReceivedListener()
      removeSendProgressListener()

      window.api.webSocket.stop()
    }
  }, [])

  const handleSelectZip = async () => {
    const result = await window.api.file.select()

    if (result) {
      const path = result[0].path
      setSelectedFolderPath(path)
    }
  }

  const handleSendZip = async () => {
    if (!selectedFolderPath) {
      logger.error('No file selected')
      return
    }
    setIsSending(true)
    try {
      await window.api.webSocket.sendFile(selectedFolderPath)
    } catch (error) {
      logger.error('Failed to send file:', error as Error)
    } finally {
      setIsSending(false)
    }
  }

  const handleCancel = () => {
    setIsOpen(false)
  }

  const handleClose = () => {
    resolve({})
  }

  const isDisabled = isSending

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
        {() => (
          <>
            <ModalHeader>{t('exportToPhone.lan.title')}</ModalHeader>
            <ModalBody>
              <SettingRow>
                <div>{t('exportToPhone.lan.content')}</div>
              </SettingRow>

              <SettingRow style={{ display: 'flex', justifyContent: 'center', minHeight: '180px' }}>
                {isLoading ? (
                  <Spinner />
                ) : !isConnected && qrCodeValue ? (
                  <QRCodeSVG
                    marginSize={2}
                    value={qrCodeValue}
                    level="Q"
                    size={160}
                    imageSettings={{
                      src: '/src/assets/images/logo.png',
                      width: 40,
                      height: 40,
                      excavate: true
                    }}
                  />
                ) : null}
              </SettingRow>

              <SettingRow style={{ display: 'flex', alignItems: 'center' }}>
                <div style={{ display: 'flex', gap: 10, justifyContent: 'center', width: '100%' }}>
                  <Button color="default" variant="flat" onPress={handleSelectZip} isDisabled={isSending}>
                    {t('exportToPhone.lan.selectZip')}
                  </Button>
                  <Button
                    color="primary"
                    onPress={handleSendZip}
                    isDisabled={!selectedFolderPath || !isConnected || isSending}
                    isLoading={isSending}>
                    {isSending ? t('common.sending') : t('exportToPhone.lan.sendZip')}
                  </Button>
                </div>
              </SettingRow>

              <SettingHelpText
                style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', textAlign: 'center' }}>
                {selectedFolderPath || t('exportToPhone.lan.noZipSelected')}
              </SettingHelpText>

              {isSending && (
                <div style={{ paddingTop: 8 }}>
                  <Progress
                    value={Math.round(sendProgress)}
                    size="md"
                    color="primary"
                    showValueLabel={true}
                    aria-label="Send progress"
                  />
                </div>
              )}
            </ModalBody>
          </>
        )}
      </ModalContent>
    </Modal>
  )
}

const TopViewKey = 'ExportToPhoneLanPopup'

export default class ExportToPhoneLanPopup {
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
