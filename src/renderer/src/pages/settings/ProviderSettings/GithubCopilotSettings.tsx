import { CheckCircleOutlined, CopyOutlined, ExclamationCircleOutlined } from '@ant-design/icons'
import { Button, Tooltip } from '@cherrystudio/ui'
import { loggerService } from '@logger'
import { useCopilot } from '@renderer/hooks/useCopilot'
import { useProvider } from '@renderer/hooks/useProvider'
import { cn } from '@renderer/utils/style'
import { Alert, Input, Slider, Steps, Typography } from 'antd'
import type React from 'react'
import type { FC } from 'react'
import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { SettingRow, SettingSubtitle } from '..'

const logger = loggerService.withContext('GithubCopilotSettings')

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
      logger.debug('device_code', device_code)
      logger.debug('user_code', user_code)
      logger.debug('verification_uri', verification_uri)
      setDeviceCode(device_code)
      setUserCode(user_code)
      setVerificationUri(verification_uri)
      setAuthStatus(AuthStatus.CODE_GENERATED)

      // 自动复制授权码到剪贴板
      try {
        await navigator.clipboard.writeText(user_code)
        window.toast.success(t('settings.provider.copilot.code_copied'))
      } catch (error) {
        logger.error('Failed to copy to clipboard:', error as Error)
      }
    } catch (error) {
      logger.error('Failed to get device code:', error as Error)
      window.toast.error(t('settings.provider.copilot.code_failed'))
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
        window.toast.success(t('settings.provider.copilot.auth_success'))
      }
    } catch (error) {
      logger.error('Failed to get token:', error as Error)
      window.toast.error(t('settings.provider.copilot.auth_failed'))
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

      window.toast.success(t('settings.provider.copilot.logout_success'))
    } catch (error) {
      logger.error('Failed to logout:', error as Error)
      window.toast.error(t('settings.provider.copilot.logout_failed'))
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
      window.toast.success(t('common.copied'))
    } catch (error) {
      logger.error('Failed to copy to clipboard:', error as Error)
      window.toast.error(t('common.copy_failed'))
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
                  <Button variant="destructive" size="sm" disabled={loading} onClick={handleLogout}>
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
                    <Button onClick={handleCopyUserCode}>
                      <CopyOutlined />
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
                  <Button onClick={handleOpenVerificationPage} style={{ marginBottom: 8 }}>
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
                    content={!verificationPageOpened ? t('settings.provider.copilot.open_verification_first') : ''}>
                    <Button disabled={!verificationPageOpened || loading} onClick={handleGetToken}>
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
                <Button disabled={loading} onClick={handleGetDeviceCode}>
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

const Container = ({ className, ...props }: React.ComponentPropsWithoutRef<'div'>) => (
  <div className={cn('pt-[15px]', className)} {...props} />
)

const StartContainer = ({ className, ...props }: React.ComponentPropsWithoutRef<'div'>) => (
  <div className={cn('mb-5', className)} {...props} />
)

const AuthSuccessContainer = ({ className, ...props }: React.ComponentPropsWithoutRef<'div'>) => (
  <div className={cn('mb-5', className)} {...props} />
)

const AuthFlowContainer = ({ className, ...props }: React.ComponentPropsWithoutRef<'div'>) => (
  <div className={cn('mb-5 flex gap-6 max-md:flex-col max-md:gap-4', className)} {...props} />
)

const StepsContainer = ({ className, ...props }: React.ComponentPropsWithoutRef<'div'>) => (
  <div
    className={cn(
      'min-w-[200px] flex-1 [&_.ant-steps-item-description]:mt-1 [&_.ant-steps-item-description]:text-foreground-secondary [&_.ant-steps-item-description]:text-xs',
      className
    )}
    {...props}
  />
)

const AuthActionsContainer = ({ className, ...props }: React.ComponentPropsWithoutRef<'div'>) => (
  <div className={cn('flex flex-[2] flex-col gap-4', className)} {...props} />
)

const StepCard = ({ className, ...props }: React.ComponentPropsWithoutRef<'div'>) => (
  <div
    className={cn(
      'rounded-xs border border-border bg-background-subtle p-4 transition-all hover:border-border-subtle',
      className
    )}
    {...props}
  />
)

const StepHeader = ({ className, ...props }: React.ComponentPropsWithoutRef<'div'>) => (
  <div className={cn('mb-3 flex items-start gap-3', className)} {...props} />
)

const StepNumber = ({
  completed,
  className,
  ...props
}: React.ComponentPropsWithoutRef<'div'> & { completed?: boolean }) => (
  <div
    className={cn(
      'flex h-6 w-6 shrink-0 items-center justify-center rounded-full font-bold text-white text-xs transition-all',
      completed ? 'bg-success' : 'bg-primary',
      className
    )}
    {...props}
  />
)

const StepTitle = ({ className, ...props }: React.ComponentPropsWithoutRef<'div'>) => (
  <div className={cn('font-medium text-foreground text-sm', className)} {...props} />
)

const StepDesc = ({ className, ...props }: React.ComponentPropsWithoutRef<'div'>) => (
  <div className={cn('mt-0.5 text-foreground-secondary text-xs', className)} {...props} />
)

export default GithubCopilotSettings
