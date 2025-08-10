import { ExclamationCircleOutlined } from '@ant-design/icons'
import { loggerService } from '@logger'
import { Alert, Button, Input, Modal } from 'antd'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

const logger = loggerService.withContext('AnthropicSettings')

enum AuthStatus {
  NOT_STARTED,
  AUTHENTICATING,
  AUTHENTICATED
}

const AnthropicSettings = () => {
  const { t } = useTranslation()
  const [authStatus, setAuthStatus] = useState<AuthStatus>(AuthStatus.NOT_STARTED)
  const [loading, setLoading] = useState<boolean>(false)
  const [codeModalVisible, setCodeModalVisible] = useState<boolean>(false)
  const [authCode, setAuthCode] = useState<string>('')

  // 初始化检查认证状态
  useEffect(() => {
    const checkAuthStatus = async () => {
      try {
        const hasCredentials = await window.api.anthropic_oauth.hasCredentials()

        if (hasCredentials) {
          setAuthStatus(AuthStatus.AUTHENTICATED)
        }
      } catch (error) {
        logger.error('Failed to check authentication status:', error as Error)
      }
    }

    checkAuthStatus()
  }, [])

  // 处理OAuth重定向
  const handleRedirectOAuth = async () => {
    try {
      setLoading(true)
      await window.api.anthropic_oauth.startOAuthFlow()
      setAuthStatus(AuthStatus.AUTHENTICATING)
      setCodeModalVisible(true)
    } catch (error) {
      logger.error('OAuth redirect failed:', error as Error)
      window.message.error(t('settings.provider.anthropic.auth_failed'))
    } finally {
      setLoading(false)
    }
  }

  // 处理授权码提交
  const handleSubmitCode = async () => {
    logger.info('Submitting auth code')
    try {
      setLoading(true)
      await window.api.anthropic_oauth.completeOAuthWithCode(authCode)
      setAuthStatus(AuthStatus.AUTHENTICATED)
      setCodeModalVisible(false)
      window.message.success(t('settings.provider.anthropic.auth_success'))
    } catch (error) {
      logger.error('Code submission failed:', error as Error)
      window.message.error(t('settings.provider.anthropic.code_error'))
    } finally {
      setLoading(false)
    }
  }

  // 处理取消认证
  const handleCancelAuth = () => {
    window.api.anthropic_oauth.cancelOAuthFlow()
    setAuthStatus(AuthStatus.NOT_STARTED)
    setCodeModalVisible(false)
    setAuthCode('')
  }

  // 处理登出
  const handleLogout = async () => {
    try {
      await window.api.anthropic_oauth.clearCredentials()
      setAuthStatus(AuthStatus.NOT_STARTED)
      window.message.success(t('settings.provider.anthropic.logout_success'))
    } catch (error) {
      logger.error('Logout failed:', error as Error)
      window.message.error(t('settings.provider.anthropic.logout_failed'))
    }
  }

  // 渲染认证内容
  const renderAuthContent = () => {
    switch (authStatus) {
      case AuthStatus.AUTHENTICATED:
        return (
          <StartContainer>
            <Alert
              type="success"
              message={t('settings.provider.anthropic.authenticated')}
              action={
                <Button type="primary" onClick={handleLogout}>
                  {t('settings.provider.anthropic.logout')}
                </Button>
              }
              showIcon
              icon={<ExclamationCircleOutlined />}
            />
          </StartContainer>
        )
      case AuthStatus.AUTHENTICATING:
        return (
          <StartContainer>
            <Alert
              type="info"
              message={t('settings.provider.anthropic.authenticating')}
              showIcon
              icon={<ExclamationCircleOutlined />}
            />
            <Modal
              title={t('settings.provider.anthropic.enter_auth_code')}
              open={codeModalVisible}
              onOk={handleSubmitCode}
              onCancel={handleCancelAuth}
              okButtonProps={{ loading }}
              okText={t('settings.provider.anthropic.submit_code')}
              cancelText={t('settings.provider.anthropic.cancel')}
              centered>
              <Input
                value={authCode}
                onChange={(e) => setAuthCode(e.target.value)}
                placeholder={t('settings.provider.anthropic.code_placeholder')}
              />
            </Modal>
          </StartContainer>
        )
      default:
        return (
          <StartContainer>
            <Alert
              type="info"
              message={t('settings.provider.anthropic.description')}
              description={t('settings.provider.anthropic.description_detail')}
              action={
                <Button type="primary" loading={loading} onClick={handleRedirectOAuth}>
                  {t('settings.provider.anthropic.start_auth')}
                </Button>
              }
              showIcon
              icon={<ExclamationCircleOutlined />}
            />
          </StartContainer>
        )
    }
  }

  return <Container>{renderAuthContent()}</Container>
}

const Container = styled.div`
  padding-top: 15px;
`

const StartContainer = styled.div`
  margin-bottom: 20px;
`

export default AnthropicSettings
