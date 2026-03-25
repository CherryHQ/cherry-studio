import { CheckCircleOutlined, ExclamationCircleOutlined, SyncOutlined } from '@ant-design/icons'
import { loggerService } from '@logger'
import { useProvider } from '@renderer/hooks/useProvider'
import { Alert, Button, Input, Space, Typography } from 'antd'
import type { FC } from 'react'
import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

import { SettingRow, SettingSubtitle } from '..'

const logger = loggerService.withContext('CodexSettings')

interface CodexSettingsProps {
  providerId: string
}

interface CodexAuthStatus {
  isAuthed: boolean
  accountId?: string
  expiresAt?: number
  lastRefreshAt?: number
}

const CodexSettings: FC<CodexSettingsProps> = ({ providerId }) => {
  const { t } = useTranslation()
  const { provider, updateProvider } = useProvider(providerId)
  const [authStatus, setAuthStatus] = useState<CodexAuthStatus>({ isAuthed: false })
  const [loading, setLoading] = useState(false)
  const [syncingModels, setSyncingModels] = useState(false)
  const [accessTokenInput, setAccessTokenInput] = useState('')
  const [accountIdInput, setAccountIdInput] = useState('')

  const handleSyncModels = useCallback(async () => {
    try {
      setSyncingModels(true)
      const models = await window.api.codex.fetchModels(true)

      const normalizedModels = models.map((model) => ({
        id: model.id,
        name: model.name,
        provider: 'codex',
        group: model.group || 'GPT',
        description: model.description,
        max_tokens: model.max_tokens
      }))

      updateProvider({ ...provider, models: normalizedModels })
      window.toast.success(t('settings.provider.codex.models_synced', { count: models.length }))
    } catch (error) {
      logger.error('Failed to sync models:', error as Error)
      window.toast.error(t('settings.provider.codex.models_sync_failed'))
    } finally {
      setSyncingModels(false)
    }
  }, [provider, updateProvider, t])

  useEffect(() => {
    checkAuthStatus()
  }, [])

  useEffect(() => {
    if (authStatus.isAuthed && provider.models.length === 0 && !syncingModels) {
      void handleSyncModels()
    }
  }, [authStatus.isAuthed, handleSyncModels, provider.models.length, syncingModels])

  const checkAuthStatus = async () => {
    try {
      const status = await window.api.codex.getAuthStatus()
      setAuthStatus(status)
      if (status.isAuthed && !provider.isAuthed) {
        updateProvider({ ...provider, isAuthed: true })
      }
    } catch (error) {
      logger.error('Failed to check auth status:', error as Error)
    }
  }

  const handleLogin = useCallback(async () => {
    try {
      setLoading(true)
      const result = await window.api.codex.startLogin()
      logger.info('Codex login initiated', result)
      window.toast.info(t('settings.provider.codex.login_opened'))

      window.modal.info({
        title: t('settings.provider.codex.device_code_title'),
        content: (
          <div>
            <p>{t('settings.provider.codex.device_code_desc')}</p>
            <Typography.Text copyable strong>
              {result.userCode}
            </Typography.Text>
          </div>
        ),
        centered: true
      })

      let retries = 0
      const timer = window.setInterval(async () => {
        retries += 1

        try {
          const status = await window.api.codex.getAuthStatus()
          if (status.isAuthed) {
            window.clearInterval(timer)
            setAuthStatus(status)
            updateProvider({ ...provider, isAuthed: true })
            window.toast.success(t('settings.provider.codex.auth_success'))
            void handleSyncModels()
          } else if (retries >= 24) {
            window.clearInterval(timer)
          }
        } catch (pollError) {
          logger.error('Failed to poll Codex auth status:', pollError as Error)
          window.clearInterval(timer)
        }
      }, 5000)
    } catch (error) {
      logger.error('Failed to start login:', error as Error)
      window.toast.error(t('settings.provider.codex.login_failed'))
    } finally {
      setLoading(false)
    }
  }, [handleSyncModels, provider, t, updateProvider])

  const handleSetAccessToken = useCallback(async () => {
    if (!accessTokenInput.trim()) {
      window.toast.error(t('settings.provider.codex.access_token_required'))
      return
    }

    try {
      setLoading(true)
      await window.api.codex.setAccessToken(accessTokenInput.trim(), accountIdInput.trim() || undefined)
      const status = await window.api.codex.getAuthStatus()
      setAuthStatus(status)
      if (status.isAuthed) {
        updateProvider({ ...provider, isAuthed: true })
        window.toast.success(t('settings.provider.codex.auth_success'))
        setAccessTokenInput('')
        setAccountIdInput('')
        void handleSyncModels()
      }
    } catch (error) {
      logger.error('Failed to set access token:', error as Error)
      window.toast.error(t('settings.provider.codex.auth_failed'))
    } finally {
      setLoading(false)
    }
  }, [accessTokenInput, accountIdInput, handleSyncModels, provider, updateProvider, t])

  const handleLogout = useCallback(async () => {
    try {
      setLoading(true)
      await window.api.codex.logout()
      setAuthStatus({ isAuthed: false })
      updateProvider({ ...provider, isAuthed: false, models: [] })
      window.toast.success(t('settings.provider.codex.logout_success'))
    } catch (error) {
      logger.error('Failed to logout:', error as Error)
      window.toast.error(t('settings.provider.codex.logout_failed'))
    } finally {
      setLoading(false)
    }
  }, [provider, updateProvider, t])

  const handleRefreshToken = useCallback(async () => {
    try {
      setLoading(true)
      const success = await window.api.codex.refreshToken()
      if (success) {
        window.toast.success(t('settings.provider.codex.token_refreshed'))
        await checkAuthStatus()
      } else {
        window.toast.error(t('settings.provider.codex.token_refresh_failed'))
      }
    } catch (error) {
      logger.error('Failed to refresh token:', error as Error)
      window.toast.error(t('settings.provider.codex.token_refresh_failed'))
    } finally {
      setLoading(false)
    }
  }, [t])

  const formatTimestamp = (timestamp?: number) => {
    if (!timestamp) return '-'
    return new Date(timestamp).toLocaleString()
  }

  const renderAuthContent = () => {
    if (authStatus.isAuthed) {
      return (
        <AuthSuccessContainer>
          <Alert
            type="success"
            message={
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%' }}>
                <span>
                  {t('settings.provider.codex.auth_success_title')}
                  {authStatus.accountId && (
                    <Typography.Text type="secondary" style={{ marginLeft: 8, fontSize: '12px' }}>
                      ({authStatus.accountId})
                    </Typography.Text>
                  )}
                </span>
                <Space>
                  <Button size="small" onClick={handleRefreshToken} loading={loading}>
                    {t('settings.provider.codex.refresh_token')}
                  </Button>
                  <Button type="primary" danger size="small" onClick={handleLogout} loading={loading}>
                    {t('settings.provider.codex.logout')}
                  </Button>
                </Space>
              </div>
            }
            icon={<CheckCircleOutlined />}
            showIcon
          />
          <AuthInfoContainer>
            <Typography.Text type="secondary">
              {t('settings.provider.codex.last_refresh')}: {formatTimestamp(authStatus.lastRefreshAt)}
            </Typography.Text>
          </AuthInfoContainer>
          <SettingRow style={{ marginTop: 16 }}>
            <SettingSubtitle style={{ marginTop: 0 }}>{t('settings.provider.codex.models')}</SettingSubtitle>
            <Space>
              <Typography.Text>{provider.models.length} models</Typography.Text>
              <Button type="primary" onClick={handleSyncModels} loading={syncingModels} icon={<SyncOutlined />}>
                {t('settings.provider.codex.sync_models')}
              </Button>
            </Space>
          </SettingRow>
        </AuthSuccessContainer>
      )
    }

    return (
      <AuthFlowContainer>
        <Alert
          type="info"
          message={t('settings.provider.codex.description')}
          description={t('settings.provider.codex.description_detail')}
          showIcon
          icon={<ExclamationCircleOutlined />}
          style={{ marginBottom: 16 }}
        />

        <BrowserLoginCard>
          <SettingSubtitle>{t('settings.provider.codex.browser_login')}</SettingSubtitle>
          <Typography.Text type="secondary" style={{ fontSize: '12px', display: 'block', marginBottom: 12 }}>
            {t('settings.provider.codex.browser_login_desc')}
          </Typography.Text>

          <SettingRow>
            <Button type="primary" onClick={handleLogin} loading={loading}>
              {t('settings.provider.codex.sign_in')}
            </Button>
          </SettingRow>
        </BrowserLoginCard>

        <ManualAuthCard>
          <SettingSubtitle>{t('settings.provider.codex.manual_auth')}</SettingSubtitle>
          <Typography.Text type="secondary" style={{ fontSize: '12px', display: 'block', marginBottom: 12 }}>
            {t('settings.provider.codex.manual_auth_desc')}
          </Typography.Text>

          <SettingRow>
            <Input.Password
              placeholder={t('settings.provider.codex.access_token_placeholder')}
              value={accessTokenInput}
              onChange={(e) => setAccessTokenInput(e.target.value)}
              style={{ flex: 1 }}
            />
          </SettingRow>

          <SettingRow>
            <Input
              placeholder={t('settings.provider.codex.account_id_placeholder')}
              value={accountIdInput}
              onChange={(e) => setAccountIdInput(e.target.value)}
              style={{ flex: 1 }}
            />
          </SettingRow>

          <SettingRow>
            <Button type="primary" onClick={handleSetAccessToken} loading={loading}>
              {t('settings.provider.codex.authenticate')}
            </Button>
          </SettingRow>
        </ManualAuthCard>
      </AuthFlowContainer>
    )
  }

  return <Container>{renderAuthContent()}</Container>
}

const Container = styled.div`
  padding-top: 15px;
`

const AuthSuccessContainer = styled.div`
  margin-bottom: 20px;
`

const AuthInfoContainer = styled.div`
  margin-top: 12px;
  padding: 8px 12px;
  background: var(--color-background-soft);
  border-radius: 6px;
`

const AuthFlowContainer = styled.div`
  margin-bottom: 20px;
`

const BrowserLoginCard = styled.div`
  padding: 16px;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  background: var(--color-background-soft);
  margin-bottom: 16px;
`

const ManualAuthCard = styled.div`
  padding: 16px;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  background: var(--color-background-soft);
`

export default CodexSettings
