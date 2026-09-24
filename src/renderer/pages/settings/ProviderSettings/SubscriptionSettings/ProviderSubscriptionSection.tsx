import { CalendarClock, CheckCircle2, Play, RefreshCw, XCircle } from 'lucide-react'
import type { FC } from 'react'
import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button, Input, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, Switch } from '@cherrystudio/ui'
import { useProvider } from '@renderer/hooks/useProvider'
import { ipcApi } from '@renderer/ipc'
import { toast } from '@renderer/services/toast'
import type { ProviderSubscriptionMethod } from '@shared/data/types/provider'
import type { SubscriptionQuotaResult } from '@shared/ipc/schemas/provider'

interface ProviderSubscriptionSectionProps {
  providerId: string
}

export const ProviderSubscriptionSection: FC<ProviderSubscriptionSectionProps> = ({ providerId }) => {
  const { t } = useTranslation()
  const { provider, updateProvider } = useProvider(providerId)

  const subscription = provider?.settings?.subscription
  const isEnabled = subscription?.enabled ?? false
  const currentMethod: ProviderSubscriptionMethod = subscription?.method ?? 'auto'
  const cliCommand = subscription?.cliCommand ?? ''
  const httpUrl = subscription?.httpUrl ?? ''

  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<SubscriptionQuotaResult | null>(null)

  const handleToggleEnabled = useCallback(
    async (checked: boolean) => {
      try {
        await updateProvider({
          providerSettings: {
            ...provider?.settings,
            subscription: {
              enabled: checked,
              method: currentMethod,
              cliCommand: cliCommand || undefined,
              httpUrl: httpUrl || undefined
            }
          }
        })
        toast.success(
          checked
            ? t('settings.provider.subscription.enabled_toast')
            : t('settings.provider.subscription.disabled_toast')
        )
      } catch {
        toast.error(t('settings.provider.save_failed'))
      }
    },
    [cliCommand, currentMethod, httpUrl, provider?.settings, t, updateProvider]
  )

  const handleMethodChange = useCallback(
    async (method: ProviderSubscriptionMethod) => {
      try {
        await updateProvider({
          providerSettings: {
            ...provider?.settings,
            subscription: {
              enabled: isEnabled,
              method,
              cliCommand: cliCommand || undefined,
              httpUrl: httpUrl || undefined
            }
          }
        })
      } catch {
        toast.error(t('settings.provider.save_failed'))
      }
    },
    [cliCommand, httpUrl, isEnabled, provider?.settings, t, updateProvider]
  )

  const handleCliCommandBlur = useCallback(
    async (nextCommand: string) => {
      if (nextCommand === cliCommand) return
      try {
        await updateProvider({
          providerSettings: {
            ...provider?.settings,
            subscription: {
              enabled: isEnabled,
              method: currentMethod,
              cliCommand: nextCommand.trim() || undefined,
              httpUrl: httpUrl || undefined
            }
          }
        })
      } catch {
        toast.error(t('settings.provider.save_failed'))
      }
    },
    [cliCommand, currentMethod, httpUrl, isEnabled, provider?.settings, t, updateProvider]
  )

  const handleHttpUrlBlur = useCallback(
    async (nextUrl: string) => {
      if (nextUrl === httpUrl) return
      try {
        await updateProvider({
          providerSettings: {
            ...provider?.settings,
            subscription: {
              enabled: isEnabled,
              method: currentMethod,
              cliCommand: cliCommand || undefined,
              httpUrl: nextUrl.trim() || undefined
            }
          }
        })
      } catch {
        toast.error(t('settings.provider.save_failed'))
      }
    },
    [cliCommand, currentMethod, httpUrl, isEnabled, provider?.settings, t, updateProvider]
  )

  const handleTestRetrieval = useCallback(async () => {
    setTesting(true)
    setTestResult(null)
    try {
      const result = await ipcApi.request('provider.get_subscription_quota', {
        providerId,
        method: currentMethod,
        cliCommand: cliCommand || undefined,
        httpUrl: httpUrl || undefined
      })
      setTestResult(result)
      if (result.success) {
        toast.success(t('settings.provider.subscription.test_success'))
      } else {
        toast.error(result.error || t('settings.provider.subscription.test_failed'))
      }
    } catch (error) {
      toast.error(t('settings.provider.subscription.test_failed'))
    } finally {
      setTesting(false)
    }
  }, [currentMethod, cliCommand, httpUrl, providerId, t])

  return (
    <section className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <CalendarClock className="size-4.5 text-primary" aria-hidden />
          <div>
            <h3 className="text-sm font-medium text-foreground">{t('settings.provider.subscription.title')}</h3>
            <p className="text-xs text-muted-foreground">{t('settings.provider.subscription.description')}</p>
          </div>
        </div>
        <Switch checked={isEnabled} onCheckedChange={(checked) => void handleToggleEnabled(checked)} />
      </div>

      {isEnabled && (
        <div className="mt-2 flex flex-col gap-3 border-t border-border/60 pt-3">
          <div className="flex flex-col gap-1.5 sm:flex-row sm:items-center sm:justify-between">
            <span className="text-xs font-medium text-foreground">
              {t('settings.provider.subscription.method_label')}
            </span>
            <Select
              value={currentMethod}
              onValueChange={(val) => void handleMethodChange(val as ProviderSubscriptionMethod)}>
              <SelectTrigger size="sm" className="w-full sm:w-44">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="auto">{t('settings.provider.subscription.method_auto')}</SelectItem>
                <SelectItem value="cli">{t('settings.provider.subscription.method_cli')}</SelectItem>
                <SelectItem value="http">{t('settings.provider.subscription.method_http')}</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {(currentMethod === 'cli' || currentMethod === 'auto') && (
            <div className="flex flex-col gap-1">
              <span className="text-xs text-muted-foreground">
                {t('settings.provider.subscription.cli_command_label')}
              </span>
              <Input
                defaultValue={cliCommand}
                placeholder={providerId === 'claude-code' ? 'claude /usage' : `${providerId} /usage`}
                className="h-8 text-xs font-mono"
                onBlur={(e) => void handleCliCommandBlur(e.target.value)}
              />
            </div>
          )}

          {(currentMethod === 'http' || currentMethod === 'auto') && (
            <div className="flex flex-col gap-1">
              <span className="text-xs text-muted-foreground">
                {t('settings.provider.subscription.http_url_label')}
              </span>
              <Input
                defaultValue={httpUrl}
                placeholder={t('settings.provider.subscription.http_url_placeholder')}
                className="h-8 text-xs font-mono"
                onBlur={(e) => void handleHttpUrlBlur(e.target.value)}
              />
            </div>
          )}

          <div className="mt-1 flex items-center justify-between gap-2 pt-1">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="gap-1.5 text-xs"
              disabled={testing}
              onClick={() => void handleTestRetrieval()}>
              {testing ? <RefreshCw className="size-3.5 animate-spin" /> : <Play className="size-3.5" />}
              {t('settings.provider.subscription.test_button')}
            </Button>

            {testResult && (
              <div className="flex items-center gap-1.5 text-xs">
                {testResult.success ? (
                  <>
                    <CheckCircle2 className="size-3.5 text-success" />
                    <span className="text-success-foreground">
                      5h: {testResult.fiveHour?.usedPercentage ?? 0}% | 7d: {testResult.sevenDay?.usedPercentage ?? 0}%
                    </span>
                  </>
                ) : (
                  <>
                    <XCircle className="size-3.5 text-destructive" />
                    <span className="max-w-[200px] truncate text-destructive">
                      {testResult.error || t('settings.provider.subscription.test_failed')}
                    </span>
                  </>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </section>
  )
}

export default ProviderSubscriptionSection
