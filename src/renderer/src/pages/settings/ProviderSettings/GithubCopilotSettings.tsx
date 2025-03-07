import { CheckCircleOutlined, CopyOutlined } from '@ant-design/icons'
import { useProvider } from '@renderer/hooks/useProvider'
import { Provider } from '@renderer/types'
import { Alert, Button, Input, message, Space, Typography } from 'antd'
import { FC, useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

import { SettingRow } from '..'

interface GithubCopilotSettingsProps {
  provider: Provider
  setApiKey: (apiKey: string) => void
}

enum AuthStatus {
  NOT_STARTED,
  CODE_GENERATED,
  AUTHENTICATED
}

const GithubCopilotSettings: FC<GithubCopilotSettingsProps> = ({ provider: initialProvider, setApiKey }) => {
  const { t } = useTranslation()
  const { provider, updateProvider } = useProvider(initialProvider.id)

  // 状态管理
  const [authStatus, setAuthStatus] = useState<AuthStatus>(AuthStatus.NOT_STARTED)
  const [deviceCode, setDeviceCode] = useState<string>('')
  const [userCode, setUserCode] = useState<string>('')
  const [verificationUri, setVerificationUri] = useState<string>('')
  const [loading, setLoading] = useState<boolean>(false)

  // 初始化及同步状态
  useEffect(() => {
    if (provider.isAuthed) {
      setAuthStatus(AuthStatus.AUTHENTICATED)
    } else {
      setAuthStatus(AuthStatus.NOT_STARTED)
      // 重置其他状态
      setDeviceCode('')
      setUserCode('')
      setVerificationUri('')
    }
  }, [provider])

  // 获取设备代码
  const handleGetDeviceCode = useCallback(async () => {
    try {
      setLoading(true)
      const { device_code, user_code, verification_uri } = await window.api.copilot.getAuthMessage()

      setDeviceCode(device_code)
      setUserCode(user_code)
      setVerificationUri(verification_uri)
      setAuthStatus(AuthStatus.CODE_GENERATED)
    } catch (error) {
      console.error('Failed to get device code:', error)
      message.error(t('settings.provider.copilot.code_failed'))
    } finally {
      setLoading(false)
    }
  }, [t])

  // 使用设备代码获取访问令牌
  const handleGetToken = useCallback(async () => {
    try {
      setLoading(true)
      const { access_token } = await window.api.copilot.getCopilotToken(deviceCode)
      await window.api.copilot.saveCopilotToken(access_token)
      const { token } = await window.api.copilot.getToken()

      if (token) {
        setAuthStatus(AuthStatus.AUTHENTICATED)
        updateProvider({ ...provider, apiKey: token, isAuthed: true })
        setApiKey(token)
        console.log('Copilot token:', token)
        message.success(t('settings.provider.copilot.auth_success'))
      }
    } catch (error) {
      console.error('Failed to get token:', error)
      message.error(t('settings.provider.copilot.auth_failed'))
    } finally {
      setLoading(false)
    }
  }, [deviceCode, t, updateProvider, provider, setApiKey])

  // 登出
  const handleLogout = useCallback(async () => {
    try {
      setLoading(true)

      // 1. 保存登出状态到本地
      updateProvider({ ...provider, apiKey: '', isAuthed: false })
      setApiKey('')

      // 3. 清除本地存储的token
      await window.api.copilot.saveCopilotToken('')

      // 4. 更新UI状态
      setAuthStatus(AuthStatus.NOT_STARTED)
      setDeviceCode('')
      setUserCode('')
      setVerificationUri('')

      message.success(t('settings.provider.copilot.logout_success'))
    } catch (error) {
      console.error('Failed to logout:', error)
      message.error(t('settings.provider.copilot.logout_failed'))
      // 如果登出失败，重置登出状态
      updateProvider({ ...provider, apiKey: '', isAuthed: false })
      setApiKey('')
    } finally {
      setLoading(false)
    }
  }, [t, updateProvider, provider, setApiKey])

  // 复制用户代码
  const handleCopyUserCode = useCallback(() => {
    navigator.clipboard.writeText(userCode)
    message.success(t('common.copied'))
  }, [userCode, t])

  // 打开验证页面
  const handleOpenVerificationPage = useCallback(() => {
    if (verificationUri) {
      window.open(verificationUri, '_blank')
    }
  }, [verificationUri])

  // 根据认证状态渲染不同的UI
  const renderAuthContent = () => {
    switch (authStatus) {
      case AuthStatus.AUTHENTICATED:
        return (
          <>
            <Alert
              type="success"
              message={t('settings.provider.copilot.auth_success_title')}
              icon={<CheckCircleOutlined />}
              showIcon
            />
            <Button type="primary" danger loading={loading} onClick={handleLogout}>
              {t('settings.provider.copilot.logout')}
            </Button>
          </>
        )

      case AuthStatus.CODE_GENERATED:
        return (
          <>
            <Alert
              type="info"
              message={t('settings.provider.copilot.code_generated_title')}
              description={
                <>
                  <p>{t('settings.provider.copilot.code_generated_desc')}</p>
                  <Typography.Link onClick={handleOpenVerificationPage}>{verificationUri}</Typography.Link>
                </>
              }
              showIcon
            />
            <SettingRow>
              <Input value={userCode} readOnly />
              <Button icon={<CopyOutlined />} onClick={handleCopyUserCode}>
                {t('common.copy')}
              </Button>
            </SettingRow>
            <SettingRow>
              <Button type="primary" loading={loading} onClick={handleGetToken}>
                {t('settings.provider.copilot.connect')}
              </Button>
            </SettingRow>
          </>
        )

      default: // AuthStatus.NOT_STARTED
        return (
          <>
            <Alert
              type="warning"
              message={t('settings.provider.copilot.tooltip')}
              description={t('settings.provider.copilot.description')}
              showIcon
            />

            <SettingRow>
              <Button type="primary" loading={loading} onClick={handleGetDeviceCode}>
                {t('settings.provider.copilot.login')}
              </Button>
            </SettingRow>
          </>
        )
    }
  }

  return (
    <Container>
      <Space direction="vertical" style={{ width: '100%' }}>
        {renderAuthContent()}
      </Space>
    </Container>
  )
}

const Container = styled.div``

export default GithubCopilotSettings
