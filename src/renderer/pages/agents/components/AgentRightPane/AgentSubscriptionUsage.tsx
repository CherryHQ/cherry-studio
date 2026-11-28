import { RefreshCw } from 'lucide-react'
import { useEffect, useId, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button, Progress, Tooltip } from '@cherrystudio/ui'
import { ipcApi } from '@renderer/ipc'
import { cn } from '@renderer/utils/style'
import type { OutputFor } from '@shared/ipc/types'

type SubscriptionUsage = OutputFor<'ai.local_agents.subscription_usage'>

export function AgentSubscriptionUsage({ agentId, sessionId }: { agentId: string; sessionId?: string }) {
  const { t, i18n } = useTranslation()
  const titleId = useId()
  const [refresh, setRefresh] = useState(0)
  const [snapshot, setSnapshot] = useState<{ refresh: number; usage: SubscriptionUsage }>()
  const usage = snapshot?.usage
  useEffect(() => {
    let active = true
    void ipcApi.request('ai.local_agents.subscription_usage', { agentId, ...(sessionId && { sessionId }) }).then(
      (result) => {
        if (active) setSnapshot({ refresh, usage: result })
      },
      () => {
        if (active) setSnapshot({ refresh, usage: { status: 'unavailable' } })
      }
    )
    return () => {
      active = false
    }
  }, [agentId, sessionId, refresh])
  if (!usage || usage.status === 'unsupported') return null

  const percent = new Intl.NumberFormat(i18n.resolvedLanguage, { maximumFractionDigits: 1 })
  const hours = new Intl.NumberFormat(i18n.resolvedLanguage, { style: 'unit', unit: 'hour', unitDisplay: 'long' })
  const minutes = new Intl.NumberFormat(i18n.resolvedLanguage, { style: 'unit', unit: 'minute', unitDisplay: 'long' })
  const resetTime = new Intl.DateTimeFormat(i18n.resolvedLanguage, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit'
  })
  const refreshLabel = t('common.refresh')

  return (
    <section aria-labelledby={titleId} className="border-t border-border-subtle px-3 py-3">
      <div className="mb-2 flex min-h-6 items-center justify-between gap-2">
        <h3 id={titleId} className="text-xs font-medium text-muted-foreground">
          {t('agent.right_pane.info.subscription_quota')}
        </h3>
        <Tooltip content={refreshLabel}>
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label={refreshLabel}
            className="text-muted-foreground"
            disabled={snapshot?.refresh !== refresh}
            onClick={() => setRefresh((value) => value + 1)}>
            <RefreshCw className="size-3.5" strokeWidth={1.5} />
          </Button>
        </Tooltip>
      </div>
      {usage.status === 'available' ? (
        <div className="space-y-3.5">
          {Array.from(
            Map.groupBy(usage.windows, (window) => window.groupLabel),
            ([group, windows]) => (
              <div key={group ?? ''}>
                {group && <h4 className="mb-1.5 text-xs font-medium wrap-break-word">{group}</h4>}
                <ul
                  className={cn(
                    'grid gap-x-2.5 gap-y-2 text-xs',
                    group ? 'grid-cols-[minmax(0,auto)_minmax(2rem,1fr)_auto]' : 'grid-cols-[minmax(0,1fr)_auto]'
                  )}>
                  {windows.map(({ id, label, usedRatio, resetsAt, durationMinutes }) => {
                    const remaining = Math.max(0, 1 - usedRatio)
                    const remainingLabel = t('settings.subscription.remaining', {
                      percent: percent.format(100 * remaining)
                    })
                    const period =
                      group && durationMinutes
                        ? durationMinutes === 7 * 24 * 60
                          ? t('settings.subscription.limit_weekly')
                          : durationMinutes % 60 === 0
                            ? hours.format(durationMinutes / 60)
                            : minutes.format(durationMinutes)
                        : label
                    return (
                      <li key={id} className="col-span-full grid grid-cols-subgrid items-center gap-y-1">
                        <span className={cn('wrap-break-word', group ? 'text-muted-foreground' : 'font-medium')}>
                          {period}
                        </span>
                        <span className="col-end-[-1] row-start-1 text-end whitespace-nowrap text-muted-foreground tabular-nums">
                          {remainingLabel}
                        </span>
                        <Progress
                          aria-label={group ? group + ' · ' + period : label}
                          aria-valuetext={remainingLabel}
                          className={group ? 'col-start-2 row-start-1 h-1' : 'col-span-full'}
                          max={1}
                          value={remaining}
                        />
                        {resetsAt !== undefined && (
                          <p className="col-span-full text-end text-muted-foreground tabular-nums">
                            {t('settings.subscription.next_recovery', { time: resetTime.format(resetsAt) })}
                          </p>
                        )}
                      </li>
                    )
                  })}
                </ul>
              </div>
            )
          )}
          {!!usage.balances?.length && (
            <ul className="space-y-2">
              {usage.balances.map(({ id, label, amount, currency }) => (
                <li key={id} className="flex items-baseline justify-between gap-2 text-xs">
                  <span className="min-w-0 font-medium wrap-break-word">{label}</span>
                  <span className="shrink-0 tabular-nums">
                    {new Intl.NumberFormat(i18n.resolvedLanguage, { style: 'currency', currency }).format(amount)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : (
        <p role="status" className="text-xs text-muted-foreground">
          {t(
            usage.status === 'signed-out' ? 'settings.subscription.sign_in_usage' : 'settings.subscription.load_failed'
          )}
        </p>
      )}
    </section>
  )
}
