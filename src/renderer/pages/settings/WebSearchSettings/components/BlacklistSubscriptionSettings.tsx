import { RefreshCw, Trash2 } from 'lucide-react'
import type { FC } from 'react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Alert, Button, Input, Tooltip } from '@cherrystudio/ui'
import { SettingGroup, SettingSubtitle } from '@renderer/components/SettingsPrimitives'
import { usePreference } from '@data/hooks/usePreference'
import { useTheme } from '@renderer/hooks/useTheme'
import { ipcApi } from '@renderer/ipc'
import { toast } from '@renderer/services/toast'
import { isValidSubscriptionUrl } from '@shared/utils/blacklistSubscription'

interface Props {
  variant?: 'card' | 'plain'
}

function formatUpdatedAt(updatedAt: string | undefined, locale: string): string {
  if (!updatedAt) return ''
  const date = new Date(updatedAt)
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleString(locale)
}

const BlacklistSubscriptionSettings: FC<Props> = ({ variant = 'card' }) => {
  const { theme } = useTheme()
  const { t, i18n } = useTranslation()
  const [subscriptions] = usePreference('chat.web_search.blacklist_subscriptions')
  const [urlInput, setUrlInput] = useState('')
  const [invalidUrl, setInvalidUrl] = useState(false)
  const [adding, setAdding] = useState(false)
  const [pendingId, setPendingId] = useState<string | null>(null)

  async function addSubscription() {
    const url = urlInput.trim()
    if (!isValidSubscriptionUrl(url)) {
      setInvalidUrl(true)
      return
    }

    setInvalidUrl(false)
    setAdding(true)
    try {
      const added = await ipcApi.request('web_search.blacklist_subscriptions.add', { url })
      setUrlInput('')
      toast.info({
        title: t('settings.tool.websearch.blacklist_subscription_added', { count: added.rules.length }),
        timeout: 4000
      })
    } catch (error) {
      toast.error({
        title: t('settings.tool.websearch.blacklist_subscription_add_failed'),
        description: error instanceof Error ? error.message : String(error)
      })
    } finally {
      setAdding(false)
    }
  }

  async function refreshSubscription(id: string) {
    setPendingId(id)
    try {
      await ipcApi.request('web_search.blacklist_subscriptions.refresh', { id })
    } catch (error) {
      toast.error({
        title: t('settings.tool.websearch.blacklist_subscription_refresh_failed'),
        description: error instanceof Error ? error.message : String(error)
      })
    } finally {
      setPendingId(null)
    }
  }

  async function removeSubscription(id: string) {
    setPendingId(id)
    try {
      await ipcApi.request('web_search.blacklist_subscriptions.remove', { id })
    } catch (error) {
      toast.error({
        title: t('settings.tool.websearch.blacklist_subscription_remove_failed'),
        description: error instanceof Error ? error.message : String(error)
      })
    } finally {
      setPendingId(null)
    }
  }

  return (
    <SettingGroup theme={theme} variant={variant}>
      <div className="flex min-h-6 items-center">
        <SettingSubtitle>{t('settings.tool.websearch.blacklist_subscriptions')}</SettingSubtitle>
      </div>
      <div className="mt-2.5 flex items-center gap-2">
        <Input
          aria-label={t('settings.tool.websearch.blacklist_subscriptions')}
          value={urlInput}
          onChange={(e) => {
            setUrlInput(e.target.value)
            setInvalidUrl(false)
          }}
          placeholder={t('settings.tool.websearch.blacklist_subscription_url_placeholder')}
          className="h-8 flex-1 text-sm"
          onKeyDown={(e) => {
            if (e.key === 'Enter') void addSubscription()
          }}
        />
        <Button type="button" size="sm" variant="outline" disabled={adding || !urlInput.trim()} onClick={() => void addSubscription()}>
          {t('common.add')}
        </Button>
      </div>
      {invalidUrl && (
        <Alert
          className="mt-1"
          message={t('settings.tool.websearch.blacklist_subscription_invalid_url')}
          type="error"
        />
      )}
      {(subscriptions ?? []).map((subscription) => (
        <div
          key={subscription.id}
          className="mt-2 flex items-center justify-between gap-2 rounded-lg border border-border px-2.5 py-1.5">
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm">{subscription.name || subscription.url}</div>
            <div className="truncate text-muted-foreground text-xs">
              {t('settings.tool.websearch.blacklist_subscription_rule_count', { count: subscription.rules.length })}
              {subscription.updatedAt
                ? ` · ${t('settings.tool.websearch.blacklist_subscription_updated_at', {
                    time: formatUpdatedAt(subscription.updatedAt, i18n.language)
                  })}`
                : ''}
            </div>
            {subscription.lastError && (
              <div className="truncate text-destructive text-xs" title={subscription.lastError}>
                {t('settings.tool.websearch.blacklist_subscription_last_error', { error: subscription.lastError })}
              </div>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <Tooltip content={t('common.refresh')}>
              <Button
                type="button"
                size="icon"
                variant="ghost"
                aria-label={t('common.refresh')}
                disabled={pendingId === subscription.id}
                onClick={() => void refreshSubscription(subscription.id)}>
                <RefreshCw className="size-4" />
              </Button>
            </Tooltip>
            <Tooltip content={t('common.delete')}>
              <Button
                type="button"
                size="icon"
                variant="ghost"
                aria-label={t('common.delete')}
                disabled={pendingId === subscription.id}
                onClick={() => void removeSubscription(subscription.id)}>
                <Trash2 className="size-4" />
              </Button>
            </Tooltip>
          </div>
        </div>
      ))}
    </SettingGroup>
  )
}
export default BlacklistSubscriptionSettings
