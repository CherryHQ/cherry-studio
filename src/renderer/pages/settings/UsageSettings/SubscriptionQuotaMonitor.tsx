import { useNavigate } from '@tanstack/react-router'
import { AlertCircle, Calendar, CalendarClock, Clock, ExternalLink, Gauge, RefreshCw, RotateCcw } from 'lucide-react'
import type { FC } from 'react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import {
  Badge,
  Button,
  SegmentedControl,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@cherrystudio/ui'
import { useProviders } from '@renderer/hooks/useProvider'
import { ipcApi } from '@renderer/ipc'
import { cn } from '@renderer/utils/style'
import type { SubscriptionQuotaResult } from '@shared/ipc/schemas/provider'

import { UsagePanel, UsageSection, UsageSectionHeader, UsageSectionTitle } from './UsageSettingsPrimitives'

function getProgressColor(percentage: number) {
  if (percentage >= 90) return 'bg-destructive'
  if (percentage >= 70) return 'bg-amber-500'
  return 'bg-emerald-500'
}

function getProgressTextColor(percentage: number) {
  if (percentage >= 90) return 'text-destructive'
  if (percentage >= 70) return 'text-amber-500'
  return 'text-emerald-500'
}

export const SubscriptionQuotaMonitor: FC = () => {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { providers } = useProviders()

  const subscriptionProviders = useMemo(() => providers.filter((p) => p.settings?.subscription?.enabled), [providers])

  const [selectedProviderId, setSelectedProviderId] = useState<string>('')
  const [quotaData, setQuotaData] = useState<Record<string, SubscriptionQuotaResult>>({})
  const [loading, setLoading] = useState<Record<string, boolean>>({})

  // Update selected provider when subscriptionProviders changes
  useEffect(() => {
    if (subscriptionProviders.length > 0) {
      if (!selectedProviderId || !subscriptionProviders.some((p) => p.id === selectedProviderId)) {
        setSelectedProviderId(subscriptionProviders[0].id)
      }
    } else {
      setSelectedProviderId('')
    }
  }, [subscriptionProviders, selectedProviderId])

  const activeProvider = useMemo(
    () => subscriptionProviders.find((p) => p.id === selectedProviderId) ?? subscriptionProviders[0],
    [subscriptionProviders, selectedProviderId]
  )

  const fetchQuota = useCallback(async (providerId: string) => {
    if (!providerId) return
    setLoading((prev) => ({ ...prev, [providerId]: true }))
    try {
      const result = await ipcApi.request('provider.get_subscription_quota', { providerId })
      setQuotaData((prev) => ({ ...prev, [providerId]: result }))
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      setQuotaData((prev) => ({
        ...prev,
        [providerId]: {
          providerId,
          success: false,
          error: message,
          updatedAt: new Date().toISOString()
        }
      }))
    } finally {
      setLoading((prev) => ({ ...prev, [providerId]: false }))
    }
  }, [])

  // Fetch quota when active provider changes or not loaded
  useEffect(() => {
    if (activeProvider?.id && !quotaData[activeProvider.id] && !loading[activeProvider.id]) {
      void fetchQuota(activeProvider.id)
    }
  }, [activeProvider?.id, fetchQuota, quotaData, loading])

  const activeQuota = activeProvider ? quotaData[activeProvider.id] : undefined
  const isLoading = activeProvider ? !!loading[activeProvider.id] : false

  const providerOptions = useMemo(
    () => subscriptionProviders.map((p) => ({ value: p.id, label: p.name })),
    [subscriptionProviders]
  )

  if (subscriptionProviders.length === 0) {
    return (
      <UsageSection>
        <UsagePanel className="p-4 @[640px]/usage:p-5">
          <div className="flex flex-col items-center justify-center gap-3 text-center sm:flex-row sm:justify-between sm:text-left">
            <div className="flex items-center gap-3">
              <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                <CalendarClock className="size-5" />
              </div>
              <div>
                <h3 className="text-sm font-medium text-foreground">{t('settings.usage.quota.title')}</h3>
                <p className="mt-0.5 text-xs text-muted-foreground">{t('settings.usage.quota.empty_description')}</p>
              </div>
            </div>
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5 text-xs shrink-0"
              onClick={() => navigate({ to: '/settings/provider' })}>
              <ExternalLink className="size-3.5" />
              {t('settings.usage.quota.configure_providers')}
            </Button>
          </div>
        </UsagePanel>
      </UsageSection>
    )
  }

  const fiveHour = activeQuota?.fiveHour
  const sevenDay = activeQuota?.sevenDay
  const resets = activeQuota?.resets

  return (
    <UsageSection>
      <UsageSectionHeader>
        <div className="min-w-0">
          <UsageSectionTitle>{t('settings.usage.quota.title')}</UsageSectionTitle>
          <div className="mt-1 flex min-w-0 flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
            <span>{t('settings.usage.quota.subtitle')}</span>
            {activeQuota?.updatedAt && (
              <>
                <span>·</span>
                <span className="text-foreground-tertiary">
                  {t('settings.usage.quota.updated_at')}: {new Date(activeQuota.updatedAt).toLocaleTimeString()}
                </span>
              </>
            )}
          </div>
        </div>

        <div className="flex min-w-0 flex-wrap items-center gap-2">
          {providerOptions.length > 1 && providerOptions.length <= 3 && (
            <SegmentedControl
              options={providerOptions}
              value={selectedProviderId}
              onValueChange={setSelectedProviderId}
              size="sm"
            />
          )}

          {providerOptions.length > 3 && (
            <Select value={selectedProviderId} onValueChange={setSelectedProviderId}>
              <SelectTrigger size="sm" className="w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {providerOptions.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}

          <Button
            type="button"
            variant="outline"
            size="sm"
            className="gap-1.5 text-xs"
            disabled={isLoading}
            onClick={() => void fetchQuota(activeProvider.id)}>
            <RefreshCw className={cn('size-3.5', isLoading && 'animate-spin')} />
            {t('settings.usage.quota.refresh')}
          </Button>
        </div>
      </UsageSectionHeader>

      <UsagePanel>
        <div className="grid min-w-0 grid-cols-1 gap-px bg-border @[560px]/usage:grid-cols-2 @[900px]/usage:grid-cols-3">
          {/* Card 1: 5-Hour Quota */}
          <div className="flex flex-col bg-background p-4">
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span className="font-medium">{t('settings.usage.quota.fiveHour')}</span>
              <Clock className="size-3.5 text-foreground-tertiary" />
            </div>

            <div className="mt-2 flex items-baseline gap-2">
              <span
                className={cn(
                  'text-2xl font-semibold tracking-tight',
                  getProgressTextColor(fiveHour?.usedPercentage ?? 0)
                )}>
                {fiveHour?.usedPercentage ?? 0}%
              </span>
              <span className="text-xs text-muted-foreground">
                {fiveHour?.usedAmount !== undefined && fiveHour?.totalAmount !== undefined
                  ? `${fiveHour.usedAmount} / ${fiveHour.totalAmount} ${fiveHour.unit ?? ''}`
                  : t('settings.usage.quota.used_label')}
              </span>
            </div>

            <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-muted">
              <div
                className={cn('h-full transition-all duration-500', getProgressColor(fiveHour?.usedPercentage ?? 0))}
                style={{ width: `${Math.min(100, Math.max(0, fiveHour?.usedPercentage ?? 0))}%` }}
              />
            </div>

            <div className="mt-3 flex items-center gap-1.5 text-xs text-foreground-tertiary">
              <RotateCcw className="size-3 shrink-0" />
              <span className="truncate">
                {fiveHour?.resetsInFormatted
                  ? t('settings.usage.quota.reset_in', { time: fiveHour.resetsInFormatted })
                  : t('settings.usage.quota.rolling_window')}
              </span>
            </div>
          </div>

          {/* Card 2: 7-Day Quota */}
          <div className="flex flex-col bg-background p-4">
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span className="font-medium">{t('settings.usage.quota.sevenDay')}</span>
              <Calendar className="size-3.5 text-foreground-tertiary" />
            </div>

            <div className="mt-2 flex items-baseline gap-2">
              <span
                className={cn(
                  'text-2xl font-semibold tracking-tight',
                  getProgressTextColor(sevenDay?.usedPercentage ?? 0)
                )}>
                {sevenDay?.usedPercentage ?? 0}%
              </span>
              <span className="text-xs text-muted-foreground">
                {sevenDay?.usedAmount !== undefined && sevenDay?.totalAmount !== undefined
                  ? `${sevenDay.usedAmount} / ${sevenDay.totalAmount} ${sevenDay.unit ?? ''}`
                  : t('settings.usage.quota.used_label')}
              </span>
            </div>

            <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-muted">
              <div
                className={cn('h-full transition-all duration-500', getProgressColor(sevenDay?.usedPercentage ?? 0))}
                style={{ width: `${Math.min(100, Math.max(0, sevenDay?.usedPercentage ?? 0))}%` }}
              />
            </div>

            <div className="mt-3 flex items-center gap-1.5 text-xs text-foreground-tertiary">
              <RotateCcw className="size-3 shrink-0" />
              <span className="truncate">
                {sevenDay?.resetsInFormatted
                  ? t('settings.usage.quota.reset_in', { time: sevenDay.resetsInFormatted })
                  : t('settings.usage.quota.weekly_window')}
              </span>
            </div>
          </div>

          {/* Card 3: Resets & Schedule */}
          <div className="flex flex-col bg-background p-4 @[560px]/usage:col-span-2 @[900px]/usage:col-span-1">
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span className="font-medium">{t('settings.usage.quota.resets')}</span>
              <Gauge className="size-3.5 text-foreground-tertiary" />
            </div>

            <div className="mt-2 flex items-baseline gap-2">
              <span className="text-2xl font-semibold tracking-tight text-foreground">
                {resets?.remainingCount !== undefined
                  ? `${resets.remainingCount}`
                  : resets?.totalCount !== undefined
                    ? `${resets.totalCount}`
                    : t('settings.usage.cards.none')}
              </span>
              <span className="text-xs text-muted-foreground">
                {resets?.remainingCount !== undefined ? t('settings.usage.quota.resets_remaining') : ''}
              </span>
            </div>

            <div className="mt-3 flex items-center gap-2">
              <span className="text-xs text-muted-foreground">{t('settings.usage.quota.cycle_label')}:</span>
              <Badge variant="outline" className="text-[11px] font-normal">
                {resets?.resetInterval ?? t('settings.usage.quota.auto_reset')}
              </Badge>
            </div>

            <div className="mt-auto pt-3 flex items-center justify-between border-t border-border/40 text-xs text-foreground-tertiary">
              <span className="truncate">{activeProvider?.name}</span>
              {activeQuota?.source && (
                <Badge variant="secondary" className="text-[10px] px-1.5 py-0 uppercase">
                  {activeQuota.source}
                </Badge>
              )}
            </div>
          </div>
        </div>

        {activeQuota && !activeQuota.success && activeQuota.error && (
          <div className="flex items-center gap-2 border-t border-border bg-destructive/5 p-3 text-xs text-destructive">
            <AlertCircle className="size-4 shrink-0" />
            <span>{activeQuota.error}</span>
          </div>
        )}
      </UsagePanel>
    </UsageSection>
  )
}

export default SubscriptionQuotaMonitor
