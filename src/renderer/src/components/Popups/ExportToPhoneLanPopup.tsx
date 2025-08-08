import { SettingHelpText, SettingRow } from '@renderer/pages/settings'
import { Button, Modal, Progress, QRCode, Space, Spin } from 'antd'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { TopView } from '../TopView'

interface Props {
  resolve: (data: any) => void
}

const PopupContainer: React.FC<Props> = ({ resolve }) => {
  const [open, setOpen] = useState(true)
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
          console.error('Failed to get IP address or port.')
        }
      } catch (error) {
        console.error('Failed to initialize WebSocket:', error)
      } finally {
        setIsLoading(false)
      }
    }

    initWebSocket()

    const handleClientConnected = (_event: any, data: { connected: boolean }) => {
      setConnectionStatus(data.connected ? 'connected' : 'disconnected')
      console.log(data.connected ? '移动端已连接' : '移动端已断开连接')
    }

    const handleMessageReceived = (_event: any, data: any) => {
      console.log(`收到移动端消息: ${JSON.stringify(data)}`)
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
    console.log('result', result)
    if (result) {
      const path = result[0].path
      setSelectedFolderPath(path)
    }
  }

  const handleSendZip = async () => {
    if (!selectedFolderPath) {
      console.error('No file selected')
      return
    }
    setIsSending(true)
    try {
      await window.api.webSocket.sendFile(selectedFolderPath)
      console.log('File sent successfully')
    } catch (error) {
      console.error('Failed to send file:', error)
    } finally {
      setIsSending(false)
    }
  }

  const onOk = async () => {
    setOpen(false)
  }

  const onCancel = () => {
    setOpen(false)
  }

  const onClose = () => {
    resolve({})
  }

  return (
    <Modal
      title={t('exportToPhone.lan.title')}
      open={open}
      onOk={onOk}
      onCancel={onCancel}
      afterClose={onClose}
      maskClosable={false}
      transitionName="animation-move-down"
      centered>
      <SettingRow>
        <div>{t('exportToPhone.lan.content')}</div>
      </SettingRow>

      <SettingRow style={{ display: 'flex', justifyContent: 'center', minHeight: '180px' }}>
        {isLoading ? (
          <Spin />
        ) : !isConnected && qrCodeValue ? (
          <QRCode value={qrCodeValue} errorLevel="Q" size={160} icon="/src/assets/images/logo.png" iconSize={40} />
        ) : null}
      </SettingRow>

      <SettingRow style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
        <Space direction="vertical" style={{ justifyContent: 'center', width: '100%', alignItems: 'center' }}>
          <Space>
            <Button onClick={handleSelectZip}>{t('exportToPhone.lan.selectZip')}</Button>
            <Button
              type="primary"
              onClick={handleSendZip}
              disabled={!selectedFolderPath || !isConnected || isSending}
              loading={isSending}>
              {isSending ? t('common.sending') : t('exportToPhone.lan.sendZip')}
            </Button>
          </Space>
          <SettingHelpText style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {selectedFolderPath || t('exportToPhone.lan.noZipSelected')}
          </SettingHelpText>
          {isSending && <Progress percent={Math.round(sendProgress)} />}
        </Space>
      </SettingRow>
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
