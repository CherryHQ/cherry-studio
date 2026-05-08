import { Button, Skeleton } from '@cherrystudio/ui'
import { Cherryin } from '@cherrystudio/ui/icons'
import { loggerService } from '@logger'
import { useProvider } from '@renderer/hooks/useProvider'
import { oauthWithCherryIn } from '@renderer/utils/oauth'
import { cn } from '@renderer/utils/style'
import { isEmpty } from 'lodash'
import { CreditCard, LogIn, LogOut, RefreshCw } from 'lucide-react'
import type React from 'react'
import type { FC } from 'react'
import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

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
      void fetchData()
    } else {
      setBalanceInfo(null)
    }
  }, [isOAuthLoggedIn, fetchData])

  const handleOAuthLogin = useCallback(async () => {
    try {
      await oauthWithCherryIn(
        (apiKeys: string) => {
          updateProvider({ apiKey: apiKeys, enabled: true })
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
        <Button className="rounded-full" onClick={handleOAuthLogin}>
          <LogIn size={16} />
          {t('auth.login')}
        </Button>
      )
    }

    if (hasOAuthToken === null) {
      // Still checking OAuth token status
      return <Skeleton className="h-8 w-[120px]" />
    }

    if (!hasOAuthToken) {
      // Case 3: Has API key but no OAuth token (legacy manual key)
      // Show button to connect OAuth for better experience
      return (
        <Button className="rounded-full" onClick={handleOAuthLogin}>
          <LogIn size={16} />
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
            <Skeleton className="h-4 min-w-[50px]" />
          ) : (
            <BalanceValue>
              ${balanceInfo?.balance.toFixed(2) ?? '--'}
              <RefreshCw size={12} className={isLoadingData ? 'animate-spin' : ''} />
            </BalanceValue>
          )}
        </BalanceCapsule>
        <TopupButton className="rounded-full" onClick={handleTopup}>
          <CreditCard size={16} />
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
      <ProviderLogoWrapper onClick={() => window.open('https://open.cherryin.ai', '_blank')}>
        <Cherryin.Avatar size={60} shape="circle" />
      </ProviderLogoWrapper>
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

const Container = ({ className, ...props }: React.ComponentPropsWithoutRef<'div'>) => (
  <div className={cn('relative flex flex-col items-center justify-center gap-3.75 p-5', className)} {...props} />
)

const LogoutCorner = ({ className, ...props }: React.ComponentPropsWithoutRef<'button'>) => (
  <button
    className={cn(
      'absolute top-2 right-2 flex h-7 w-7 cursor-pointer items-center justify-center rounded-full border-none bg-transparent text-foreground-muted transition-all hover:bg-background-subtle hover:text-destructive disabled:cursor-not-allowed disabled:opacity-50',
      className
    )}
    {...props}
  />
)

const ProviderLogoWrapper = ({ className, ...props }: React.ComponentPropsWithoutRef<'div'>) => (
  <div className={cn('cursor-pointer transition-opacity hover:opacity-80', className)} {...props} />
)

const ButtonRow = ({ className, ...props }: React.ComponentPropsWithoutRef<'div'>) => (
  <div className={cn('flex items-center gap-3', className)} {...props} />
)

const BalanceCapsule = ({ className, ...props }: React.ComponentPropsWithoutRef<'button'>) => (
  <button
    className={cn(
      'flex h-8 min-w-[110px] cursor-pointer items-center justify-center gap-2 rounded-2xl border border-border bg-background-subtle px-3.75 transition-all hover:border-primary disabled:cursor-not-allowed disabled:opacity-70',
      className
    )}
    {...props}
  />
)

const TopupButton = ({ className, ...props }: React.ComponentPropsWithoutRef<typeof Button>) => (
  <Button className={cn('min-w-[110px]', className)} {...props} />
)

const BalanceLabel = ({ className, ...props }: React.ComponentPropsWithoutRef<'span'>) => (
  <span className={cn('text-[13px] text-foreground-muted', className)} {...props} />
)

const BalanceValue = ({ className, ...props }: React.ComponentPropsWithoutRef<'span'>) => (
  <span className={cn('flex items-center gap-1 font-semibold text-[13px] text-foreground', className)} {...props} />
)

const Description = ({ className, ...props }: React.ComponentPropsWithoutRef<'div'>) => (
  <div className={cn('flex items-center gap-1.25 text-[11px] text-foreground-secondary', className)} {...props} />
)

const OfficialWebsite = ({ className, ...props }: React.ComponentPropsWithoutRef<'a'>) => (
  <a className={cn('text-foreground-secondary no-underline', className)} {...props} />
)

export default CherryINOAuth
