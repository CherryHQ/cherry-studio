import { loggerService } from '@logger'
import CherryINProviderLogo from '@renderer/assets/images/providers/cherryin.png'
import { VStack } from '@renderer/components/Layout'
import { PROVIDER_URLS } from '@renderer/config/providers'
import { useProvider } from '@renderer/hooks/useProvider'
import { useTimer } from '@renderer/hooks/useTimer'
import { oauthWithCherryIn } from '@renderer/utils/oauth'
import { Button, Progress, Skeleton } from 'antd'
import { isEmpty } from 'lodash'
import { LogIn, LogOut, RefreshCw } from 'lucide-react'
import type { FC } from 'react'
import { useCallback, useEffect, useState } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import styled from 'styled-components'

const logger = loggerService.withContext('CherryINOAuth')

const OAUTH_TIMEOUT_MS = 10 * 60 * 1000 // 10 minutes
const CHERRYIN_OAUTH_SERVER = 'https://open.cherryin.ai'

interface UserInfo {
  id: number
  username: string
  displayName?: string
  email: string
  group?: string
}

interface BalanceInfo {
  balance: number
}

interface UsageInfo {
  requestCount: number
  usedPercent: number
}

interface CherryINOAuthProps {
  providerId: string
}

const CherryINOAuth: FC<CherryINOAuthProps> = ({ providerId }) => {
  const { updateProvider, provider } = useProvider(providerId)
  const { t } = useTranslation()
  const { setTimeoutTimer, clearTimeoutTimer } = useTimer()

  const [isAuthenticating, setIsAuthenticating] = useState(false)
  const [isLoggingOut, setIsLoggingOut] = useState(false)
  const [isLoadingData, setIsLoadingData] = useState(false)
  const [userInfo, setUserInfo] = useState<UserInfo | null>(null)
  const [balanceInfo, setBalanceInfo] = useState<BalanceInfo | null>(null)
  const [usageInfo, setUsageInfo] = useState<UsageInfo | null>(null)

  const hasApiKey = !isEmpty(provider.apiKey)

  const fetchData = useCallback(async () => {
    setIsLoadingData(true)
    try {
      const [balance, usage] = await Promise.all([
        window.api.cherryin.getBalance(CHERRYIN_OAUTH_SERVER),
        window.api.cherryin.getUsage(CHERRYIN_OAUTH_SERVER)
      ])
      setBalanceInfo(balance)
      setUsageInfo(usage)
    } catch (error) {
      logger.warn('Failed to fetch data:', error as Error)
      setBalanceInfo(null)
      setUsageInfo(null)
    } finally {
      setIsLoadingData(false)
    }
  }, [])

  // Fetch user info and data when logged in
  useEffect(() => {
    if (hasApiKey) {
      window.api.cherryin
        .getUserInfo(CHERRYIN_OAUTH_SERVER)
        .then((info) => {
          setUserInfo(info)
        })
        .catch((error) => {
          logger.warn('Failed to fetch user info:', error as Error)
          setUserInfo(null)
        })

      fetchData()
    } else {
      setUserInfo(null)
      setBalanceInfo(null)
      setUsageInfo(null)
    }
  }, [hasApiKey, fetchData])

  const handleOAuthLogin = useCallback(async () => {
    setIsAuthenticating(true)

    // Set a timeout to reset authenticating state (auto-cleanup on unmount via useTimer)
    setTimeoutTimer(
      'oauth-timeout',
      () => {
        logger.warn('Component-level timeout reached')
        setIsAuthenticating(false)
      },
      OAUTH_TIMEOUT_MS
    )

    try {
      await oauthWithCherryIn(
        (apiKeys: string) => {
          updateProvider({ apiKey: apiKeys })
          window.toast.success(t('auth.get_key_success'))
        },
        {
          oauthServer: CHERRYIN_OAUTH_SERVER
        }
      )
    } catch (error) {
      logger.error('OAuth Error:', error as Error)
      window.toast.error(t('settings.provider.oauth.error'))
    } finally {
      clearTimeoutTimer('oauth-timeout')
      setIsAuthenticating(false)
    }
  }, [updateProvider, t, setTimeoutTimer, clearTimeoutTimer])

  const handleLogout = useCallback(async () => {
    setIsLoggingOut(true)

    try {
      // Revoke token on server and delete local token
      await window.api.cherryin.logout(CHERRYIN_OAUTH_SERVER)
      // Clear API key
      updateProvider({ apiKey: '' })
      setUserInfo(null)
      setBalanceInfo(null)
      setUsageInfo(null)
      window.toast.success(t('settings.provider.oauth.logout_success'))
    } catch (error) {
      logger.error('Logout error:', error as Error)
      // Still clear local API key even if server revoke fails
      updateProvider({ apiKey: '' })
      setUserInfo(null)
      setBalanceInfo(null)
      setUsageInfo(null)
      window.toast.warning(t('settings.provider.oauth.logout_success'))
    } finally {
      setIsLoggingOut(false)
    }
  }, [updateProvider, t])

  const providerWebsite = PROVIDER_URLS[provider.id]?.websites.official

  return (
    <Container>
      <TopSection>
        <LeftSection>
          <ProviderLogo src={CherryINProviderLogo} />
          {!hasApiKey ? (
            <Button
              type="primary"
              shape="round"
              icon={<LogIn size={16} />}
              onClick={handleOAuthLogin}
              loading={isAuthenticating}>
              {t('settings.provider.oauth.button', { provider: 'CherryIN' })}
            </Button>
          ) : (
            <VStack gap={8} alignItems="center">
              {userInfo && (
                <UserInfoContainer>
                  <UserName>{userInfo.displayName || userInfo.username}</UserName>
                  <UserEmail>{userInfo.email}</UserEmail>
                </UserInfoContainer>
              )}
              <Button shape="round" icon={<LogOut size={16} />} onClick={handleLogout} loading={isLoggingOut} danger>
                {t('settings.provider.oauth.logout')}
              </Button>
            </VStack>
          )}
        </LeftSection>
        {hasApiKey && (
          <UsageContainer>
            <UsageHeader>
              <UsageTitle>{t('settings.provider.oauth.usage_title')}</UsageTitle>
              <RefreshButton onClick={fetchData} disabled={isLoadingData}>
                <RefreshCw size={14} className={isLoadingData ? 'spinning' : ''} />
              </RefreshButton>
            </UsageHeader>
            {isLoadingData && !usageInfo ? (
              <SkeletonWrapper>
                <Skeleton.Button active block size="small" style={{ height: 8 }} />
              </SkeletonWrapper>
            ) : (
              <Progress
                percent={Math.min(usageInfo?.usedPercent ?? 0, 100)}
                size="small"
                strokeColor={{
                  '0%': 'var(--color-primary)',
                  '100%': (usageInfo?.usedPercent ?? 0) > 80 ? 'var(--color-error)' : 'var(--color-primary)'
                }}
              />
            )}
            <UsageDetails>
              <UsageItem>
                <UsageLabel>{t('settings.provider.oauth.balance')}</UsageLabel>
                {isLoadingData && !balanceInfo ? (
                  <SkeletonWrapper style={{ width: 50 }}>
                    <Skeleton.Button active block size="small" style={{ height: 18 }} />
                  </SkeletonWrapper>
                ) : (
                  <UsageValue>${balanceInfo?.balance.toFixed(2) ?? '--'}</UsageValue>
                )}
              </UsageItem>
              <UsageItem>
                <UsageLabel>{t('settings.provider.oauth.requests')}</UsageLabel>
                {isLoadingData && !usageInfo ? (
                  <SkeletonWrapper style={{ width: 40 }}>
                    <Skeleton.Button active block size="small" style={{ height: 18 }} />
                  </SkeletonWrapper>
                ) : (
                  <UsageValue>{usageInfo?.requestCount.toLocaleString() ?? '--'}</UsageValue>
                )}
              </UsageItem>
            </UsageDetails>
          </UsageContainer>
        )}
      </TopSection>
      <Description>
        <Trans
          i18nKey="settings.provider.oauth.description"
          components={{
            website: (
              <OfficialWebsite href={PROVIDER_URLS[provider.id]?.websites.official} target="_blank" rel="noreferrer" />
            )
          }}
          values={{ provider: providerWebsite }}
        />
      </Description>
    </Container>
  )
}

const Container = styled.div`
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 15px;
  padding: 20px;
`

const TopSection = styled.div`
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 30px;
  width: 100%;
`

const LeftSection = styled.div`
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
`

const ProviderLogo = styled.img`
  width: 60px;
  height: 60px;
  border-radius: 50%;
`

const UserInfoContainer = styled.div`
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
`

const UserName = styled.span`
  font-size: 14px;
  font-weight: 500;
  color: var(--color-text-1);
`

const UserEmail = styled.span`
  font-size: 12px;
  color: var(--color-text-3);
`

const UsageContainer = styled.div`
  width: 220px;
  padding: 12px;
  background: var(--color-background-soft);
  border-radius: 8px;
`

const UsageHeader = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
`

const UsageTitle = styled.span`
  font-size: 12px;
  font-weight: 500;
  color: var(--color-text-2);
`

const RefreshButton = styled.button`
  background: none;
  border: none;
  padding: 4px;
  cursor: pointer;
  color: var(--color-text-3);
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 4px;
  transition: all 0.2s;

  &:hover {
    color: var(--color-text-1);
    background: var(--color-background-mute);
  }

  &:disabled {
    cursor: not-allowed;
    opacity: 0.5;
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

const UsageDetails = styled.div`
  display: flex;
  justify-content: space-between;
  margin-top: 8px;
  gap: 12px;
`

const UsageItem = styled.div`
  display: flex;
  flex-direction: column;
  gap: 2px;
  flex: 1;
  min-width: 0;
  overflow: hidden;
`

const UsageLabel = styled.span`
  font-size: 11px;
  color: var(--color-text-3);
`

const UsageValue = styled.span`
  font-size: 13px;
  font-weight: 500;
  color: var(--color-text-1);
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

const SkeletonWrapper = styled.div`
  width: 100%;
  .ant-skeleton-button {
    min-width: 0 !important;
    width: 100% !important;
  }
`

export default CherryINOAuth
