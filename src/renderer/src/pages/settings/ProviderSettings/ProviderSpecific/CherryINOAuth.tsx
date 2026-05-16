import { Button, Skeleton } from '@cherrystudio/ui'
import { Cherryin } from '@cherrystudio/ui/icons'
import { loggerService } from '@logger'
import { useProvider, useProviderAuthConfig } from '@renderer/hooks/useProvider'
import { oauthCardClasses } from '@renderer/pages/settings/ProviderSettings/primitives/ProviderSettingsPrimitives'
import { hasApiKeys } from '@renderer/pages/settings/ProviderSettings/utils/provider'
import { oauthWithCherryIn } from '@renderer/utils/oauth'
import { ExternalLink } from 'lucide-react'
import type { FC } from 'react'
import { useCallback, useEffect, useState } from 'react'
import { Trans, useTranslation } from 'react-i18next'

const logger = loggerService.withContext('CherryINOAuth')

const CHERRYIN_OAUTH_SERVER = 'https://open.cherryin.ai'
const CHERRYIN_TOPUP_URL = 'https://open.cherryin.ai/console/topup'

export const getAvatarInitials = (name: string): string => {
  if (!name) return '??'
  const trimmed = name.trim()
  if (trimmed.length <= 2) return trimmed.toUpperCase()
  return trimmed.slice(0, 2).toUpperCase()
}

interface CherryINProfile {
  displayName: string | null
  username: string | null
  email: string | null
  group: string | null
}

interface BalanceInfo {
  balance: number
  profile: CherryINProfile | null
  monthlyUsageTokens: number | null
  monthlySpend: number | null
}

interface CherryINOAuthProps {
  providerId: string
}

function formatCurrency(value: number | null | undefined): string {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    return '-'
  }

  return `$${value.toFixed(2)}`
}

const CherryINOAuth: FC<CherryINOAuthProps> = ({ providerId }) => {
  const { provider, updateProvider, addApiKey, deleteApiKey } = useProvider(providerId)
  const {
    data: authConfig,
    isLoading: isAuthConfigLoading,
    refetch: refetchAuthConfig
  } = useProviderAuthConfig(providerId)
  const { t } = useTranslation()

  const [isLoggingOut, setIsLoggingOut] = useState(false)
  const [isLoadingData, setIsLoadingData] = useState(false)
  const [balanceInfo, setBalanceInfo] = useState<BalanceInfo | null>(null)
  const [oauthTokenOverride, setOauthTokenOverride] = useState<boolean | null>(null)

  const hasKeys = provider ? hasApiKeys(provider) : false
  const remoteHasOAuthToken = authConfig?.type === 'oauth' && Boolean(authConfig.accessToken)
  const hasOAuthToken = oauthTokenOverride ?? remoteHasOAuthToken
  const isOAuthLoggedIn = hasKeys && hasOAuthToken

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
    if (isOAuthLoggedIn) {
      void fetchData()
    } else {
      setBalanceInfo(null)
    }
  }, [fetchData, isOAuthLoggedIn])

  useEffect(() => {
    if (oauthTokenOverride !== null && remoteHasOAuthToken === oauthTokenOverride) {
      setOauthTokenOverride(null)
    }
  }, [oauthTokenOverride, remoteHasOAuthToken])

  const handleOAuthLogin = useCallback(async () => {
    try {
      await oauthWithCherryIn(
        async (apiKeys: string) => {
          const keys = apiKeys
            .split(',')
            .map((key) => key.trim())
            .filter(Boolean)

          await Promise.all(keys.map((key) => addApiKey(key, 'OAuth')))
          await updateProvider({ isEnabled: true })
          setOauthTokenOverride(true)
          void Promise.resolve(refetchAuthConfig()).catch((error) => {
            logger.warn('Failed to refetch CherryIN auth config after login:', error as Error)
          })
          await fetchData()
          window.toast.success(t('auth.get_key_success'))
        },
        {
          oauthServer: CHERRYIN_OAUTH_SERVER
        }
      )
    } catch (error) {
      logger.error('OAuth error:', error as Error)
      window.toast.error(t('settings.provider.oauth.error'))
    }
  }, [addApiKey, fetchData, refetchAuthConfig, t, updateProvider])

  const handleLogout = useCallback(() => {
    window.modal.confirm({
      title: t('settings.provider.oauth.logout'),
      content: t('settings.provider.oauth.logout_confirm'),
      centered: true,
      onOk: async () => {
        setIsLoggingOut(true)

        try {
          await window.api.cherryin.logout(CHERRYIN_OAUTH_SERVER)
          setOauthTokenOverride(false)
          setBalanceInfo(null)

          void Promise.resolve(refetchAuthConfig()).catch((error) => {
            logger.warn('Failed to refetch CherryIN auth config after logout:', error as Error)
          })

          const oauthKeys = provider?.apiKeys.filter((key) => key.label === 'OAuth') ?? []
          const deleteResults = await Promise.allSettled(oauthKeys.map((key) => deleteApiKey(key.id)))
          const rejectedDeletes = deleteResults.filter((result) => result.status === 'rejected')
          if (rejectedDeletes.length > 0) {
            logger.warn(`Failed to delete ${rejectedDeletes.length} CherryIN OAuth key(s) after logout`)
            window.toast.warning(t('settings.provider.oauth.logout_warning'))
            return
          }

          window.toast.success(t('settings.provider.oauth.logout_success'))
        } catch (error) {
          logger.error('Logout error:', error as Error)
          window.toast.warning(t('settings.provider.oauth.logout_warning'))
        } finally {
          setIsLoggingOut(false)
        }
      }
    })
  }, [deleteApiKey, provider?.apiKeys, refetchAuthConfig, t])

  const handleTopup = useCallback(() => {
    window.open(CHERRYIN_TOPUP_URL, '_blank')
  }, [])

  if (!provider) {
    return null
  }

  if (isAuthConfigLoading && hasKeys) {
    return (
      <div className={oauthCardClasses.container}>
        <div className={oauthCardClasses.shell}>
          <Skeleton className="h-5 w-[220px]" />
          <Skeleton className="mt-2 h-4 w-full" />
          <Skeleton className="mt-2 h-4 w-[82%]" />
        </div>
      </div>
    )
  }

  if (!isOAuthLoggedIn) {
    return (
      <div className={oauthCardClasses.container}>
        <div className={oauthCardClasses.shellLoggedOut}>
          <div className={oauthCardClasses.loginHeaderRow}>
            <div className={oauthCardClasses.loginIconWrap}>
              <Cherryin.Avatar shape="circle" size={32} />
            </div>
            <div className={oauthCardClasses.loginTextBlock}>
              <p className={oauthCardClasses.loginTitle}>{t('settings.provider.oauth.cherryIn.account_title')}</p>
              <p className={oauthCardClasses.loginSubtitle}>{t('settings.provider.oauth.cherryIn.tagline')}</p>
            </div>
          </div>
          <Button className={oauthCardClasses.loginPrimaryCta} onClick={handleOAuthLogin}>
            <ExternalLink className="size-[11px] shrink-0" />
            {t('settings.provider.oauth.cherryIn.login_button')}
          </Button>
        </div>
      </div>
    )
  }

  const profileName =
    balanceInfo?.profile?.displayName || balanceInfo?.profile?.username || balanceInfo?.profile?.email || provider.name
  const profileEmail = balanceInfo?.profile?.email || t('settings.provider.oauth.cherryIn.logged_in')
  const profileGroup =
    balanceInfo?.profile?.group && balanceInfo.profile.group !== 'default' ? balanceInfo.profile.group : null

  return (
    <div className={oauthCardClasses.container}>
      <div className={oauthCardClasses.shellLoggedIn}>
        <div className={oauthCardClasses.loggedInRow}>
          <div className={oauthCardClasses.profileMeta}>
            <div className={oauthCardClasses.avatarSm}>
              <span>{getAvatarInitials(profileName)}</span>
            </div>
            <div className={oauthCardClasses.nameBlock}>
              <div className={oauthCardClasses.nameRow}>
                <div className={oauthCardClasses.loggedInName}>{profileName}</div>
                {profileGroup ? <span className={oauthCardClasses.badge}>{profileGroup}</span> : null}
              </div>
              <div className={oauthCardClasses.loggedInEmail}>{profileEmail}</div>
            </div>
          </div>
          <div className={oauthCardClasses.loggedInActions}>
            <div className={oauthCardClasses.inlineBalanceBlock}>
              <p className={oauthCardClasses.inlineBalanceLabel}>{t('settings.provider.oauth.balance')}</p>
              <div className={oauthCardClasses.inlineBalanceValue}>
                {isLoadingData && !balanceInfo ? (
                  <Skeleton className={`${oauthCardClasses.balanceValueSkeleton} h-5`} />
                ) : (
                  formatCurrency(balanceInfo?.balance)
                )}
              </div>
            </div>
            <Button className={oauthCardClasses.topupPrimaryButton} onClick={handleTopup} size="sm" variant="default">
              {t('settings.provider.oauth.topup')}
            </Button>
            <Button
              className={oauthCardClasses.logoutCompact}
              disabled={isLoggingOut}
              onClick={handleLogout}
              variant="ghost">
              {t('settings.provider.oauth.logout')}
            </Button>
          </div>
        </div>
        <p className={oauthCardClasses.serviceAttribution}>
          <Trans
            i18nKey="settings.provider.oauth.cherryIn.service_attribution"
            components={{
              link: (
                <a
                  key="cherryin-service-link"
                  className={oauthCardClasses.serviceLink}
                  href={CHERRYIN_OAUTH_SERVER}
                  rel="noreferrer"
                  target="_blank"
                />
              )
            }}
          />
        </p>
      </div>
    </div>
  )
}

export default CherryINOAuth
