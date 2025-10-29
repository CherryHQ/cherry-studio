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
  // 连接状态
  const [connectionPhase, setConnectionPhase] = useState<
    'initializing' | 'waiting_qr_scan' | 'connecting' | 'connected' | 'disconnected' | 'error'
  >('initializing')
  const [qrCodeValue, setQrCodeValue] = useState('')

  // 传输状态
  const [transferPhase, setTransferPhase] = useState<'idle' | 'preparing' | 'sending' | 'completed' | 'error'>('idle')
  const [selectedFolderPath, setSelectedFolderPath] = useState<string | null>(null)
  const [sendProgress, setSendProgress] = useState(0)
  const [transferSpeed, setTransferSpeed] = useState('')
  const [error, setError] = useState<string | null>(null)

  // 计算派生状态
  const isConnected = connectionPhase === 'connected'
  const canSend = isConnected && selectedFolderPath && transferPhase === 'idle'
  const isLoading = connectionPhase === 'initializing'
  const isSending = transferPhase === 'preparing' || transferPhase === 'sending'

  const { t } = useTranslation()

  useEffect(() => {
    const initWebSocket = async () => {
      try {
        setConnectionPhase('initializing')
        await window.api.webSocket.start()
        const { port, ip } = await window.api.webSocket.status()

        if (ip && port) {
          // 获取所有候选 IP 地址信息
          const candidates = await window.api.webSocket.getAllCandidates()
          const connectionInfo = {
            type: 'cherry-studio-app',
            candidates: candidates,
            selectedHost: ip,
            port: port,
            timestamp: Date.now()
          }
          setQrCodeValue(JSON.stringify(connectionInfo))
          setConnectionPhase('waiting_qr_scan')
          logger.info(`QR code generated: ${ip}:${port} with ${candidates.length} IP candidates`)
        } else {
          setError('Failed to get IP address or port')
          setConnectionPhase('error')
          logger.error('Failed to get IP address or port.')
        }
      } catch (error) {
        setError(`Failed to initialize WebSocket: ${error instanceof Error ? error.message : 'Unknown error'}`)
        setConnectionPhase('error')
        logger.error('Failed to initialize WebSocket:', error as Error)
      }
    }

    initWebSocket()

    const handleClientConnected = (_event: any, data: { connected: boolean }) => {
      logger.info(`Client connection status: ${data.connected ? 'connected' : 'disconnected'}`)
      if (data.connected) {
        setConnectionPhase('connected')
        setError(null)
      } else {
        setConnectionPhase('disconnected')
      }
    }

    const handleMessageReceived = (_event: any, data: any) => {
      logger.info(`Received message from mobile: ${JSON.stringify(data)}`)
    }

    const handleSendProgress = (_event: any, data: { progress: number }) => {
      const progress = data.progress
      setSendProgress(progress)

      // 如果传输刚开始，切换到发送状态
      if (transferPhase === 'preparing' && progress > 0) {
        setTransferPhase('sending')
      }

      // 如果传输完成
      if (progress >= 100) {
        setTransferPhase('completed')
        setTransferSpeed('')
      }
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
      setError('No file selected')
      return
    }

    setTransferPhase('preparing')
    setError(null)
    setSendProgress(0)
    setTransferSpeed('')

    try {
      logger.info(`Starting file transfer: ${selectedFolderPath}`)
      await window.api.webSocket.sendFile(selectedFolderPath)
      // 进度更新通过事件处理
    } catch (error) {
      const errorMsg = `Failed to send file: ${error instanceof Error ? error.message : 'Unknown error'}`
      setError(errorMsg)
      setTransferPhase('error')
      logger.error('Failed to send file:', error as Error)
    }
  }

  const handleCancel = () => {
    setIsOpen(false)
  }

  const handleClose = () => {
    resolve({})
  }

  // 状态显示函数
  const getStatusText = () => {
    switch (connectionPhase) {
      case 'initializing':
        return '正在初始化连接...'
      case 'waiting_qr_scan':
        return '请扫描二维码连接'
      case 'connecting':
        return '正在连接中...'
      case 'connected':
        return '连接成功'
      case 'disconnected':
        return '连接已断开'
      case 'error':
        return '连接出错'
      default:
        return ''
    }
  }

  const getTransferStatusText = () => {
    switch (transferPhase) {
      case 'preparing':
        return '准备传输中...'
      case 'sending':
        return `传输中 ${sendProgress}%`
      case 'completed':
        return '传输完成'
      case 'error':
        return '传输失败'
      default:
        return ''
    }
  }

  return (
    <Modal
      isOpen={isOpen}
      onOpenChange={(open) => {
        if (!open && !isSending) {
          handleCancel()
        }
      }}
      isDismissable={!isSending}
      isKeyboardDismissDisabled={isSending}
      placement="center"
      onClose={handleClose}>
      <ModalContent>
        {() => (
          <>
            <ModalHeader>{t('settings.data.export_to_phone.lan.title')}</ModalHeader>
            <ModalBody>
              {/* 连接状态显示 */}
              <SettingRow>
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    padding: '8px 12px',
                    borderRadius: '8px',
                    backgroundColor:
                      connectionPhase === 'connected' ? '#f0f9ff' : connectionPhase === 'error' ? '#fef2f2' : '#f8fafc',
                    border: `1px solid ${
                      connectionPhase === 'connected' ? '#0ea5e9' : connectionPhase === 'error' ? '#ef4444' : '#e2e8f0'
                    }`
                  }}>
                  <div
                    style={{
                      width: '8px',
                      height: '8px',
                      borderRadius: '50%',
                      backgroundColor:
                        connectionPhase === 'connected'
                          ? '#22c55e'
                          : connectionPhase === 'connecting'
                            ? '#f59e0b'
                            : connectionPhase === 'error'
                              ? '#ef4444'
                              : connectionPhase === 'waiting_qr_scan'
                                ? '#3b82f6'
                                : '#94a3b8'
                    }}
                  />
                  <span style={{ fontSize: '14px', fontWeight: '500' }}>{getStatusText()}</span>
                </div>
              </SettingRow>

              <SettingRow>
                <div>{t('settings.data.export_to_phone.lan.content')}</div>
              </SettingRow>

              {/* 二维码区域 */}
              <SettingRow style={{ display: 'flex', justifyContent: 'center', minHeight: '180px' }}>
                {isLoading ? (
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '12px' }}>
                    <Spinner />
                    <span style={{ fontSize: '14px', color: '#64748b' }}>正在生成二维码...</span>
                  </div>
                ) : !isConnected && qrCodeValue ? (
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '12px' }}>
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
                    <span style={{ fontSize: '12px', color: '#64748b' }}>请使用手机扫码连接</span>
                  </div>
                ) : isConnected ? (
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '12px' }}>
                    <div
                      style={{
                        width: '160px',
                        height: '160px',
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        justifyContent: 'center',
                        border: '2px dashed #22c55e',
                        borderRadius: '12px',
                        backgroundColor: '#f0fdf4'
                      }}>
                      <span style={{ fontSize: '48px' }}>📱</span>
                      <span style={{ fontSize: '14px', color: '#16a34a', marginTop: '8px' }}>连接成功</span>
                    </div>
                  </div>
                ) : connectionPhase === 'error' ? (
                  <div
                    style={{
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      gap: '12px',
                      padding: '20px',
                      border: '1px solid #fecaca',
                      borderRadius: '8px',
                      backgroundColor: '#fef2f2'
                    }}>
                    <span style={{ fontSize: '48px' }}>⚠️</span>
                    <span style={{ fontSize: '14px', color: '#dc2626' }}>连接失败</span>
                    {error && <span style={{ fontSize: '12px', color: '#7f1d1d' }}>{error}</span>}
                  </div>
                ) : null}
              </SettingRow>

              <SettingRow style={{ display: 'flex', alignItems: 'center' }}>
                <div style={{ display: 'flex', gap: 10, justifyContent: 'center', width: '100%' }}>
                  <Button color="default" variant="flat" onPress={handleSelectZip} isDisabled={isSending}>
                    {t('settings.data.export_to_phone.lan.selectZip')}
                  </Button>
                  <Button color="primary" onPress={handleSendZip} isDisabled={!canSend} isLoading={isSending}>
                    {getTransferStatusText() || t('settings.data.export_to_phone.lan.sendZip')}
                  </Button>
                </div>
              </SettingRow>

              <SettingHelpText
                style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', textAlign: 'center' }}>
                {selectedFolderPath || t('settings.data.export_to_phone.lan.noZipSelected')}
              </SettingHelpText>

              {(isSending || transferPhase === 'completed') && (
                <div style={{ paddingTop: 8 }}>
                  <div
                    style={{
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '8px',
                      padding: '12px',
                      border: '1px solid #e2e8f0',
                      borderRadius: '8px',
                      backgroundColor: '#f8fafc'
                    }}>
                    <div
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        fontSize: '14px',
                        fontWeight: '500'
                      }}>
                      <span style={{ color: '#475569' }}>传输进度</span>
                      <span style={{ color: transferPhase === 'completed' ? '#16a34a' : '#0ea5e9' }}>
                        {transferPhase === 'completed' ? '✅ 完成' : `${Math.round(sendProgress)}%`}
                      </span>
                    </div>

                    <Progress
                      value={Math.round(sendProgress)}
                      size="md"
                      color={transferPhase === 'completed' ? 'success' : 'primary'}
                      showValueLabel={false}
                      aria-label="Send progress"
                    />

                    {transferSpeed && (
                      <div
                        style={{
                          fontSize: '12px',
                          color: '#64748b',
                          textAlign: 'center'
                        }}>
                        {transferSpeed}
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* 错误信息显示 */}
              {error && transferPhase === 'error' && (
                <div
                  style={{
                    padding: '12px',
                    border: '1px solid #fecaca',
                    borderRadius: '8px',
                    backgroundColor: '#fef2f2',
                    textAlign: 'center'
                  }}>
                  <span style={{ fontSize: '14px', color: '#dc2626' }}>❌ {error}</span>
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
