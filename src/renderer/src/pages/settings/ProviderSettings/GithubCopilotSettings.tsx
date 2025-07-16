import { CheckCircleOutlined, CopyOutlined, ExclamationCircleOutlined } from '@ant-design/icons'
import { useCopilot } from '@renderer/hooks/useCopilot'
import { useProvider } from '@renderer/hooks/useProvider'
import { Alert, Button, Input, Slider, Steps, Tooltip, Typography } from 'antd'
import { FC, useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

import { SettingRow, SettingSubtitle } from '..'

interface GithubCopilotSettingsProps {
  providerId: string
}

enum AuthStatus {
  NOT_STARTED,
  CODE_GENERATED,
  AUTHENTICATED
}

const GithubCopilotSettings: FC<GithubCopilotSettingsProps> = ({ providerId }) => {
  const { t } = useTranslation()
  const { provider, updateProvider } = useProvider(providerId)
  const { username, avatar, defaultHeaders, updateState } = useCopilot()
  // 状态管理
  const [authStatus, setAuthStatus] = useState<AuthStatus>(AuthStatus.NOT_STARTED)
  const [deviceCode, setDeviceCode] = useState<string>('')
  const [userCode, setUserCode] = useState<string>('')
  const [verificationUri, setVerificationUri] = useState<string>('')
  const [loading, setLoading] = useState<boolean>(false)
  const [verificationPageOpened, setVerificationPageOpened] = useState<boolean>(false)
  const [currentStep, setCurrentStep] = useState<number>(0)

  // 初始化及同步状态
  useEffect(() => {
    if (provider.isAuthed) {
      setAuthStatus(AuthStatus.AUTHENTICATED)
      setCurrentStep(3)
    } else {
      setAuthStatus(AuthStatus.NOT_STARTED)
      setCurrentStep(0)
      // 重置其他状态
      setDeviceCode('')
      setUserCode('')
      setVerificationUri('')
      setVerificationPageOpened(false)
    }
  }, [provider])

  // 获取设备代码
  const handleGetDeviceCode = useCallback(async () => {
    try {
      setLoading(true)
      setCurrentStep(1)
      const { device_code, user_code, verification_uri } = await window.api.copilot.getAuthMessage(defaultHeaders)
      console.log('device_code', device_code)
      console.log('user_code', user_code)
      console.log('verification_uri', verification_uri)
      setDeviceCode(device_code)
      setUserCode(user_code)
      setVerificationUri(verification_uri)
      setAuthStatus(AuthStatus.CODE_GENERATED)

      // 自动复制授权码到剪贴板
      try {
        await navigator.clipboard.writeText(user_code)
        window.message.success(t('settings.provider.copilot.code_copied'))
      } catch (error) {
        console.error('Failed to copy to clipboard:', error)
      }
    } catch (error) {
      console.error('Failed to get device code:', error)
      window.message.error(t('settings.provider.copilot.code_failed'))
      setCurrentStep(0)
    } finally {
      setLoading(false)
    }
  }, [t, defaultHeaders])

  // 使用设备代码获取访问令牌
  const handleGetToken = useCallback(async () => {
    try {
      setLoading(true)
      setCurrentStep(3)
      const { access_token } = await window.api.copilot.getCopilotToken(deviceCode, defaultHeaders)

      await window.api.copilot.saveCopilotToken(access_token)
      const { token } = await window.api.copilot.getToken(defaultHeaders)

      if (token) {
        const { login, avatar } = await window.api.copilot.getUser(access_token)
        setAuthStatus(AuthStatus.AUTHENTICATED)
        updateState({ username: login, avatar: avatar })
        updateProvider({ ...provider, apiKey: token, isAuthed: true })
        window.message.success(t('settings.provider.copilot.auth_success'))
      }
    } catch (error) {
      console.error('Failed to get token:', error)
      window.message.error(t('settings.provider.copilot.auth_failed'))
      setCurrentStep(2)
    } finally {
      setLoading(false)
    }
  }, [deviceCode, t, updateProvider, provider, updateState, defaultHeaders])

  // 登出
  const handleLogout = useCallback(async () => {
    try {
      setLoading(true)

      // 1. 保存登出状态到本地
      updateProvider({ ...provider, apiKey: '', isAuthed: false })

      // 3. 清除本地存储的token
      await window.api.copilot.logout()

      // 4. 更新UI状态
      setAuthStatus(AuthStatus.NOT_STARTED)
      setDeviceCode('')
      setUserCode('')
      setVerificationUri('')
      setVerificationPageOpened(false)
      setCurrentStep(0)

      window.message.success(t('settings.provider.copilot.logout_success'))
    } catch (error) {
      console.error('Failed to logout:', error)
      window.message.error(t('settings.provider.copilot.logout_failed'))
      // 如果登出失败，重置登出状态
      updateProvider({ ...provider, apiKey: '', isAuthed: false })
    } finally {
      setLoading(false)
    }
  }, [t, updateProvider, provider])

  // 复制用户代码
  const handleCopyUserCode = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(userCode)
      window.message.success(t('common.copied'))
    } catch (error) {
      console.error('Failed to copy to clipboard:', error)
      window.message.error(t('common.copy_failed'))
    }
  }, [userCode, t])

  // 打开验证页面
  const handleOpenVerificationPage = useCallback(() => {
    if (verificationUri) {
      window.open(verificationUri, '_blank')
      setVerificationPageOpened(true)
      setCurrentStep(2)
    }
  }, [verificationUri])

  // 步骤配置
  const getSteps = () => [
    {
      title: t('settings.provider.copilot.step_get_code'),
      description: t('settings.provider.copilot.step_get_code_desc'),
      status: (currentStep > 0 ? 'finish' : currentStep === 0 ? 'process' : 'wait') as
        | 'error'
        | 'finish'
        | 'process'
        | 'wait'
    },
    {
      title: t('settings.provider.copilot.step_copy_code'),
      description: t('settings.provider.copilot.step_copy_code_desc'),
      status: (currentStep > 1 ? 'finish' : currentStep === 1 ? 'process' : 'wait') as
        | 'error'
        | 'finish'
        | 'process'
        | 'wait'
    },
    {
      title: t('settings.provider.copilot.step_authorize'),
      description: t('settings.provider.copilot.step_authorize_desc'),
      status: (currentStep > 2 ? 'finish' : currentStep === 2 ? 'process' : 'wait') as
        | 'error'
        | 'finish'
        | 'process'
        | 'wait'
    },
    {
      title: t('settings.provider.copilot.step_connect'),
      description: t('settings.provider.copilot.step_connect_desc'),
      status: (currentStep >= 3 ? 'finish' : 'wait') as 'error' | 'finish' | 'process' | 'wait'
    }
  ]

  // 根据认证状态渲染不同的UI
  const renderAuthContent = () => {
    switch (authStatus) {
      case AuthStatus.AUTHENTICATED:
        return (
          <AuthSuccessContainer>
            <Alert
              type="success"
              message={
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%' }}>
                  <div style={{ display: 'flex', alignItems: 'center' }}>
                    {avatar && (
                      <img
                        src={avatar}
                        alt="Avatar"
                        style={{ width: 20, height: 20, borderRadius: '50%', marginRight: 8 }}
                        loading="lazy"
                      />
                    )}
                    <span>{username || t('settings.provider.copilot.auth_success_title')}</span>
                  </div>
                  <Button type="primary" danger size="small" loading={loading} onClick={handleLogout}>
                    {t('settings.provider.copilot.logout')}
                  </Button>
                </div>
              }
              icon={<CheckCircleOutlined />}
              showIcon
            />
          </AuthSuccessContainer>
        )

      case AuthStatus.CODE_GENERATED:
        return (
          <AuthFlowContainer>
            <StepsContainer>
              <Steps current={currentStep} size="small" items={getSteps()} direction="vertical" />
            </StepsContainer>

            <AuthActionsContainer>
              {/* 步骤2: 复制授权码 */}
              {currentStep >= 1 && (
                <StepCard>
                  <StepHeader>
                    <StepNumber completed={currentStep > 1}>2</StepNumber>
                    <div>
                      <StepTitle>{t('settings.provider.copilot.step_copy_code')}</StepTitle>
                      <StepDesc>{t('settings.provider.copilot.step_copy_code_detail')}</StepDesc>
                    </div>
                  </StepHeader>
                  <SettingRow>
                    <Input
                      value={userCode}
                      readOnly
                      style={{ fontFamily: 'monospace', fontSize: '14px', fontWeight: 'bold', marginRight: 8 }}
                    />
                    <Button icon={<CopyOutlined />} onClick={handleCopyUserCode}>
                      {t('common.copy')}
                    </Button>
                  </SettingRow>
                </StepCard>
              )}

              {/* 步骤3: 打开授权页面 */}
              {currentStep >= 1 && (
                <StepCard>
                  <StepHeader>
                    <StepNumber completed={currentStep > 2}>3</StepNumber>
                    <div>
                      <StepTitle>{t('settings.provider.copilot.step_authorize')}</StepTitle>
                      <StepDesc>{t('settings.provider.copilot.step_authorize_detail')}</StepDesc>
                    </div>
                  </StepHeader>
                  <Button type="primary" onClick={handleOpenVerificationPage} style={{ marginBottom: 8 }}>
                    {t('settings.provider.copilot.open_verification_page')}
                  </Button>
                  {verificationUri && (
                    <Typography.Text type="secondary" style={{ fontSize: '12px', marginLeft: 8 }}>
                      {verificationUri}
                    </Typography.Text>
                  )}
                </StepCard>
              )}

              {/* 步骤4: 完成连接 */}
              {currentStep >= 2 && (
                <StepCard>
                  <StepHeader>
                    <StepNumber completed={currentStep > 3}>4</StepNumber>
                    <div>
                      <StepTitle>{t('settings.provider.copilot.step_connect')}</StepTitle>
                      <StepDesc>{t('settings.provider.copilot.step_connect_detail')}</StepDesc>
                    </div>
                  </StepHeader>
                  <Tooltip
                    title={!verificationPageOpened ? t('settings.provider.copilot.open_verification_first') : ''}>
                    <Button
                      type="primary"
                      loading={loading}
                      disabled={!verificationPageOpened}
                      onClick={handleGetToken}>
                      {t('settings.provider.copilot.connect')}
                    </Button>
                  </Tooltip>
                </StepCard>
              )}
            </AuthActionsContainer>
          </AuthFlowContainer>
        )

      default: // AuthStatus.NOT_STARTED
        return (
          <StartContainer>
            <Alert
              type="info"
              message={t('settings.provider.copilot.description')}
              description={t('settings.provider.copilot.description_detail')}
              action={
                <Button type="primary" loading={loading} onClick={handleGetDeviceCode}>
                  {t('settings.provider.copilot.start_auth')}
                </Button>
              }
              showIcon
              icon={<ExclamationCircleOutlined />}
            />
          </StartContainer>
        )
    }
  }

  return (
    <Container>
      {renderAuthContent()}
      {authStatus === AuthStatus.AUTHENTICATED && (
        <SettingRow style={{ marginTop: 20 }}>
          <SettingSubtitle style={{ marginTop: 0 }}>{t('settings.provider.copilot.rate_limit')}</SettingSubtitle>
          <Slider
            defaultValue={provider.rateLimit ?? 10}
            style={{ width: 200 }}
            min={1}
            max={60}
            step={1}
            marks={{ 1: '1', 10: t('common.default'), 60: '60' }}
            onChangeComplete={(value) => updateProvider({ ...provider, rateLimit: value })}
          />
        </SettingRow>
      )}
    </Container>
  )
}

const Container = styled.div`
  padding-top: 15px;
`

const StartContainer = styled.div`
  margin-bottom: 20px;
`

const AuthSuccessContainer = styled.div`
  margin-bottom: 20px;
`

const AuthFlowContainer = styled.div`
  display: flex;
  gap: 24px;
  margin-bottom: 20px;

  @media (max-width: 768px) {
    flex-direction: column;
    gap: 16px;
  }
`

const StepsContainer = styled.div`
  flex: 1;
  min-width: 200px;

  .ant-steps-item-description {
    margin-top: 4px;
    font-size: 12px;
    color: var(--color-text-secondary);
  }
`

const AuthActionsContainer = styled.div`
  flex: 2;
  display: flex;
  flex-direction: column;
  gap: 16px;
`

const StepCard = styled.div`
  padding: 16px;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  background: var(--color-background-soft);
  transition: all 0.2s ease;

  &:hover {
    border-color: var(--color-border-soft);
  }
`

const StepHeader = styled.div`
  display: flex;
  align-items: flex-start;
  gap: 12px;
  margin-bottom: 12px;
`

const StepNumber = styled.div<{ completed?: boolean }>`
  width: 24px;
  height: 24px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  font-weight: bold;
  background: ${(props) => (props.completed ? 'var(--color-status-success)' : 'var(--color-primary)')};
  color: white;
  flex-shrink: 0;
  transition: all 0.2s ease;
`

const StepTitle = styled.div`
  font-weight: 500;
  font-size: 14px;
  color: var(--color-text);
`

const StepDesc = styled.div`
  font-size: 12px;
  color: var(--color-text-secondary);
  margin-top: 2px;
`

export default GithubCopilotSettings
