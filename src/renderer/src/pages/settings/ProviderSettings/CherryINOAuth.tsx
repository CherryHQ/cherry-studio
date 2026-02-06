import { loggerService } from '@logger'
import CherryINProviderLogo from '@renderer/assets/images/providers/cherryin.png'
import { useProvider } from '@renderer/hooks/useProvider'
import { oauthWithCherryIn } from '@renderer/utils/oauth'
import { Button, Skeleton } from 'antd'
import { isEmpty } from 'lodash'
import { CreditCard, LogIn, LogOut, RefreshCw } from 'lucide-react'
import type { FC } from 'react'
import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

const logger = loggerService.withContext('CherryINOAuth')

const CHERRYIN_OAUTH_SERVER = 'https://open.cherryin.ai'
const CHERRYIN_TOPUP_URL = 'https://open.cherryin.ai/console/topup'

/**
 * Generate avatar initials from a name (first 2 characters)
 */
export const getAvatarInitials = (name: string): string => {
  if (!name) return '??'
  const trimmed = name.trim()
  if (trimmed.length <= 2) return trimmed.toUpperCase()
  return trimmed.slice(0, 2).toUpperCase()
}

interface BalanceInfo {
  balance: number
}

interface CherryINOAuthProps {
  providerId: string
}

const CherryINOAuth: FC<CherryINOAuthProps> = ({ providerId }) => {
  const { updateProvider, provider } = useProvider(providerId)
  const { t } = useTranslation()

  const [isLoggingOut, setIsLoggingOut] = useState(false)
  const [isLoadingData, setIsLoadingData] = useState(false)
  const [balanceInfo, setBalanceInfo] = useState<BalanceInfo | null>(null)
  const [hasOAuthToken, setHasOAuthToken] = useState<boolean | null>(null)

  const hasApiKey = !isEmpty(provider.apiKey)
  // User is considered logged in via OAuth only if they have both API key and OAuth token
  const isOAuthLoggedIn = hasApiKey && hasOAuthToken === true

  const fetchData = useCallback(async () => {
    setIsLoadingData(true)
    try {
      const balance = await window.api.cherryin.getBalance(CHERRYIN_OAUTH_SERVER)
      setBalanceInfo(balance)
    } catch (error) {
      logger.warn('Failed to fetch balance:', error as Error)
      setBalanceInfo(null)
    } finally {
      setIsLoadingData(false)
    }
  }, [])

  // Check if OAuth token exists
  useEffect(() => {
    window.api.cherryin
      .hasToken()
      .then((has) => {
        setHasOAuthToken(has)
      })
      .catch(() => {
        setHasOAuthToken(false)
      })
  }, [])

  useEffect(() => {
    // Only fetch balance if logged in via OAuth
    if (isOAuthLoggedIn) {
      fetchData()
    } else {
      setBalanceInfo(null)
    }
  }, [isOAuthLoggedIn, fetchData])

  const handleOAuthLogin = useCallback(async () => {
    try {
      await oauthWithCherryIn(
        (apiKeys: string) => {
          updateProvider({ apiKey: apiKeys })
          setHasOAuthToken(true)
          window.toast.success(t('auth.get_key_success'))
        },
        {
          oauthServer: CHERRYIN_OAUTH_SERVER
        }
      )
    } catch (error) {
      logger.error('OAuth Error:', error as Error)
      window.toast.error(t('settings.provider.oauth.error'))
    }
  }, [updateProvider, t])

  const handleLogout = useCallback(() => {
    window.modal.confirm({
      title: t('settings.provider.oauth.logout'),
      content: t('settings.provider.oauth.logout_confirm'),
      centered: true,
      onOk: async () => {
        setIsLoggingOut(true)

        try {
          await window.api.cherryin.logout(CHERRYIN_OAUTH_SERVER)
          updateProvider({ apiKey: '' })
          setHasOAuthToken(false)
          setBalanceInfo(null)
          window.toast.success(t('settings.provider.oauth.logout_success'))
        } catch (error) {
          logger.error('Logout error:', error as Error)
          // Still clear local state even if server revocation failed
          updateProvider({ apiKey: '' })
          setHasOAuthToken(false)
          setBalanceInfo(null)
          window.toast.warning(t('settings.provider.oauth.logout_warning'))
        } finally {
          setIsLoggingOut(false)
        }
      }
    })
  }, [updateProvider, t])

  const handleTopup = useCallback(() => {
    window.open(CHERRYIN_TOPUP_URL, '_blank')
  }, [])

  // Render logic:
  // 1. No API key → Show login button
  // 2. Has API key + OAuth token → Show logged-in UI
  // 3. Has API key + No OAuth token (legacy manual key) → Show connect button to upgrade to OAuth
  const renderContent = () => {
    if (!hasApiKey) {
      // Case 1: No API key - show login button
      return (
        <Button type="primary" shape="round" icon={<LogIn size={16} />} onClick={handleOAuthLogin}>
          {t('auth.login')}
        </Button>
      )
    }

    if (hasOAuthToken === null) {
      // Still checking OAuth token status
      return <Skeleton.Input active size="small" style={{ width: 120, height: 32 }} />
    }

    if (!hasOAuthToken) {
      // Case 3: Has API key but no OAuth token (legacy manual key)
      // Show button to connect OAuth for better experience
      return (
        <Button type="primary" shape="round" icon={<LogIn size={16} />} onClick={handleOAuthLogin}>
          {t('auth.login')}
        </Button>
      )
    }

    // Case 2: Has API key + OAuth token - show full logged-in UI
    return (
      <ButtonRow>
        <BalanceCapsule onClick={fetchData} disabled={isLoadingData}>
          <BalanceLabel>{t('settings.provider.oauth.balance')}</BalanceLabel>
          {isLoadingData && !balanceInfo ? (
            <Skeleton.Input active size="small" style={{ width: 50, height: 16, minWidth: 50 }} />
          ) : (
            <BalanceValue>
              ${balanceInfo?.balance.toFixed(2) ?? '--'}
              <RefreshCw size={12} className={isLoadingData ? 'spinning' : ''} />
            </BalanceValue>
          )}
        </BalanceCapsule>
        <TopupButton type="primary" shape="round" icon={<CreditCard size={16} />} onClick={handleTopup}>
          {t('settings.provider.oauth.topup')}
        </TopupButton>
      </ButtonRow>
    )
  }

  return (
    <Container>
      {isOAuthLoggedIn && (
        <LogoutCorner onClick={handleLogout} disabled={isLoggingOut}>
          <LogOut size={14} />
        </LogoutCorner>
      )}
      <ProviderLogo src={CherryINProviderLogo} onClick={() => window.open('https://open.cherryin.ai', '_blank')} />
      {renderContent()}
      <Description>
        {t('settings.provider.oauth.provided_by')}{' '}
        <OfficialWebsite href="https://open.cherryin.ai" target="_blank" rel="noreferrer">
          open.cherryin.ai
        </OfficialWebsite>
        {t('settings.provider.oauth.provided_by_suffix')}
      </Description>
    </Container>
  )
}

const Container = styled.div`
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 15px;
  padding: 20px;
`

const LogoutCorner = styled.button`
  position: absolute;
  top: 8px;
  right: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border: none;
  border-radius: 50%;
  background: transparent;
  color: var(--color-text-3);
  cursor: pointer;
  transition: all 0.2s;

  &:hover {
    background: var(--color-background-soft);
    color: var(--color-error);
  }

  &:disabled {
    cursor: not-allowed;
    opacity: 0.5;
  }
`

const ProviderLogo = styled.img`
  width: 60px;
  height: 60px;
  border-radius: 50%;
  cursor: pointer;
  transition: opacity 0.2s;

  &:hover {
    opacity: 0.8;
  }
`

const ButtonRow = styled.div`
  display: flex;
  align-items: center;
  gap: 12px;
`

const BalanceCapsule = styled.button`
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 0 15px;
  min-width: 110px;
  height: 32px;
  border: 1px solid var(--color-border);
  border-radius: 16px;
  background: var(--color-background-soft);
  cursor: pointer;
  transition: all 0.2s;

  &:hover {
    border-color: var(--color-primary);
  }

  &:disabled {
    cursor: not-allowed;
    opacity: 0.7;
  }

  .spinning {
    animation: spin 1s linear infinite;
  }

  @keyframes spin {
    from {
      transform: rotate(0deg);
    }
    to {
      transform: rotate(360deg);
    }
  }
`

const TopupButton = styled(Button)`
  min-width: 110px;
`

const BalanceLabel = styled.span`
  font-size: 13px;
  color: var(--color-text-3);
`

const BalanceValue = styled.span`
  font-size: 13px;
  font-weight: 600;
  color: var(--color-text-1);
  display: flex;
  align-items: center;
  gap: 4px;
`

const Description = styled.div`
  font-size: 11px;
  color: var(--color-text-2);
  display: flex;
  align-items: center;
  gap: 5px;
`

const OfficialWebsite = styled.a`
  text-decoration: none;
  color: var(--color-text-2);
`

export default CherryINOAuth
