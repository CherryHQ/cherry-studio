import { loggerService } from '@logger'
import { useProvider } from '@renderer/hooks/useProvider'
import { oauthWithNewApi } from '@renderer/utils/oauth'
import { Button, Divider, Input } from 'antd'
import { isEmpty } from 'lodash'
import { LogIn, LogOut } from 'lucide-react'
import type { FC } from 'react'
import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

const logger = loggerService.withContext('NewApiOAuthSettings')

interface NewApiOAuthSettingsProps {
  providerId: string
}

const NewApiOAuthSettings: FC<NewApiOAuthSettingsProps> = ({ providerId }) => {
  const { updateProvider, provider } = useProvider(providerId)
  const { t } = useTranslation()

  const [isAuthenticating, setIsAuthenticating] = useState(false)
  const [oauthServer, setOauthServer] = useState('')
  const [clientId, setClientId] = useState('')

  const handleOAuthLogin = useCallback(async () => {
    if (!oauthServer || !clientId) {
      window.toast.error('Please enter OAuth Server and Client ID')
      return
    }

    if (!provider.apiHost) {
      window.toast.error('Please set API Host first')
      return
    }

    setIsAuthenticating(true)
    try {
      await oauthWithNewApi(
        (apiKeys) => {
          updateProvider({ apiKey: apiKeys })
          window.toast.success(t('auth.get_key_success'))
        },
        {
          oauthServer,
          clientId,
          apiHost: provider.apiHost
        }
      )
    } catch (error) {
      logger.error('[NewApi OAuth] Error:', error as Error)
      window.toast.error(t('settings.provider.oauth.error'))
    } finally {
      setIsAuthenticating(false)
    }
  }, [updateProvider, t, oauthServer, clientId, provider.apiHost])

  const handleLogout = useCallback(() => {
    updateProvider({ apiKey: '' })
  }, [updateProvider])

  const hasApiKey = !isEmpty(provider.apiKey)

  return (
    <Container>
      <Divider style={{ margin: '12px 0' }} />

      <SectionTitle>New-API OAuth</SectionTitle>
      <SectionDescription>Login with New-API OAuth to get API key automatically</SectionDescription>

      <ConfigRow>
        <ConfigLabel>OAuth Server:</ConfigLabel>
        <Input
          value={oauthServer}
          onChange={(e) => setOauthServer(e.target.value)}
          placeholder="http://localhost:4444"
          spellCheck={false}
          style={{ flex: 1 }}
        />
      </ConfigRow>
      <ConfigRow>
        <ConfigLabel>Client ID:</ConfigLabel>
        <Input
          value={clientId}
          onChange={(e) => setClientId(e.target.value)}
          placeholder="client-id"
          spellCheck={false}
          style={{ flex: 1 }}
        />
      </ConfigRow>
      {!hasApiKey ? (
        <Button
          type="primary"
          icon={<LogIn size={16} />}
          onClick={handleOAuthLogin}
          loading={isAuthenticating}
          disabled={!oauthServer || !clientId || !provider.apiHost}
          style={{ marginTop: 8 }}>
          OAuth Login
        </Button>
      ) : (
        <LoggedInContainer>
          <LoggedInStatus>Logged in</LoggedInStatus>
          <Button icon={<LogOut size={16} />} onClick={handleLogout} danger>
            Logout
          </Button>
        </LoggedInContainer>
      )}
    </Container>
  )
}

const Container = styled.div`
  display: flex;
  flex-direction: column;
  gap: 8px;
`

const SectionTitle = styled.div`
  font-size: 13px;
  font-weight: 500;
  color: var(--color-text-1);
`

const SectionDescription = styled.div`
  font-size: 11px;
  color: var(--color-text-3);
  margin-bottom: 4px;
`

const ConfigRow = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
`

const ConfigLabel = styled.span`
  font-size: 12px;
  color: var(--color-text-2);
  min-width: 90px;
`

const LoggedInContainer = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 12px;
  background-color: var(--color-background-soft);
  border-radius: 6px;
  margin-top: 8px;
`

const LoggedInStatus = styled.span`
  font-size: 12px;
  color: var(--color-success);
`

export default NewApiOAuthSettings
