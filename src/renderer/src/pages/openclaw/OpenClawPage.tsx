import OpenClawLogo from '@renderer/assets/images/providers/openclaw.svg'
import { Navbar, NavbarCenter } from '@renderer/components/app/Navbar'
import { CopyIcon } from '@renderer/components/Icons'
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
import type { NodeCheckResult } from '@shared/config/types'
import { IpcChannel } from '@shared/IpcChannel'
import { Alert, Avatar, Button, Result, Space, Spin } from 'antd'
import { Download, ExternalLink, Play, RefreshCw, Square } from 'lucide-react'
import type { FC } from 'react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

const logger = loggerService.withContext('OpenClawPage')

const DEFAULT_DOCS_URL = 'https://docs.openclaw.ai/'

type NodeStatus = { status: 'not_found' } | { status: 'version_low'; version: string } | { status: 'ok' }

/** Map the IPC result to the UI-side NodeStatus (drops the `path` field the renderer doesn't need). */
function toNodeStatus(result: NodeCheckResult): NodeStatus {
  if (result.status === 'version_low') return { status: 'version_low', version: result.version }
  if (result.status === 'ok') return { status: 'ok' }
  return { status: 'not_found' }
}

interface TitleSectionProps {
  title: string
  description: string
  clickable?: boolean
  docsUrl?: string
}

const TitleSection: FC<TitleSectionProps> = ({ title, description, clickable = false, docsUrl }) => (
  <div className="-mt-20 mb-8 flex flex-col items-center text-center">
    <Avatar
      src={OpenClawLogo}
      size={64}
      shape="square"
      className={clickable ? 'cursor-pointer' : undefined}
      style={{ borderRadius: 12 }}
      onClick={clickable ? () => window.open(docsUrl ?? DEFAULT_DOCS_URL, '_blank') : undefined}
    />
    <h1
      className={`mt-3 font-semibold text-2xl ${clickable ? 'cursor-pointer hover:text-(--color-primary)' : ''}`}
      style={{ color: 'var(--color-text-1)' }}
      onClick={clickable ? () => window.open(docsUrl ?? DEFAULT_DOCS_URL, '_blank') : undefined}>
      {title}
    </h1>
    <p className="mt-3 text-sm leading-relaxed" style={{ color: 'var(--color-text-2)' }}>
      {description}
    </p>
  </div>
)

const OpenClawPage: FC = () => {
  const { t, i18n } = useTranslation()
  const dispatch = useAppDispatch()
  const { providers } = useProviders()
  const { openSmartMinapp } = useMinappPopup()

  const docsUrl = useMemo(() => {
    const lang = i18n.language?.toLowerCase() ?? ''
    if (lang.startsWith('zh-cn')) {
      return 'https://docs.openclaw.ai/zh-CN'
    }
    return DEFAULT_DOCS_URL
  }, [i18n.language])

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
  const [nodeStatus, setNodeStatus] = useState<NodeStatus | null>(null)
  const [gitMissing, setGitMissing] = useState(false)
  const [nodeDownloadUrl, setNodeDownloadUrl] = useState<string>('https://nodejs.org/')
  const [gitDownloadUrl, setGitDownloadUrl] = useState<string>('https://git-scm.com/downloads')

  // Fetch Node.js download URL and poll node availability when node issue is shown
  useEffect(() => {
    if (!nodeStatus || nodeStatus.status === 'ok') return

    // Fetch the download URL from main process
    window.api.openclaw
      .getNodeDownloadUrl()
      .then(setNodeDownloadUrl)
      .catch(() => {})

    // Poll node version availability
    const pollInterval = setInterval(async () => {
      try {
        const result = await window.api.openclaw.checkNodeVersion()
        if (result.status === 'ok') {
          setNodeStatus({ status: 'ok' })
        }
      } catch {
        // Ignore errors during polling
      }
    }, 3000)

    return () => clearInterval(pollInterval)
  }, [nodeStatus])

  // Fetch Git download URL and poll git availability when gitMissing is shown
  useEffect(() => {
    if (!gitMissing) return

    // Fetch the download URL from main process
    window.api.openclaw
      .getGitDownloadUrl()
      .then(setGitDownloadUrl)
      .catch(() => {})

    const pollInterval = setInterval(async () => {
      try {
        const gitCheck = await window.api.openclaw.checkGitAvailable()
        if (gitCheck.available) {
          setGitMissing(false)
        }
      } catch {
        // Ignore errors during polling
      }
    }, 3000)

    return () => clearInterval(pollInterval)
  }, [gitMissing])

  const noApiKeyProviders = ['ollama', 'lmstudio', 'gpustack']
  const availableProviders = providers.filter((p) => p.enabled && (p.apiKey || noApiKeyProviders.includes(p.type)))

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

  type PageState = 'checking' | 'not_installed' | 'installed' | 'installing' | 'uninstalling'
  const pageState: PageState = useMemo(() => {
    if (isUninstalling) return 'uninstalling'
    if (isInstalling) return 'installing'
    if (isInstalled === null) return 'checking'
    if (isInstalled) return 'installed'
    return 'not_installed'
  }, [isInstalled, isInstalling, isUninstalling])

  const checkInstallation = useCallback(async () => {
    try {
      const result = await window.api.openclaw.checkInstalled()
      setIsInstalled(result.installed)
      setShowLogs(false)
      setInstallPath(result.path)

      // If not installed, check node version and git availability in parallel
      if (!result.installed) {
        const [nodeResult, gitResult] = await Promise.allSettled([
          window.api.openclaw.checkNodeVersion(),
          window.api.openclaw.checkGitAvailable()
        ])
        if (nodeResult.status === 'fulfilled') {
          setNodeStatus(toNodeStatus(nodeResult.value))
        }
        if (gitResult.status === 'fulfilled') setGitMissing(!gitResult.value.available)
      }
    } catch (err) {
      logger.debug('Failed to check installation', err as Error)
      setIsInstalled(false)
    }
  }, [])

  const handleInstall = useCallback(async () => {
    // Check node version and git availability in parallel before installing
    const [nodeResult, gitResult] = await Promise.allSettled([
      window.api.openclaw.checkNodeVersion(),
      window.api.openclaw.checkGitAvailable()
    ])

    if (nodeResult.status === 'rejected' || gitResult.status === 'rejected') {
      logger.error('Failed to check tool availability')
      return
    }
    const nodeCheck = toNodeStatus(nodeResult.value)
    if (nodeCheck.status !== 'ok') {
      setNodeStatus(nodeCheck)
      return
    }
    if (!gitResult.value.available) {
      setGitMissing(true)
      return
    }

    setNodeStatus(nodeCheck)
    setGitMissing(false)
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
    if (pageState !== 'installed') return

    fetchStatus()
    if (gatewayStatus === 'running') {
      fetchHealth()
    }
    const interval = setInterval(() => {
      checkInstallation()
      fetchStatus()
      if (gatewayStatus === 'running') {
        fetchHealth()
      }
    }, 5000)
    return () => clearInterval(interval)
  }, [fetchStatus, fetchHealth, checkInstallation, gatewayStatus, pageState])

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
        name: 'OpenClaw',
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
      name: 'OpenClaw',
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
      <div className={`overflow-y-auto px-3 py-2 font-mono text-xs leading-relaxed ${expanded ? 'h-75' : 'h-37.5'}`}>
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
    <div id="content-container" className="flex flex-1 flex-col overflow-y-auto py-5">
      <div className="flex-1" />
      <div className="mx-auto min-h-fit w-130 shrink-0">
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
                onClick={() => window.open(docsUrl, '_blank')}>
                {t('openclaw.quick_actions.view_docs')}
              </Button>
            </Space>
          }
        />
        <div className="mt-4 space-y-3" style={{ width: 580, marginLeft: -30 }}>
          {nodeStatus?.status === 'not_found' && (
            <Alert
              message={t('openclaw.node_missing.title')}
              description={
                <div>
                  <p>{t('openclaw.node_missing.description')}</p>
                  <Space style={{ marginTop: 8 }}>
                    <Button
                      type="primary"
                      icon={<Download size={16} />}
                      onClick={() => window.open(nodeDownloadUrl, '_blank')}>
                      {t('openclaw.node_missing.download_button')}
                    </Button>
                  </Space>
                  <p className="mt-3 text-xs" style={{ color: 'var(--color-text-3)' }}>
                    {t('openclaw.node_missing.hint')}
                  </p>
                </div>
              }
              type="warning"
              showIcon
              closable
              onClose={() => setNodeStatus(null)}
              className="rounded-lg!"
            />
          )}
          {nodeStatus?.status === 'version_low' && (
            <Alert
              message={t('openclaw.node_version_low.title')}
              description={
                <div>
                  <p>{t('openclaw.node_version_low.description', { version: nodeStatus.version })}</p>
                  <Space style={{ marginTop: 8 }}>
                    <Button
                      type="primary"
                      icon={<Download size={16} />}
                      onClick={() => window.open(nodeDownloadUrl, '_blank')}>
                      {t('openclaw.node_missing.download_button')}
                    </Button>
                  </Space>
                  <p className="mt-3 text-xs" style={{ color: 'var(--color-text-3)' }}>
                    {t('openclaw.node_version_low.hint')}
                  </p>
                </div>
              }
              type="warning"
              showIcon
              closable
              onClose={() => setNodeStatus(null)}
              className="rounded-lg!"
            />
          )}
          {gitMissing && (
            <Alert
              message={t('openclaw.git_missing.title')}
              description={
                <div>
                  <p>{t('openclaw.git_missing.description')}</p>
                  <Space style={{ marginTop: 8 }}>
                    <Button
                      type="primary"
                      icon={<Download size={16} />}
                      onClick={() => window.open(gitDownloadUrl, '_blank')}>
                      {t('openclaw.git_missing.download_button')}
                    </Button>
                  </Space>
                  <p className="mt-3 text-xs" style={{ color: 'var(--color-text-3)' }}>
                    {t('openclaw.git_missing.hint')}
                  </p>
                </div>
              }
              type="warning"
              showIcon
              closable
              onClose={() => setGitMissing(false)}
              className="rounded-lg!"
            />
          )}
        </div>
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
      <div className="flex-1" />
    </div>
  )

  const renderInstalledContent = () => (
    <div id="content-container" className="flex flex-1 overflow-y-auto py-5">
      <div className="m-auto min-h-fit w-130">
        <TitleSection title={t('openclaw.title')} description={t('openclaw.description')} clickable docsUrl={docsUrl} />

        {/* Install Path - hide when gateway is running or restarting */}
        {installPath && gatewayStatus !== 'running' && !isRestarting && (
          <div
            className="mb-6 flex items-center justify-between gap-2 rounded-lg px-3 py-2 text-sm"
            style={{ background: 'var(--color-background-soft)', color: 'var(--color-text-3)' }}>
            <div className="min-w-0 shrink overflow-hidden">
              <div className="mb-1">{t('openclaw.installed_at')}</div>
              <div className="flex gap-2">
                <div className="truncate text-xs" title={installPath}>
                  {installPath}
                </div>
                <Button
                  type="link"
                  className="h-auto! w-3! p-0!"
                  aria-label={t('common.copy')}
                  icon={<CopyIcon className="size-3!" />}
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(installPath)
                      window.toast.success(t('common.copied'))
                    } catch (error) {
                      window.toast.error(t('common.copy_failed'))
                      logger.error('Failed to copy install path:', error as Error)
                    }
                  }}
                />
              </div>
            </div>
            <span
              className="cursor-pointer whitespace-nowrap text-xs transition-colors hover:text-(--color-error)!"
              style={{ color: 'var(--color-text-3)' }}
              onClick={handleUninstall}>
              {t('openclaw.quick_actions.uninstall')}
            </span>
          </div>
        )}

        {/* Gateway Status Card - show when running or restarting */}
        {(gatewayStatus === 'running' || isRestarting) && (
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
            <Alert message={error} type="error" closable onClose={() => setError(null)} className="rounded-lg!" />
          </div>
        )}

        {/* Model Selector - only show when not running and not restarting */}
        {gatewayStatus !== 'running' && !isRestarting && (
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

            {/* Tips about OpenClaw */}
            <div
              className="mt-4 rounded-lg p-3 text-xs leading-relaxed"
              style={{ background: 'var(--color-background-mute)', color: 'var(--color-text-3)' }}>
              <div className="mb-1">💡 {t('openclaw.tips.title')}</div>
              <ul className="list-inside list-disc space-y-1">
                <li>{t('openclaw.tips.permissions')}</li>
                <li>{t('openclaw.tips.token_usage')}</li>
              </ul>
            </div>
          </div>
        )}

        {showLogs && installLogs.length > 0 && renderLogContainer()}

        {/* Action Button - hide when restarting */}
        {gatewayStatus !== 'running' && !isRestarting && (
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
        {(gatewayStatus === 'running' || isRestarting) && (
          <Button type="primary" onClick={handleOpenDashboard} size="large" block>
            {t('openclaw.quick_actions.open_dashboard')}
          </Button>
        )}
      </div>
    </div>
  )

  const renderCheckingContent = () => (
    <div id="content-container" className="flex flex-1 flex-col items-center justify-center">
      <Spin size="large" />
      <div className="mt-4" style={{ color: 'var(--color-text-3)' }}>
        {t('openclaw.checking_installation')}
      </div>
    </div>
  )

  // Render uninstalling page - only show logs
  const renderUninstallingContent = () => (
    <div id="content-container" className="flex flex-1 overflow-y-auto py-5">
      <div className="m-auto min-h-fit w-130">
        <TitleSection
          title={t(uninstallSuccess ? 'openclaw.uninstalled.title' : 'openclaw.uninstalling.title')}
          description={t(uninstallSuccess ? 'openclaw.uninstalled.description' : 'openclaw.uninstalling.description')}
        />

        {installError && (
          <div className="mb-6">
            <Alert
              message={installError}
              type="error"
              closable
              onClose={() => setInstallError(null)}
              className="rounded-lg!"
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

  const renderContent = () => {
    switch (pageState) {
      case 'uninstalling':
        return renderUninstallingContent()
      case 'checking':
        return renderCheckingContent()
      case 'installed':
        return renderInstalledContent()
      case 'not_installed':
      case 'installing':
        return renderNotInstalledContent()
    }
  }

  return (
    <div className="flex flex-1 flex-col">
      <Navbar>
        <NavbarCenter style={{ borderRight: 'none' }}>{t('openclaw.title')}</NavbarCenter>
      </Navbar>
      <div className="flex flex-1 flex-col">{renderContent()}</div>
    </div>
  )
}

export default OpenClawPage
