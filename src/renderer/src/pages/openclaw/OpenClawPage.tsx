import OpenClawLogo from '@renderer/assets/images/providers/openclaw.svg'
import { Navbar, NavbarCenter } from '@renderer/components/app/Navbar'
import ModelSelector from '@renderer/components/ModelSelector'
import { useMinappPopup } from '@renderer/hooks/useMinappPopup'
import { useProviders } from '@renderer/hooks/useProvider'
import { loggerService } from '@renderer/services/LoggerService'
import { useAppDispatch, useAppSelector } from '@renderer/store'
import {
  type GatewayStatus,
  type HealthInfo,
  setGatewayStatus,
  setLastHealthCheck,
  setSelectedModelUniqId
} from '@renderer/store/openclaw'
import { IpcChannel } from '@shared/IpcChannel'
import { Alert, Avatar, Button, Result, Space, Spin } from 'antd'
import { Download, ExternalLink, Play, RefreshCw, Square } from 'lucide-react'
import type { FC } from 'react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

const logger = loggerService.withContext('OpenClawPage')

const OpenClawPage: FC = () => {
  const { t } = useTranslation()
  const dispatch = useAppDispatch()
  const { providers } = useProviders()
  const { openSmartMinapp } = useMinappPopup()

  const { gatewayStatus, gatewayPort, selectedModelUniqId, lastHealthCheck } = useAppSelector((state) => state.openclaw)

  const [error, setError] = useState<string | null>(null)
  const [isInstalled, setIsInstalled] = useState<boolean | null>(null) // null = unknown, checking in background
  const [installPath, setInstallPath] = useState<string | null>(null)
  const [installError, setInstallError] = useState<string | null>(null)

  // Separate loading states for each action
  const [isInstalling, setIsInstalling] = useState(false)
  const [isUninstalling, setIsUninstalling] = useState(false)
  const [isStarting, setIsStarting] = useState(false)
  const [isStopping, setIsStopping] = useState(false)
  const [isRestarting, setIsRestarting] = useState(false)

  // Install progress logs
  const [installLogs, setInstallLogs] = useState<Array<{ message: string; type: 'info' | 'warn' | 'error' }>>([])
  const [showLogs, setShowLogs] = useState(false)
  const [uninstallSuccess, setUninstallSuccess] = useState(false)
  const [npmMissing, setNpmMissing] = useState(false)
  const [nodeDownloadUrl, setNodeDownloadUrl] = useState<string>('https://nodejs.org/')

  // Fetch Node.js download URL and poll npm availability when npmMissing is shown
  useEffect(() => {
    if (!npmMissing) return

    // Fetch the download URL from main process
    window.api.openclaw
      .getNodeDownloadUrl()
      .then(setNodeDownloadUrl)
      .catch(() => {})

    // Poll npm availability
    const pollInterval = setInterval(async () => {
      try {
        const npmCheck = await window.api.openclaw.checkNpmAvailable()
        if (npmCheck.available) {
          setNpmMissing(false)
        }
      } catch {
        // Ignore errors during polling
      }
    }, 3000) // Check every 3 seconds

    return () => clearInterval(pollInterval)
  }, [npmMissing])

  // Filter enabled providers with API keys
  const availableProviders = providers.filter((p) => p.enabled && p.apiKey)

  // Find selected model and provider from the uniqId
  const selectedModelInfo = useMemo(() => {
    if (!selectedModelUniqId) return null
    try {
      const parsed = JSON.parse(selectedModelUniqId) as { id: string; provider: string }
      for (const p of availableProviders) {
        const model = p.models.find((m) => m.id === parsed.id && m.provider === parsed.provider)
        if (model) {
          return { provider: p, model }
        }
      }
    } catch {
      // Invalid JSON
    }
    return null
  }, [selectedModelUniqId, availableProviders])

  const selectedProvider = selectedModelInfo?.provider ?? null
  const selectedModel = selectedModelInfo?.model ?? null

  const checkInstallation = useCallback(async () => {
    try {
      const result = await window.api.openclaw.checkInstalled()
      setIsInstalled(result.installed)
      setShowLogs(false)
      setInstallPath(result.path)
    } catch (err) {
      logger.debug('Failed to check installation', err as Error)
      setIsInstalled(false)
    } finally {
    }
  }, [])

  const handleInstall = useCallback(async () => {
    // Check npm availability first
    try {
      const npmCheck = await window.api.openclaw.checkNpmAvailable()
      if (!npmCheck.available) {
        setNpmMissing(true)
        return
      }
    } catch (err) {
      logger.error('Failed to check npm availability', err as Error)
    }

    setNpmMissing(false)
    setIsInstalling(true)
    setInstallError(null)
    setInstallLogs([])
    setShowLogs(true)
    try {
      const result = await window.api.openclaw.install()
      if (result.success) {
        await checkInstallation()
      } else {
        setInstallError(result.message)
      }
    } catch (err) {
      logger.error('Failed to install OpenClaw', err as Error)
      setInstallError(err instanceof Error ? err.message : String(err))
    } finally {
      setIsInstalling(false)
    }
  }, [checkInstallation])

  const handleUninstall = useCallback(async () => {
    // Use window.confirm for confirmation
    const confirmed = window.confirm(t('openclaw.uninstall_confirm'))
    if (!confirmed) {
      return // User cancelled
    }

    setIsUninstalling(true)
    setUninstallSuccess(false)
    setInstallError(null)
    setInstallLogs([])
    setShowLogs(true)
    try {
      const result = await window.api.openclaw.uninstall()
      if (result.success) {
        setUninstallSuccess(true)
      } else {
        setInstallError(result.message)
        setIsUninstalling(false)
      }
    } catch (err) {
      logger.error('Failed to uninstall OpenClaw', err as Error)
      setInstallError(err instanceof Error ? err.message : String(err))
      setIsUninstalling(false)
    }
  }, [t])

  const handleUninstallComplete = useCallback(() => {
    setShowLogs(false)
    setIsUninstalling(false)
    if (uninstallSuccess) {
      setIsInstalled(false)
      setUninstallSuccess(false)
    }
  }, [uninstallSuccess])

  const fetchStatus = useCallback(async () => {
    try {
      const status = await window.api.openclaw.getStatus()
      dispatch(setGatewayStatus(status.status as GatewayStatus))
    } catch (err) {
      logger.debug('Failed to fetch status', err as Error)
    }
  }, [dispatch])

  const fetchHealth = useCallback(async () => {
    try {
      const health = await window.api.openclaw.checkHealth()
      dispatch(setLastHealthCheck(health as HealthInfo))
    } catch (err) {
      logger.debug('Failed to check health', err as Error)
    }
  }, [dispatch])

  useEffect(() => {
    checkInstallation()
  }, [checkInstallation])

  // Listen for install progress events
  useEffect(() => {
    const cleanup = window.electron.ipcRenderer.on(
      IpcChannel.OpenClaw_InstallProgress,
      (_, data: { message: string; type: 'info' | 'warn' | 'error' }) => {
        setInstallLogs((prev) => [...prev, data])
      }
    )
    return cleanup
  }, [])

  useEffect(() => {
    if (!isInstalled) return

    fetchStatus()
    if (gatewayStatus === 'running') {
      fetchHealth()
    }
    const interval = setInterval(() => {
      // Also check if openclaw is still installed (handles external uninstall)
      checkInstallation()
      fetchStatus()
      if (gatewayStatus === 'running') {
        fetchHealth()
      }
    }, 5000)
    return () => clearInterval(interval)
  }, [fetchStatus, fetchHealth, checkInstallation, gatewayStatus, isInstalled])

  const handleModelSelect = (modelUniqId: string) => {
    dispatch(setSelectedModelUniqId(modelUniqId))
  }

  const handleStartGateway = async () => {
    if (!selectedProvider || !selectedModel) {
      setError(t('openclaw.error.select_provider_model'))
      return
    }

    setIsStarting(true)
    setError(null)

    try {
      // First sync the configuration (auth token will be auto-generated in main process)
      const syncResult = await window.api.openclaw.syncConfig(selectedProvider, selectedModel)
      if (!syncResult.success) {
        setError(syncResult.message)
        return
      }

      // Then start the gateway
      const startResult = await window.api.openclaw.startGateway(gatewayPort)
      if (!startResult.success) {
        setError(startResult.message)
        return
      }

      // Auto open dashboard first
      const dashboardUrl = await window.api.openclaw.getDashboardUrl()
      openSmartMinapp({
        id: 'openclaw-dashboard',
        name: t('openclaw.quick_actions.open_dashboard'),
        url: dashboardUrl,
        logo: OpenClawLogo
      })

      // Delay 500ms before updating UI state (wait for minapp animation)
      setTimeout(() => {
        dispatch(setGatewayStatus('running'))
        setIsStarting(false)
      }, 500)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setIsStarting(false)
    }
  }

  const handleStopGateway = async () => {
    setIsStopping(true)
    try {
      const result = await window.api.openclaw.stopGateway()
      if (result.success) {
        dispatch(setGatewayStatus('stopped'))
      } else {
        setError(result.message)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setIsStopping(false)
    }
  }

  const handleRestartGateway = async () => {
    setIsRestarting(true)
    try {
      const result = await window.api.openclaw.restartGateway()
      if (result.success) {
        dispatch(setGatewayStatus('running'))
      } else {
        setError(result.message)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setIsRestarting(false)
    }
  }

  const handleOpenDashboard = async () => {
    const dashboardUrl = await window.api.openclaw.getDashboardUrl()
    openSmartMinapp({
      id: 'openclaw-dashboard',
      name: t('openclaw.quick_actions.open_dashboard'),
      url: dashboardUrl,
      logo: OpenClawLogo
    })
  }

  const renderLogContainer = (expanded = false) => (
    <div className="mb-6 overflow-hidden rounded-lg" style={{ background: 'var(--color-background-soft)' }}>
      <div
        className="flex items-center justify-between px-3 py-2 font-medium text-[13px]"
        style={{ background: 'var(--color-background-mute)' }}>
        <span>{t(expanded ? 'openclaw.uninstall_progress' : 'openclaw.install_progress')}</span>
        {!expanded && (
          <Button size="small" type="text" onClick={() => setShowLogs(false)}>
            {t('common.close')}
          </Button>
        )}
      </div>
      <div
        className={`overflow-y-auto px-3 py-2 font-mono text-xs leading-relaxed ${expanded ? 'h-[300px]' : 'h-[150px]'}`}>
        {installLogs.map((log, index) => (
          <div
            key={index}
            className="whitespace-pre-wrap break-all"
            style={{
              color:
                log.type === 'error'
                  ? 'var(--color-error)'
                  : log.type === 'warn'
                    ? 'var(--color-warning)'
                    : 'var(--color-text-2)'
            }}>
            {log.message}
          </div>
        ))}
      </div>
    </div>
  )

  const renderNotInstalledContent = () => (
    <div id="content-container" className="flex flex-1 overflow-y-auto py-5">
      <div className="m-auto min-h-fit w-[600px]">
        <Result
          icon={<Avatar src={OpenClawLogo} size={64} shape="square" style={{ borderRadius: 12 }} />}
          title={t('openclaw.not_installed.title')}
          subTitle={t('openclaw.not_installed.description')}
          extra={
            <Space>
              <Button
                type="primary"
                icon={<Download size={16} />}
                disabled={isInstalling}
                onClick={handleInstall}
                loading={isInstalling}>
                {t('openclaw.not_installed.install_button')}
              </Button>
              <Button
                icon={<ExternalLink size={16} />}
                disabled={isInstalling}
                onClick={() => window.open('https://docs.openclaw.ai/', '_blank')}>
                {t('openclaw.quick_actions.view_docs')}
              </Button>
            </Space>
          }
        />
        {npmMissing && (
          <Alert
            message={t('openclaw.npm_missing.title')}
            description={
              <div>
                <p>{t('openclaw.npm_missing.description')}</p>
                <Space style={{ marginTop: 8 }}>
                  <Button
                    type="primary"
                    icon={<Download size={16} />}
                    onClick={() => window.open(nodeDownloadUrl, '_blank')}>
                    {t('openclaw.npm_missing.download_button')}
                  </Button>
                </Space>
                <p className="mt-3 text-xs" style={{ color: 'var(--color-text-3)' }}>
                  {t('openclaw.npm_missing.hint')}
                </p>
              </div>
            }
            type="warning"
            showIcon
            closable
            onClose={() => setNpmMissing(false)}
            className="!rounded-lg mt-4"
          />
        )}
        {installError && (
          <Alert
            message={installError}
            type="error"
            closable
            onClose={() => setInstallError(null)}
            style={{ marginBottom: 16 }}
          />
        )}

        {showLogs && installLogs.length > 0 && renderLogContainer()}
      </div>
    </div>
  )

  const renderInstalledContent = () => (
    <div id="content-container" className="flex flex-1 overflow-y-auto py-5">
      <div className="m-auto min-h-fit w-[600px]">
        {/* Title Section */}
        <div className="mb-8 flex items-start gap-4">
          <Avatar src={OpenClawLogo} size={48} shape="square" style={{ borderRadius: 10 }} />
          <div className="flex-1">
            <h1 className="mb-1 font-semibold text-2xl" style={{ color: 'var(--color-text-1)' }}>
              {t('openclaw.title')}
            </h1>
            <p className="text-sm leading-relaxed" style={{ color: 'var(--color-text-2)' }}>
              {t('openclaw.description')}{' '}
              <span
                className="inline-flex cursor-pointer items-center gap-1 whitespace-nowrap text-[13px] hover:underline"
                style={{ color: 'var(--color-primary)' }}
                onClick={() => window.open('https://docs.openclaw.ai/', '_blank')}>
                {t('openclaw.quick_actions.view_docs')}
                <ExternalLink size={12} />
              </span>
            </p>
          </div>
        </div>

        {/* Install Path */}
        {installPath && (
          <div
            className="mb-6 flex items-center justify-between rounded-lg px-3 py-2 text-sm"
            style={{ background: 'var(--color-background-soft)', color: 'var(--color-text-3)' }}>
            <span>{t('openclaw.installed_at', { path: installPath })}</span>
            <span
              className={`whitespace-nowrap text-xs ${
                gatewayStatus === 'running' ? 'cursor-not-allowed' : 'cursor-pointer hover:text-[var(--color-error)]'
              }`}
              style={{ color: gatewayStatus === 'running' ? 'var(--color-text-4)' : 'var(--color-text-3)' }}
              onClick={gatewayStatus === 'running' ? undefined : handleUninstall}>
              {t('openclaw.quick_actions.uninstall')}
            </span>
          </div>
        )}

        {/* Gateway Status Card - only show when running */}
        {gatewayStatus === 'running' && (
          <div
            className="mb-6 flex items-center justify-between rounded-lg p-3"
            style={{ background: 'var(--color-background-soft)' }}>
            <div className="flex items-center gap-2">
              <div className="h-2 w-2 rounded-full bg-green-500" />
              <span className="font-medium text-sm" style={{ color: 'var(--color-text-1)' }}>
                {t('openclaw.status.running')}
              </span>
              {lastHealthCheck?.version && (
                <span className="text-xs" style={{ color: 'var(--color-text-3)' }}>
                  v{lastHealthCheck.version}
                </span>
              )}
              <span className="font-mono text-[13px]" style={{ color: 'var(--color-text-3)' }}>
                :{gatewayPort}
              </span>
            </div>
            <div className="flex gap-1">
              <Button
                size="small"
                type="text"
                icon={<RefreshCw size={14} />}
                onClick={handleRestartGateway}
                loading={isRestarting}
                disabled={isStopping || isRestarting}>
                {t('openclaw.gateway.restart')}
              </Button>
              <Button
                size="small"
                type="text"
                icon={<Square size={14} />}
                onClick={handleStopGateway}
                loading={isStopping}
                disabled={isStopping || isRestarting}
                danger>
                {t('openclaw.gateway.stop')}
              </Button>
            </div>
          </div>
        )}

        {/* Error Alert */}
        {error && (
          <div className="mb-6">
            <Alert message={error} type="error" closable onClose={() => setError(null)} className="!rounded-lg" />
          </div>
        )}

        {/* Model Selector - only show when not running */}
        {gatewayStatus !== 'running' && (
          <div className="mb-6">
            <div className="mb-2 flex items-center gap-2 font-medium text-sm" style={{ color: 'var(--color-text-1)' }}>
              {t('openclaw.model_config.model')}
            </div>
            <ModelSelector
              style={{ width: '100%' }}
              placeholder={t('openclaw.model_config.select_model')}
              providers={availableProviders}
              value={selectedModelUniqId}
              onChange={handleModelSelect}
              grouped
              showAvatar
              showSuffix
            />
            <div className="mt-1 text-xs" style={{ color: 'var(--color-text-3)' }}>
              {t('openclaw.model_config.sync_hint')}
            </div>
          </div>
        )}

        {showLogs && installLogs.length > 0 && renderLogContainer()}

        {/* Action Button */}
        {gatewayStatus !== 'running' && (
          <Button
            type="primary"
            icon={<Play size={16} />}
            onClick={handleStartGateway}
            loading={isStarting || gatewayStatus === 'starting'}
            disabled={!selectedProvider || !selectedModel || isStarting || gatewayStatus === 'starting'}
            size="large"
            block>
            {t('openclaw.gateway.start')}
          </Button>
        )}
        {gatewayStatus === 'running' && (
          <Button type="primary" onClick={handleOpenDashboard} size="large" block>
            {t('openclaw.quick_actions.open_dashboard')}
          </Button>
        )}
      </div>
    </div>
  )

  // Render uninstalling page - only show logs
  const renderUninstallingContent = () => (
    <div id="content-container" className="flex flex-1 overflow-y-auto py-5">
      <div className="m-auto min-h-fit w-[600px]">
        {/* Title Section */}
        <div className="mb-8 flex items-start gap-4">
          <Avatar src={OpenClawLogo} size={48} shape="square" style={{ borderRadius: 10 }} />
          <div className="flex-1">
            <h1 className="mb-1 font-semibold text-2xl" style={{ color: 'var(--color-text-1)' }}>
              {t(uninstallSuccess ? 'openclaw.uninstalled.title' : 'openclaw.uninstalling.title')}
            </h1>
            <span className="text-sm leading-relaxed" style={{ color: 'var(--color-text-2)' }}>
              {t(uninstallSuccess ? 'openclaw.uninstalled.description' : 'openclaw.uninstalling.description')}
            </span>
          </div>
        </div>

        {installError && (
          <div className="mb-6">
            <Alert
              message={installError}
              type="error"
              closable
              onClose={() => setInstallError(null)}
              className="!rounded-lg"
            />
          </div>
        )}

        {renderLogContainer(true)}

        <Button disabled={!uninstallSuccess} type="primary" onClick={handleUninstallComplete} block size="large">
          {t('common.close')}
        </Button>
      </div>
    </div>
  )

  return (
    <div className="flex flex-1 flex-col">
      <Navbar>
        <NavbarCenter style={{ borderRight: 'none' }}>{t('openclaw.title')}</NavbarCenter>
      </Navbar>

      {isUninstalling ? (
        renderUninstallingContent()
      ) : isInstalled === null ? (
        <div id="content-container" className="flex flex-1 flex-col items-center justify-center">
          <Spin size="large" />
          <div className="mt-4" style={{ color: 'var(--color-text-3)' }}>
            {t('openclaw.checking_installation')}
          </div>
        </div>
      ) : isInstalled ? (
        renderInstalledContent()
      ) : (
        renderNotInstalledContent()
      )}
    </div>
  )
}

export default OpenClawPage
