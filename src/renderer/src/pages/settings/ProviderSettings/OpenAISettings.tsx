import { ExclamationCircleOutlined } from '@ant-design/icons'
import { loggerService } from '@logger'
import { Alert, Button, Input, Modal } from 'antd'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

const logger = loggerService.withContext('OpenAISettings')

enum AuthStatus {
  NOT_STARTED,
  AUTHENTICATING,
  AUTHENTICATED
}

const OpenAISettings = () => {
  const { t } = useTranslation()
  const [authStatus, setAuthStatus] = useState<AuthStatus>(AuthStatus.NOT_STARTED)
  const [loading, setLoading] = useState<boolean>(false)
  const [urlModalVisible, setUrlModalVisible] = useState<boolean>(false)
  const [redirectUrl, setRedirectUrl] = useState<string>('')

  useEffect(() => {
    const check = async () => {
      try {
        const hasCredentials = await window.api.openai_oauth.hasCredentials()
        if (hasCredentials) setAuthStatus(AuthStatus.AUTHENTICATED)
      } catch (e) {
        logger.error('Failed to check OpenAI OAuth state', e as Error)
      }
    }
    check()
  }, [])

  const handleRedirectOAuth = async () => {
    try {
      setLoading(true)
      await window.api.openai_oauth.startOAuthFlow()
      setAuthStatus(AuthStatus.AUTHENTICATING)
      setUrlModalVisible(true)
    } catch (e) {
      logger.error('OpenAI OAuth start failed', e as Error)
      window.toast.error(t('settings.provider.openai.auth_failed'))
    } finally {
      setLoading(false)
    }
  }

  const handleSubmitUrl = async () => {
    logger.info('Submitting OpenAI redirect URL')
    try {
      setLoading(true)
      await window.api.openai_oauth.completeOAuthWithRedirectUrl(redirectUrl)
      setAuthStatus(AuthStatus.AUTHENTICATED)
      setUrlModalVisible(false)
      window.toast.success(t('settings.provider.openai.auth_success'))
    } catch (e) {
      logger.error('OpenAI redirect URL submit failed', e as Error)
      window.toast.error(t('settings.provider.openai.url_error'))
    } finally {
      setLoading(false)
    }
  }

  const handleCancelAuth = () => {
    window.api.openai_oauth.cancelOAuthFlow()
    setAuthStatus(AuthStatus.NOT_STARTED)
    setUrlModalVisible(false)
    setRedirectUrl('')
  }

  const handleLogout = async () => {
    try {
      await window.api.openai_oauth.clearCredentials()
      setAuthStatus(AuthStatus.NOT_STARTED)
      window.toast.success(t('settings.provider.openai.logout_success'))
    } catch (e) {
      logger.error('OpenAI logout failed', e as Error)
      window.toast.error(t('settings.provider.openai.logout_failed'))
    }
  }

  const renderContent = () => {
    switch (authStatus) {
      case AuthStatus.AUTHENTICATED:
        return (
          <StartContainer>
            <Alert
              type="success"
              message={t('settings.provider.openai.authenticated')}
              action={
                <Button type="primary" onClick={handleLogout}>
                  {t('settings.provider.openai.logout')}
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
              message={t('settings.provider.openai.authenticating')}
              showIcon
              icon={<ExclamationCircleOutlined />}
            />
            <Modal
              title={t('settings.provider.openai.enter_redirect_url')}
              open={urlModalVisible}
              onOk={handleSubmitUrl}
              onCancel={handleCancelAuth}
              okButtonProps={{ loading }}
              okText={t('settings.provider.openai.submit_url')}
              cancelText={t('settings.provider.openai.cancel')}
              centered>
              <Input
                value={redirectUrl}
                onChange={(e) => setRedirectUrl(e.target.value)}
                placeholder={t('settings.provider.openai.url_placeholder')}
              />
            </Modal>
          </StartContainer>
        )
      default:
        return (
          <StartContainer>
            <Alert
              type="info"
              message={t('settings.provider.openai.description')}
              description={t('settings.provider.openai.description_detail')}
              action={
                <Button type="primary" loading={loading} onClick={handleRedirectOAuth}>
                  {t('settings.provider.openai.start_auth')}
                </Button>
              }
              showIcon
              icon={<ExclamationCircleOutlined />}
            />
          </StartContainer>
        )
    }
  }

  return <Container>{renderContent()}</Container>
}

const Container = styled.div`
  padding-top: 10px;
`

const StartContainer = styled.div`
  margin-bottom: 10px;
`

export default OpenAISettings
