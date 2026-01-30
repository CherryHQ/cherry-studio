import { loggerService } from '@logger'
import CherryINProviderLogo from '@renderer/assets/images/providers/cherryin.png'
import { HStack } from '@renderer/components/Layout'
import { PROVIDER_URLS } from '@renderer/config/providers'
import { useProvider } from '@renderer/hooks/useProvider'
import { useTimer } from '@renderer/hooks/useTimer'
import { oauthWithCherryIn } from '@renderer/utils/oauth'
import type { MenuProps } from 'antd'
import { Button, Dropdown, Skeleton } from 'antd'
import { isEmpty } from 'lodash'
import { ChevronDown, CreditCard, LogIn, LogOut, RefreshCw } from 'lucide-react'
import type { FC } from 'react'
import { useCallback, useEffect, useState } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import styled from 'styled-components'

const logger = loggerService.withContext('CherryINOAuth')

const OAUTH_TIMEOUT_MS = 10 * 60 * 1000 // 10 minutes
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

  const hasApiKey = !isEmpty(provider.apiKey)

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
    }
  }, [hasApiKey, fetchData])

  const handleOAuthLogin = useCallback(async () => {
    setIsAuthenticating(true)

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
      await window.api.cherryin.logout(CHERRYIN_OAUTH_SERVER)
      updateProvider({ apiKey: '' })
      setUserInfo(null)
      setBalanceInfo(null)
      window.toast.success(t('settings.provider.oauth.logout_success'))
    } catch (error) {
      logger.error('Logout error:', error as Error)
      updateProvider({ apiKey: '' })
      setUserInfo(null)
      setBalanceInfo(null)
      window.toast.warning(t('settings.provider.oauth.logout_success'))
    } finally {
      setIsLoggingOut(false)
    }
  }, [updateProvider, t])

  const handleTopup = useCallback(() => {
    window.open(CHERRYIN_TOPUP_URL, '_blank')
  }, [])

  const providerWebsite = PROVIDER_URLS[provider.id]?.websites.official

  const dropdownItems: MenuProps['items'] = [
    {
      key: 'logout',
      label: t('settings.provider.oauth.logout'),
      icon: <LogOut size={14} />,
      danger: true,
      disabled: isLoggingOut,
      onClick: handleLogout
    }
  ]

  return (
    <Container>
      {hasApiKey && userInfo && (
        <DropdownCorner>
          <Dropdown menu={{ items: dropdownItems }} trigger={['click']} placement="bottomRight">
            <UserDropdownTrigger>
              <UserAvatar>{getAvatarInitials(userInfo.displayName || userInfo.username)}</UserAvatar>
              <UserName>{userInfo.displayName || userInfo.username}</UserName>
              <ChevronDown size={14} />
            </UserDropdownTrigger>
          </Dropdown>
        </DropdownCorner>
      )}
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
        <>
          <HStack gap={12} alignItems="center">
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
            <Button type="primary" shape="round" icon={<CreditCard size={16} />} onClick={handleTopup}>
              {t('settings.provider.oauth.topup')}
            </Button>
          </HStack>
        </>
      )}
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
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 15px;
  padding: 20px;
`

const DropdownCorner = styled.div`
  position: absolute;
  top: 8px;
  right: 8px;
`

const UserDropdownTrigger = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
  padding: 4px 8px 4px 4px;
  border-radius: 20px;
  transition: all 0.2s;
  color: var(--color-text-2);

  &:hover {
    background: var(--color-background-soft);
  }
`

const UserAvatar = styled.div`
  width: 28px;
  height: 28px;
  border-radius: 50%;
  background: var(--color-primary);
  color: white;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 11px;
  font-weight: 600;
  flex-shrink: 0;
`

const UserName = styled.span`
  font-size: 13px;
  font-weight: 500;
  color: var(--color-text-1);
  max-width: 120px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`

const ProviderLogo = styled.img`
  width: 60px;
  height: 60px;
  border-radius: 50%;
`

const BalanceCapsule = styled.button`
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0;
  height: 32px;
  border: none;
  background: transparent;
  cursor: pointer;

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
