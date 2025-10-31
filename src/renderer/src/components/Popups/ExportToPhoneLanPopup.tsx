import { Button } from '@heroui/button'
import { Modal, ModalBody, ModalContent, ModalFooter, ModalHeader } from '@heroui/modal'
import { Progress } from '@heroui/progress'
import { Spinner } from '@heroui/spinner'
import { loggerService } from '@logger'
import { SettingHelpText, SettingRow } from '@renderer/pages/settings'
import { QRCodeSVG } from 'qrcode.react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { TopView } from '../TopView'

const logger = loggerService.withContext('ExportToPhoneLanPopup')

interface Props {
  resolve: (data: any) => void
}

type ConnectionPhase = 'initializing' | 'waiting_qr_scan' | 'connecting' | 'connected' | 'disconnected' | 'error'
type TransferPhase = 'idle' | 'preparing' | 'sending' | 'completed' | 'error'

const LoadingQRCode: React.FC = () => {
  const { t } = useTranslation()
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '12px' }}>
      <Spinner />
      <span style={{ fontSize: '14px', color: 'var(--color-text-2)' }}>
        {t('settings.data.export_to_phone.lan.generating_qr')}
      </span>
    </div>
  )
}

const ScanQRCode: React.FC<{ qrCodeValue: string }> = ({ qrCodeValue }) => {
  const { t } = useTranslation()
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '12px' }}>
      <QRCodeSVG
        marginSize={4}
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
      <span style={{ fontSize: '12px', color: 'var(--color-text-2)' }}>
        {t('settings.data.export_to_phone.lan.scan_qr')}
      </span>
    </div>
  )
}

const ConnectingAnimation: React.FC = () => {
  const { t } = useTranslation()
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '12px' }}>
      <div
        style={{
          width: '160px',
          height: '160px',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          border: '2px dashed var(--color-status-warning)',
          borderRadius: '12px',
          backgroundColor: 'var(--color-status-warning)'
        }}>
        <Spinner size="lg" color="warning" />
        <span style={{ fontSize: '14px', color: 'var(--color-text)', marginTop: '12px' }}>
          {t('settings.data.export_to_phone.lan.status.connecting')}
        </span>
      </div>
    </div>
  )
}

const ConnectedDisplay: React.FC = () => {
  const { t } = useTranslation()
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '12px' }}>
      <div
        style={{
          width: '160px',
          height: '160px',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          border: '2px dashed var(--color-status-success)',
          borderRadius: '12px',
          backgroundColor: 'var(--color-status-success)'
        }}>
        <span style={{ fontSize: '48px' }}>📱</span>
        <span style={{ fontSize: '14px', color: 'var(--color-text)', marginTop: '8px' }}>
          {t('settings.data.export_to_phone.lan.connected')}
        </span>
      </div>
    </div>
  )
}

const ErrorQRCode: React.FC<{ error: string | null }> = ({ error }) => {
  const { t } = useTranslation()
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: '12px',
        padding: '20px',
        border: `1px solid var(--color-error)`,
        borderRadius: '8px',
        backgroundColor: 'var(--color-error)'
      }}>
      <span style={{ fontSize: '48px' }}>⚠️</span>
      <span style={{ fontSize: '14px', color: 'var(--color-text)' }}>
        {t('settings.data.export_to_phone.lan.connection_failed')}
      </span>
      {error && <span style={{ fontSize: '12px', color: 'var(--color-text-2)' }}>{error}</span>}
    </div>
  )
}

const PopupContainer: React.FC<Props> = ({ resolve }) => {
  const [isOpen, setIsOpen] = useState(true)
  const [connectionPhase, setConnectionPhase] = useState<ConnectionPhase>('initializing')
  const [transferPhase, setTransferPhase] = useState<TransferPhase>('idle')
  const [qrCodeValue, setQrCodeValue] = useState('')
  const [selectedFolderPath, setSelectedFolderPath] = useState<string | null>(null)
  const [sendProgress, setSendProgress] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [showCloseConfirm, setShowCloseConfirm] = useState(false)
  const [autoCloseCountdown, setAutoCloseCountdown] = useState<number | null>(null)

  const { t } = useTranslation()

  // 派生状态
  const isConnected = connectionPhase === 'connected'
  const canSend = isConnected && selectedFolderPath && transferPhase === 'idle'
  const isSending = transferPhase === 'preparing' || transferPhase === 'sending'

  // 状态文本映射
  const connectionStatusText = useMemo(() => {
    const statusMap = {
      initializing: t('settings.data.export_to_phone.lan.status.initializing'),
      waiting_qr_scan: t('settings.data.export_to_phone.lan.status.waiting_qr_scan'),
      connecting: t('settings.data.export_to_phone.lan.status.connecting'),
      connected: t('settings.data.export_to_phone.lan.status.connected'),
      disconnected: t('settings.data.export_to_phone.lan.status.disconnected'),
      error: t('settings.data.export_to_phone.lan.status.error')
    }
    return statusMap[connectionPhase]
  }, [connectionPhase, t])

  const transferStatusText = useMemo(() => {
    const statusMap = {
      idle: '',
      preparing: t('settings.data.export_to_phone.lan.status.preparing'),
      sending: t('settings.data.export_to_phone.lan.status.sending'),
      completed: t('settings.data.export_to_phone.lan.status.completed'),
      error: t('settings.data.export_to_phone.lan.status.error')
    }
    return statusMap[transferPhase]
  }, [transferPhase, t])

  // 状态样式映射
  const connectionStatusStyles = useMemo(() => {
    const styleMap = {
      initializing: {
        bg: 'var(--color-background-mute)',
        border: 'var(--color-border-mute)'
      },
      waiting_qr_scan: {
        bg: 'var(--color-primary-mute)',
        border: 'var(--color-primary-soft)'
      },
      connecting: { bg: 'var(--color-status-warning)', border: 'var(--color-status-warning)' },
      connected: {
        bg: 'var(--color-status-success)',
        border: 'var(--color-status-success)'
      },
      disconnected: { bg: 'var(--color-error)', border: 'var(--color-error)' },
      error: { bg: 'var(--color-error)', border: 'var(--color-error)' }
    }
    return styleMap[connectionPhase]
  }, [connectionPhase])

  const initWebSocket = useCallback(async () => {
    try {
      setConnectionPhase('initializing')
      await window.api.webSocket.start()
      const { port, ip } = await window.api.webSocket.status()

      if (ip && port) {
        const candidates = await window.api.webSocket.getAllCandidates()
        const connectionInfo = {
          type: 'cherry-studio-app',
          candidates,
          selectedHost: ip,
          port,
          timestamp: Date.now()
        }
        setQrCodeValue(JSON.stringify(connectionInfo))
        setConnectionPhase('waiting_qr_scan')
        logger.info(`QR code generated: ${ip}:${port} with ${candidates.length} IP candidates`)
      } else {
        setError(t('settings.data.export_to_phone.lan.error.no_ip'))
        setConnectionPhase('error')
      }
    } catch (error) {
      setError(
        `${t('settings.data.export_to_phone.lan.error.init_failed')}: ${error instanceof Error ? error.message : ''}`
      )
      setConnectionPhase('error')
      logger.error('Failed to initialize WebSocket:', error as Error)
    }
  }, [t])

  const handleClientConnected = useCallback((_event: any, data: { connected: boolean }) => {
    logger.info(`Client connection status: ${data.connected ? 'connected' : 'disconnected'}`)
    if (data.connected) {
      setConnectionPhase('connected')
      setError(null)
    } else {
      setConnectionPhase('disconnected')
    }
  }, [])

  const handleMessageReceived = useCallback((_event: any, data: any) => {
    logger.info(`Received message from mobile: ${JSON.stringify(data)}`)
  }, [])

  const handleSendProgress = useCallback(
    (_event: any, data: { progress: number }) => {
      const progress = data.progress
      setSendProgress(progress)

      if (transferPhase === 'preparing' && progress > 0) {
        setTransferPhase('sending')
      }

      if (progress >= 100) {
        setTransferPhase('completed')
        // 启动 3 秒倒计时自动关闭
        setAutoCloseCountdown(3)
      }
    },
    [transferPhase]
  )

  const handleSelectZip = useCallback(async () => {
    const result = await window.api.file.select()
    if (result) {
      setSelectedFolderPath(result[0].path)
    }
  }, [])

  const handleSendZip = useCallback(async () => {
    if (!selectedFolderPath) {
      setError(t('settings.data.export_to_phone.lan.error.no_file'))
      return
    }

    setTransferPhase('preparing')
    setError(null)
    setSendProgress(0)

    try {
      logger.info(`Starting file transfer: ${selectedFolderPath}`)
      await window.api.webSocket.sendFile(selectedFolderPath)
    } catch (error) {
      setError(
        `${t('settings.data.export_to_phone.lan.error.send_failed')}: ${error instanceof Error ? error.message : ''}`
      )
      setTransferPhase('error')
      logger.error('Failed to send file:', error as Error)
    }
  }, [selectedFolderPath, t])

  // 尝试关闭弹窗 - 如果正在传输则显示确认
  const handleCancel = useCallback(() => {
    if (isSending) {
      setShowCloseConfirm(true)
    } else {
      setIsOpen(false)
    }
  }, [isSending])

  // 确认强制关闭
  const handleForceClose = useCallback(() => {
    logger.info('Force closing popup during transfer')
    setIsOpen(false)
  }, [])

  // 取消关闭确认
  const handleCancelClose = useCallback(() => {
    setShowCloseConfirm(false)
  }, [])

  // 清理并关闭
  const handleClose = useCallback(async () => {
    try {
      // 主动断开 WebSocket 连接
      if (isConnected || connectionPhase !== 'disconnected') {
        logger.info('Closing popup, stopping WebSocket')
        await window.api.webSocket.stop()
      }
    } catch (error) {
      logger.error('Failed to stop WebSocket on close:', error as Error)
    }
    resolve({})
  }, [resolve, isConnected, connectionPhase])

  useEffect(() => {
    initWebSocket()

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 自动关闭倒计时
  useEffect(() => {
    if (autoCloseCountdown === null) return

    if (autoCloseCountdown <= 0) {
      logger.debug('Auto-closing popup after transfer completion')
      setIsOpen(false)
      return
    }

    const timer = setTimeout(() => {
      setAutoCloseCountdown(autoCloseCountdown - 1)
    }, 1000)

    return () => clearTimeout(timer)
  }, [autoCloseCountdown])

  // 状态指示器组件
  const StatusIndicator = useCallback(
    () => (
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          padding: '8px 12px',
          borderRadius: '8px',
          backgroundColor: connectionStatusStyles.bg,
          border: `1px solid ${connectionStatusStyles.border}`
        }}>
        <span style={{ fontSize: '14px', fontWeight: '500', color: 'var(--color-text)' }}>{connectionStatusText}</span>
      </div>
    ),
    [connectionStatusStyles, connectionStatusText]
  )

  // 二维码显示组件 - 使用显式条件渲染以避免类型不匹配
  const QRCodeDisplay = useCallback(() => {
    switch (connectionPhase) {
      case 'waiting_qr_scan':
      case 'disconnected':
        return <ScanQRCode qrCodeValue={qrCodeValue} />
      case 'initializing':
        return <LoadingQRCode />
      case 'connecting':
        return <ConnectingAnimation />
      case 'connected':
        return <ConnectedDisplay />
      case 'error':
        return <ErrorQRCode error={error} />
      default:
        return null
    }
  }, [connectionPhase, qrCodeValue, error])

  // 传输进度组件
  const TransferProgress = useCallback(() => {
    if (!isSending && transferPhase !== 'completed') return null

    return (
      <div style={{ paddingTop: '8px' }}>
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: '8px',
            padding: '12px',
            border: `1px solid var(--color-border)`,
            borderRadius: '8px',
            backgroundColor: 'var(--color-background-mute)'
          }}>
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              fontSize: '14px',
              fontWeight: '500'
            }}>
            <span style={{ color: 'var(--color-text)' }}>
              {t('settings.data.export_to_phone.lan.transfer_progress')}
            </span>
            <span
              style={{ color: transferPhase === 'completed' ? 'var(--color-status-success)' : 'var(--color-primary)' }}>
              {transferPhase === 'completed' ? '✅ ' + t('common.completed') : `${Math.round(sendProgress)}%`}
            </span>
          </div>

          <Progress
            value={Math.round(sendProgress)}
            size="md"
            color={transferPhase === 'completed' ? 'success' : 'primary'}
            showValueLabel={false}
            aria-label="Send progress"
          />
        </div>
      </div>
    )
  }, [isSending, transferPhase, sendProgress, t])

  const AutoCloseCountdown = useCallback(() => {
    if (transferPhase !== 'completed' || autoCloseCountdown === null || autoCloseCountdown <= 0) return null

    return (
      <div
        style={{
          fontSize: '12px',
          color: 'var(--color-text-2)',
          textAlign: 'center',
          paddingTop: '4px'
        }}>
        {t('settings.data.export_to_phone.lan.auto_close_tip', { seconds: autoCloseCountdown })}
      </div>
    )
  }, [transferPhase, autoCloseCountdown, t])

  // 错误显示组件
  const ErrorDisplay = useCallback(() => {
    if (!error || transferPhase !== 'error') return null

    return (
      <div
        style={{
          padding: '12px',
          border: `1px solid var(--color-error)`,
          borderRadius: '8px',
          backgroundColor: 'var(--color-error)',
          textAlign: 'center'
        }}>
        <span style={{ fontSize: '14px', color: 'var(--color-text)' }}>❌ {error}</span>
      </div>
    )
  }, [error, transferPhase])

  return (
    <Modal
      isOpen={isOpen}
      onOpenChange={(open) => {
        if (!open) {
          handleCancel()
        }
      }}
      isDismissable={false}
      isKeyboardDismissDisabled={false}
      placement="center"
      onClose={handleClose}>
      <ModalContent>
        {() => (
          <>
            <ModalHeader>{t('settings.data.export_to_phone.lan.title')}</ModalHeader>
            <ModalBody>
              <SettingRow>
                <StatusIndicator />
              </SettingRow>

              <SettingRow>
                <div>{t('settings.data.export_to_phone.lan.content')}</div>
              </SettingRow>

              <SettingRow style={{ display: 'flex', justifyContent: 'center', minHeight: '180px' }}>
                <QRCodeDisplay />
              </SettingRow>

              <SettingRow style={{ display: 'flex', alignItems: 'center' }}>
                <div style={{ display: 'flex', gap: 10, justifyContent: 'center', width: '100%' }}>
                  <Button color="default" variant="flat" onPress={handleSelectZip} isDisabled={isSending}>
                    {t('settings.data.export_to_phone.lan.selectZip')}
                  </Button>
                  <Button color="primary" onPress={handleSendZip} isDisabled={!canSend} isLoading={isSending}>
                    {transferStatusText || t('settings.data.export_to_phone.lan.sendZip')}
                  </Button>
                </div>
              </SettingRow>

              <SettingHelpText
                style={{
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                  textAlign: 'center'
                }}>
                {selectedFolderPath || t('settings.data.export_to_phone.lan.noZipSelected')}
              </SettingHelpText>

              <TransferProgress />
              <AutoCloseCountdown />
              <ErrorDisplay />
            </ModalBody>

            {showCloseConfirm && (
              <ModalFooter>
                <div
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    width: '100%',
                    gap: '12px',
                    padding: '8px',
                    borderRadius: '8px',
                    backgroundColor: 'var(--color-status-warning)',
                    border: '1px solid var(--color-status-warning)'
                  }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span style={{ fontSize: '20px' }}>⚠️</span>
                    <span style={{ fontSize: '14px', color: 'var(--color-text)', fontWeight: '500' }}>
                      {t('settings.data.export_to_phone.lan.confirm_close_title')}
                    </span>
                  </div>
                  <span style={{ fontSize: '13px', color: 'var(--color-text-2)', marginLeft: '28px' }}>
                    {t('settings.data.export_to_phone.lan.confirm_close_message')}
                  </span>
                  <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '4px' }}>
                    <Button size="sm" color="default" variant="flat" onPress={handleCancelClose}>
                      {t('common.cancel')}
                    </Button>
                    <Button size="sm" color="danger" onPress={handleForceClose}>
                      {t('settings.data.export_to_phone.lan.force_close')}
                    </Button>
                  </div>
                </div>
              </ModalFooter>
            )}
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
