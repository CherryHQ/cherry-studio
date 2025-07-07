import { SettingRow, SettingTitle } from '@renderer/pages/settings'
import { exportToPhone } from '@renderer/services/BackupService'
import { Modal, Spin } from 'antd'
import { QRCodeSVG } from 'qrcode.react'
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
  const { t } = useTranslation()

  const isConnected = connectionStatus === 'connected'

  useEffect(() => {
    const initWebSocket = async () => {
      try {
        await window.api.webSocket.start()
        const { port, ip } = await window.api.webSocket.status()

        if (ip && port) {
          const connectionInfo = {
            type: 'cherry-studio-connection',
            host: ip,
            port: port,
            timestamp: Date.now()
          }
          setQrCodeValue(JSON.stringify(connectionInfo))
        } else {
          console.error('Failed to get IP address or port.')
          // 你可以在此处添加错误提示
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

    const removeClientConnectedListener = window.electron.ipcRenderer.on(
      'websocket-client-connected',
      handleClientConnected
    )
    const removeMessageReceivedListener = window.electron.ipcRenderer.on(
      'websocket-message-received',
      handleMessageReceived
    )

    return () => {
      removeClientConnectedListener()
      removeMessageReceivedListener()
      // 当组件卸载时，确保WebSocket服务也停止
      window.api.webSocket.stop()
    }
  }, [])

  const onOk = async () => {
    if (!isConnected) return
    await exportToPhone()
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
      okText={t('exportToPhone.confirm.button')}
      okButtonProps={{ disabled: !isConnected }}
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
          <QRCodeSVG
            value={qrCodeValue}
            level="Q"
            size={160}
            imageSettings={{
              src: '/src/assets/images/logo.png',
              height: 40,
              width: 40,
              excavate: true
            }}
          />
        ) : null}
      </SettingRow>

      <SettingRow style={{ textAlign: 'center' }}>
        <div
          style={{
            padding: '10px',
            border: `1px solid ${isConnected ? '#b7eb8f' : '#ffccc7'}`,
            borderRadius: '4px'
          }}>
          <SettingTitle>
            {t('common.status')}: {isConnected ? t('common.connected') : t('common.disconnected')}
          </SettingTitle>
        </div>
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
