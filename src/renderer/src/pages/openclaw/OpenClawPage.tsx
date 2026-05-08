import { Alert, Button } from '@cherrystudio/ui'
import { Openclaw } from '@cherrystudio/ui/icons'
import { Navbar, NavbarCenter } from '@renderer/components/app/Navbar'
import { CopyIcon } from '@renderer/components/Icons'
import ModelSelector from '@renderer/components/ModelSelectorLegacy'
import { useSharedCache } from '@renderer/data/hooks/useCache'
import { usePreference } from '@renderer/data/hooks/usePreference'
import { useMiniAppPopup } from '@renderer/hooks/useMiniAppPopup'
import { useProviders } from '@renderer/hooks/useProvider'
import { loggerService } from '@renderer/services/LoggerService'
import { createUniqueModelId, isUniqueModelId, parseUniqueModelId, type UniqueModelId } from '@shared/data/types/model'
import { IpcChannel } from '@shared/IpcChannel'
import { Download, ExternalLink, Loader2, Play, Square, X } from 'lucide-react'
import type { FC } from 'react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import useSWR from 'swr'

import UpdateButton from './components/UpdateButton'

const logger = loggerService.withContext('OpenClawPage')

const DEFAULT_DOCS_URL = 'https://docs.openclaw.ai/'

function toLegacyModelSelectorValue(modelId: UniqueModelId | null): string | null {
  if (!modelId) return null

  const parsed = parseUniqueModelId(modelId)
  return JSON.stringify({ id: parsed.modelId, provider: parsed.providerId })
}

function fromLegacyModelSelectorValue(modelUniqId: string): UniqueModelId | null {
  try {
    const parsed = JSON.parse(modelUniqId) as { id?: unknown; provider?: unknown }
    if (typeof parsed.id !== 'string' || typeof parsed.provider !== 'string') {
      return null
    }
    return createUniqueModelId(parsed.provider, parsed.id)
  } catch {
    return null
  }
}

interface TitleSectionProps {
  title: string
  description: string
  clickable?: boolean
  docsUrl?: string
}

const TitleSection: FC<TitleSectionProps> = ({ title, description, clickable = false, docsUrl }) => (
  <div className="-mt-20 mb-8 flex flex-col items-center text-center">
    <div
      className={clickable ? 'cursor-pointer' : undefined}
      onClick={clickable ? () => window.open(docsUrl ?? DEFAULT_DOCS_URL, '_blank') : undefined}>
      <Openclaw.Avatar size={64} shape="rounded" />
    </div>
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
  const { providers } = useProviders()
  const { openSmartMiniApp } = useMiniAppPopup()

  const docsUrl = useMemo(() => {
    const lang = i18n.language?.toLowerCase() ?? ''
    if (lang.startsWith('zh-cn')) {
      return 'https://docs.openclaw.ai/zh-CN'
    }
    return DEFAULT_DOCS_URL
  }, [i18n.language])

  const [gatewayPort] = usePreference('feature.openclaw.gateway_port')
  const [selectedModelId, setSelectedModelId] = usePreference('feature.openclaw.selected_model_id')
  const [gatewayStatus, setGatewayStatus] = useSharedCache('feature.openclaw.gateway_status')
  const [, setLastHealthCheck] = useSharedCache('feature.openclaw.last_health_check')
  const [, setChannels] = useSharedCache('feature.openclaw.channels')

  const [error, setError] = useState<string | null>(null)
  const [isInstalled, setIsInstalled] = useState<boolean | null>(null) // null = unknown, checking in background
  const [needsMigration, setNeedsMigration] = useState(false)
  const [installPath, setInstallPath] = useState<string | null>(null)
  const [installError, setInstallError] = useState<string | null>(null)

  // Separate loading states for each action
  const [isInstalling, setIsInstalling] = useState(false)
  const [isUninstalling, setIsUninstalling] = useState(false)
  const [isStarting, setIsStarting] = useState(false)
  const [isStopping, setIsStopping] = useState(false)
  // Install progress logs
  const [installLogs, setInstallLogs] = useState<Array<{ message: string; type: 'info' | 'warn' | 'error' }>>([])
  const [showLogs, setShowLogs] = useState(false)
  const [uninstallSuccess, setUninstallSuccess] = useState(false)
  const [isOpenClawUpdating, setIsOpenClawUpdating] = useState(false)

  const noApiKeyProviders = ['ollama', 'lmstudio', 'gpustack']
  const availableProviders = providers.filter((p) => p.enabled && (p.apiKey || noApiKeyProviders.includes(p.type)))

  const selectedModelInfo = useMemo(() => {
    if (!selectedModelId || !isUniqueModelId(selectedModelId)) return null
    const { providerId, modelId } = parseUniqueModelId(selectedModelId)

    for (const p of availableProviders) {
      const model = p.models.find((m) => m.id === modelId && m.provider === providerId)
      if (model) {
        return { provider: p, model }
      }
    }

    return null
  }, [selectedModelId, availableProviders])

  const selectedModelUniqId = useMemo(() => {
    if (!selectedModelId || !isUniqueModelId(selectedModelId)) return null
    try {
      return toLegacyModelSelectorValue(selectedModelId)
    } catch {
      return null
    }
  }, [selectedModelId])

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
      setNeedsMigration(result.needsMigration)
      setShowLogs(false)
      setInstallPath(result.path)
    } catch (err) {
      logger.debug('Failed to check installation', err as Error)
      setIsInstalled(false)
    }
  }, [])

  const handleInstall = useCallback(async () => {
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

  // Poll gateway status every 5s (only when installed).
  // useSWR handles deduplication and stable polling without the infinite-loop
  // pitfall of setInterval + dispatch in useEffect deps.
  const isInstallPage = pageState === 'installed'

  useSWR(
    isInstallPage ? 'openclaw/status' : null,
    async () => {
      const [status] = await Promise.all([window.api.openclaw.getStatus(), checkInstallation()])
      setGatewayStatus(status.status)
      return status
    },
    { refreshInterval: 5000, revalidateOnFocus: false }
  )

  useSWR(
    isInstallPage && gatewayStatus === 'running' ? 'openclaw/health' : null,
    async () => {
      const health = await window.api.openclaw.checkHealth()
      setLastHealthCheck(health)
      return health
    },
    { refreshInterval: 5000, revalidateOnFocus: false }
  )

  useSWR(
    isInstallPage ? 'openclaw/channels' : null,
    async () => {
      const channels = await window.api.openclaw.getChannels()
      setChannels(channels)
      return channels
    },
    { refreshInterval: 5000, revalidateOnFocus: false }
  )

  useEffect(() => {
    void checkInstallation()
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

  const handleModelSelect = (modelUniqId: string) => {
    void setSelectedModelId(fromLegacyModelSelectorValue(modelUniqId))
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
        setIsStarting(false)
        return
      }

      // Then start the gateway
      const startResult = await window.api.openclaw.startGateway(gatewayPort)
      if (!startResult.success) {
        setError(startResult.message)
        setIsStarting(false)
        return
      }

      // Auto open dashboard first
      const dashboardUrl = await window.api.openclaw.getDashboardUrl()

      openSmartMiniApp({
        appId: 'openclaw-dashboard',
        name: 'OpenClaw',
        url: dashboardUrl,
        logo: 'openclaw'
      })

      // Delay 500ms before updating UI state (wait for miniapp animation)
      setTimeout(() => {
        setGatewayStatus('running')
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
        setGatewayStatus('stopped')
      } else {
        setError(result.message)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setIsStopping(false)
    }
  }

  const handleOpenDashboard = async () => {
    const dashboardUrl = await window.api.openclaw.getDashboardUrl()
    openSmartMiniApp({
      appId: 'openclaw-dashboard',
      name: 'OpenClaw',
      url: dashboardUrl,
      logo: 'openclaw'
    })
  }

  const renderLogContainer = (expanded = false) => (
    <div className="mb-6 overflow-hidden rounded-lg" style={{ background: 'var(--color-background-soft)' }}>
      <div
        className="flex items-center justify-between px-3 py-2 font-medium text-[13px]"
        style={{ background: 'var(--color-background-mute)' }}>
        <span>{t(expanded ? 'openclaw.uninstall_progress' : 'openclaw.install_progress')}</span>
        {!expanded && (
          <Button size="sm" variant="ghost" onClick={() => setShowLogs(false)}>
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
        <div className="mb-6 flex flex-col items-center text-center">
          <Openclaw.Avatar size={64} shape="rounded" />
          <h2 className="mt-5 font-semibold text-foreground text-lg">
            {t(needsMigration ? 'openclaw.migration.title' : 'openclaw.not_installed.title')}
          </h2>
          <p className="mt-2 text-muted-foreground text-sm leading-relaxed">
            {t(needsMigration ? 'openclaw.migration.description' : 'openclaw.not_installed.description')}
          </p>
          <div className="mt-6 flex items-center justify-center gap-2">
            <Button disabled={isInstalling} onClick={handleInstall} loading={isInstalling}>
              {!isInstalling && <Download size={16} />}
              {t(needsMigration ? 'openclaw.migration.install_button' : 'openclaw.not_installed.install_button')}
            </Button>
            <Button variant="outline" disabled={isInstalling} onClick={() => window.open(docsUrl, '_blank')}>
              <ExternalLink size={16} />
              {t('openclaw.quick_actions.view_docs')}
            </Button>
          </div>
        </div>
        {installError && (
          <Alert
            message={installError}
            type="error"
            className="mb-4"
            action={
              <Button
                size="icon-sm"
                variant="ghost"
                aria-label={t('common.close')}
                onClick={() => setInstallError(null)}>
                <X size={14} />
              </Button>
            }
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

        {/* Install Path - hide when gateway is running */}
        {installPath && gatewayStatus !== 'running' && (
          <div
            className="mb-6 flex items-center justify-between gap-2 rounded-lg px-3 py-2 text-sm"
            style={{ background: 'var(--color-background-soft)', color: 'var(--color-text-3)' }}>
            <div className="min-w-0 shrink overflow-hidden">
              <div className="mb-1">{t('openclaw.installed_at')}</div>
              <div className="flex items-center gap-2">
                <div className="truncate text-xs" title={installPath}>
                  {installPath}
                </div>
                <Button
                  size="icon-sm"
                  variant="ghost"
                  className="size-4! p-0! shadow-none"
                  aria-label={t('common.copy')}
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(installPath)
                      window.toast.success(t('common.copied'))
                    } catch (error) {
                      window.toast.error(t('common.copy_failed'))
                      logger.error('Failed to copy install path:', error as Error)
                    }
                  }}>
                  <CopyIcon className="size-3!" />
                </Button>
                <UpdateButton onUpdateComplete={checkInstallation} onUpdatingChange={setIsOpenClawUpdating} />
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

        {/* Gateway Status Card - show when running */}
        {gatewayStatus === 'running' && (
          <div
            className="mb-6 flex items-center justify-between rounded-lg p-3"
            style={{ background: 'var(--color-background-soft)' }}>
            <div className="flex items-center gap-2">
              <div className="h-2 w-2 rounded-full bg-green-500" />
              <span className="font-medium text-sm" style={{ color: 'var(--color-text-1)' }}>
                {t('openclaw.status.running')}
              </span>
              <span className="font-mono text-[13px]" style={{ color: 'var(--color-text-3)' }}>
                :{gatewayPort}
              </span>
            </div>
            <Button
              size="sm"
              variant="ghost"
              onClick={handleStopGateway}
              loading={isStopping}
              disabled={isStopping}
              className="text-destructive hover:text-destructive">
              {!isStopping && <Square size={14} />}
              {t('openclaw.gateway.stop')}
            </Button>
          </div>
        )}

        {/* Error Alert */}
        {error && (
          <div className="mb-6">
            <Alert
              message={
                <div className="flex items-start justify-between gap-2">
                  <span className="max-h-25 flex-1 overflow-y-auto whitespace-pre-wrap break-all">{error}</span>
                </div>
              }
              type="error"
              action={
                <div className="flex items-center gap-1">
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    className="shadow-none"
                    aria-label={t('common.copy')}
                    onClick={async () => {
                      try {
                        await navigator.clipboard.writeText(error)
                        window.toast.success(t('common.copied'))
                      } catch (err) {
                        window.toast.error(t('common.copy_failed'))
                      }
                    }}>
                    <CopyIcon className="size-3!" />
                  </Button>
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    className="shadow-none"
                    aria-label={t('common.close')}
                    onClick={() => setError(null)}>
                    <X size={14} />
                  </Button>
                </div>
              }
              className="rounded-lg"
            />
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

        {gatewayStatus !== 'running' && (
          <Button
            onClick={handleStartGateway}
            loading={isStarting || gatewayStatus === 'starting'}
            disabled={
              !selectedProvider || !selectedModel || isStarting || gatewayStatus === 'starting' || isOpenClawUpdating
            }
            size="lg"
            className="w-full">
            {!isStarting && gatewayStatus !== 'starting' && <Play size={16} />}
            {t('openclaw.gateway.start')}
          </Button>
        )}
        {gatewayStatus === 'running' && (
          <Button onClick={handleOpenDashboard} size="lg" className="w-full">
            {t('openclaw.quick_actions.open_dashboard')}
          </Button>
        )}
      </div>
    </div>
  )

  const renderCheckingContent = () => (
    <div id="content-container" className="flex flex-1 flex-col items-center justify-center">
      <Loader2 className="size-7 animate-spin" style={{ color: 'var(--color-primary)' }} />
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
              action={
                <Button
                  size="icon-sm"
                  variant="ghost"
                  aria-label={t('common.close')}
                  onClick={() => setInstallError(null)}>
                  <X size={14} />
                </Button>
              }
              className="rounded-lg"
            />
          </div>
        )}

        {renderLogContainer(true)}

        <Button disabled={!uninstallSuccess} onClick={handleUninstallComplete} className="w-full" size="lg">
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
