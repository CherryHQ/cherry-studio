import OpenClawLogo from '@renderer/assets/images/providers/openclaw.svg'
import { Navbar, NavbarCenter } from '@renderer/components/app/Navbar'
import ModelSelector from '@renderer/components/ModelSelector'
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
import { Alert, Avatar, Button, Result, Space, Spin, Tag } from 'antd'
import { Download, ExternalLink, Play, RefreshCw, Square } from 'lucide-react'
import type { FC } from 'react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

const logger = loggerService.withContext('OpenClawPage')

const OpenClawPage: FC = () => {
  const { t } = useTranslation()
  const dispatch = useAppDispatch()
  const { providers } = useProviders()

  const { gatewayStatus, gatewayPort, selectedModelUniqId, lastHealthCheck } = useAppSelector((state) => state.openclaw)

  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [isCheckingInstall, setIsCheckingInstall] = useState(true)
  const [isInstalled, setIsInstalled] = useState(false)
  const [installPath, setInstallPath] = useState<string | null>(null)
  const [isInstalling, setIsInstalling] = useState(false)
  const [installError, setInstallError] = useState<string | null>(null)

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
    setIsCheckingInstall(true)
    try {
      const result = await window.api.openclaw.checkInstalled()
      setIsInstalled(result.installed)
      setInstallPath(result.path)
    } catch (err) {
      logger.debug('Failed to check installation', err as Error)
      setIsInstalled(false)
    } finally {
      setIsCheckingInstall(false)
    }
  }, [])

  const handleInstall = useCallback(async () => {
    setIsInstalling(true)
    setInstallError(null)
    try {
      const result = await window.api.openclaw.install()
      if (result.success) {
        // Re-check installation after successful install
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

  useEffect(() => {
    if (!isInstalled) return

    fetchStatus()
    if (gatewayStatus === 'running') {
      fetchHealth()
    }
    const interval = setInterval(() => {
      fetchStatus()
      if (gatewayStatus === 'running') {
        fetchHealth()
      }
    }, 5000)
    return () => clearInterval(interval)
  }, [fetchStatus, fetchHealth, gatewayStatus, isInstalled])

  const handleModelSelect = (modelUniqId: string) => {
    dispatch(setSelectedModelUniqId(modelUniqId))
  }

  const handleStartGateway = async () => {
    if (!selectedProvider || !selectedModel) {
      setError(t('openclaw.error.select_provider_model'))
      return
    }

    setIsLoading(true)
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

      dispatch(setGatewayStatus('running'))
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setIsLoading(false)
    }
  }

  const handleStopGateway = async () => {
    setIsLoading(true)
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
      setIsLoading(false)
    }
  }

  const handleRestartGateway = async () => {
    setIsLoading(true)
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
      setIsLoading(false)
    }
  }

  const handleOpenDashboard = async () => {
    await window.api.openclaw.openDashboard()
  }

  const getStatusTag = () => {
    switch (gatewayStatus) {
      case 'running':
        return <Tag color="success">{t('openclaw.status.running')}</Tag>
      case 'starting':
        return <Tag color="processing">{t('openclaw.status.starting')}</Tag>
      case 'error':
        return <Tag color="error">{t('openclaw.status.error')}</Tag>
      default:
        return <Tag color="default">{t('openclaw.status.stopped')}</Tag>
    }
  }

  const renderNotInstalledContent = () => (
    <ContentContainer id="content-container">
      <MainContent>
        <Result
          icon={<Avatar src={OpenClawLogo} size={64} shape="square" style={{ borderRadius: 12 }} />}
          title={t('openclaw.not_installed.title')}
          subTitle={t('openclaw.not_installed.description')}
          extra={[
            <Button
              key="install"
              type="primary"
              icon={<Download size={16} />}
              onClick={handleInstall}
              loading={isInstalling}>
              {t('openclaw.not_installed.install_button')}
            </Button>,
            <Button
              key="docs"
              icon={<ExternalLink size={16} />}
              onClick={() => window.open('https://docs.openclaw.ai/', '_blank')}>
              {t('openclaw.quick_actions.view_docs')}
            </Button>,
            <Button key="refresh" onClick={checkInstallation} disabled={isInstalling}>
              {t('openclaw.not_installed.refresh')}
            </Button>
          ]}
        />
        {installError && (
          <Alert
            message={installError}
            type="error"
            closable
            onClose={() => setInstallError(null)}
            style={{ marginBottom: 16 }}
          />
        )}
        <SettingsPanel>
          <SettingsItem>
            <div className="settings-label">{t('openclaw.not_installed.install_guide_title')}</div>
          </SettingsItem>
          <SettingsItem>
            <div className="settings-label">{t('openclaw.not_installed.macos_linux_title')}</div>
            <CodeBlock>curl -fsSL https://openclaw.ai/install.sh | bash -s -- --no-onboard</CodeBlock>
          </SettingsItem>
          <SettingsItem>
            <div className="settings-label">{t('openclaw.not_installed.windows_title')}</div>
            <CodeBlock>iwr -useb https://openclaw.ai/install.ps1 | iex; openclaw --no-onboard</CodeBlock>
          </SettingsItem>
          <SettingsItem>
            <div className="settings-label">{t('openclaw.not_installed.step2_title')}</div>
            <div style={{ fontSize: 12, color: 'var(--color-text-3)' }}>{t('openclaw.not_installed.step2_hint')}</div>
          </SettingsItem>
        </SettingsPanel>
      </MainContent>
    </ContentContainer>
  )

  const renderInstalledContent = () => (
    <ContentContainer id="content-container">
      <MainContent>
        <TitleWrapper>
          <Avatar src={OpenClawLogo} size={48} shape="square" style={{ borderRadius: 10 }} />
          <TitleContent>
            <Title>{t('openclaw.title')}</Title>
            <Description>{t('openclaw.description')}</Description>
          </TitleContent>
        </TitleWrapper>

        {installPath && (
          <InstallAlert>
            <Alert
              message={t('openclaw.installed_at', { path: installPath })}
              type="success"
              showIcon
              style={{ borderRadius: 'var(--list-item-border-radius)' }}
            />
          </InstallAlert>
        )}

        {error && (
          <InstallAlert>
            <Alert
              message={error}
              type="error"
              closable
              onClose={() => setError(null)}
              style={{ borderRadius: 'var(--list-item-border-radius)' }}
            />
          </InstallAlert>
        )}

        <SettingsPanel>
          <SettingsItem>
            <div className="settings-label">{t('openclaw.model_config.model')}</div>
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
            <div style={{ fontSize: 12, color: 'var(--color-text-3)', marginTop: 4 }}>
              {t('openclaw.model_config.sync_hint')}
            </div>
          </SettingsItem>

          <SettingsItem>
            <div className="settings-label">{t('openclaw.gateway.title')}</div>
            <Space>
              <span style={{ fontWeight: 500 }}>{t('openclaw.gateway.status')}:</span>
              {getStatusTag()}
              <span style={{ color: 'var(--color-text-3)' }}>
                ({t('openclaw.gateway.port')}: {gatewayPort})
              </span>
            </Space>
            {lastHealthCheck && gatewayStatus === 'running' && (
              <div style={{ marginTop: 8, color: 'var(--color-text-3)', fontSize: 12 }}>
                {t('openclaw.gateway.health')}: {lastHealthCheck.status}
                {lastHealthCheck.version && ` | ${t('openclaw.gateway.version')}: ${lastHealthCheck.version}`}
              </div>
            )}
          </SettingsItem>

          <SettingsItem>
            <div className="settings-label">{t('openclaw.quick_actions.title')}</div>
            <Space>
              <Button
                icon={<ExternalLink size={16} />}
                onClick={handleOpenDashboard}
                disabled={gatewayStatus !== 'running'}>
                {t('openclaw.quick_actions.open_dashboard')}
              </Button>
              <Button
                icon={<ExternalLink size={16} />}
                onClick={() => window.open('https://docs.openclaw.ai/', '_blank')}>
                {t('openclaw.quick_actions.view_docs')}
              </Button>
            </Space>
          </SettingsItem>
        </SettingsPanel>

        {gatewayStatus === 'stopped' ? (
          <Button
            type="primary"
            icon={<Play size={16} />}
            onClick={handleStartGateway}
            loading={isLoading}
            disabled={!selectedProvider || !selectedModel}
            size="large"
            block>
            {t('openclaw.gateway.start')}
          </Button>
        ) : (
          <Space style={{ width: '100%' }}>
            <Button
              icon={<Square size={16} />}
              onClick={handleStopGateway}
              loading={isLoading}
              danger
              size="large"
              style={{ flex: 1 }}>
              {t('openclaw.gateway.stop')}
            </Button>
            <Button
              icon={<RefreshCw size={16} />}
              onClick={handleRestartGateway}
              loading={isLoading}
              size="large"
              style={{ flex: 1 }}>
              {t('openclaw.gateway.restart')}
            </Button>
          </Space>
        )}
      </MainContent>
    </ContentContainer>
  )

  return (
    <Container>
      <Navbar>
        <NavbarCenter style={{ borderRight: 'none' }}>{t('openclaw.title')}</NavbarCenter>
      </Navbar>

      {isCheckingInstall ? (
        <LoadingContainer id="content-container">
          <Spin size="large" />
          <div style={{ marginTop: 16, color: 'var(--color-text-3)' }}>{t('openclaw.checking_installation')}</div>
        </LoadingContainer>
      ) : isInstalled ? (
        renderInstalledContent()
      ) : (
        renderNotInstalledContent()
      )}
    </Container>
  )
}

const Container = styled.div`
  display: flex;
  flex: 1;
  flex-direction: column;
`

const ContentContainer = styled.div`
  display: flex;
  flex: 1;
  overflow-y: auto;
  padding: 20px 0;
`

const MainContent = styled.div`
  width: 600px;
  margin: auto;
  min-height: fit-content;
`

const TitleWrapper = styled.div`
  display: flex;
  align-items: flex-start;
  gap: 16px;
  margin-bottom: 32px;
`

const TitleContent = styled.div`
  flex: 1;
`

const Title = styled.h1`
  font-size: 24px;
  font-weight: 600;
  margin-bottom: 4px;
  color: var(--color-text-1);
`

const Description = styled.p`
  font-size: 14px;
  color: var(--color-text-2);
  margin-bottom: 0;
  line-height: 1.5;
`

const SettingsPanel = styled.div`
  margin-bottom: 32px;
`

const SettingsItem = styled.div`
  margin-bottom: 24px;

  .settings-label {
    font-size: 14px;
    margin-bottom: 8px;
    display: flex;
    align-items: center;
    gap: 8px;
    color: var(--color-text-1);
    font-weight: 500;
  }
`

const InstallAlert = styled.div`
  margin-bottom: 24px;
`

const LoadingContainer = styled.div`
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
`

const CodeBlock = styled.pre`
  background: var(--color-background-soft);
  padding: 12px;
  border-radius: 6px;
  overflow-x: auto;
  font-family: monospace;
  font-size: 13px;
`

export default OpenClawPage
