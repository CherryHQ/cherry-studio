import { debounce } from 'es-toolkit/compat'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import {
  Button,
  SegmentedControl,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Tooltip
} from '@cherrystudio/ui'
import { useInfiniteFlatItems, useInfiniteQuery } from '@renderer/data/hooks/useDataApi'
import { useDataChange } from '@renderer/data/hooks/useDataChange'
import type { LocalAgentUsageQuery } from '@shared/ai/localAgentUsage'

import type { BoundedTimeRange } from './usageAnalytics'
import { UsagePanel, UsagePanelHeader, UsagePanelTitle } from './UsageSettingsPrimitives'

function Observations({ range, scope }: { range: BoundedTimeRange; scope: LocalAgentUsageQuery['scope'] }) {
  const { t, i18n } = useTranslation()
  const query = useMemo(() => ({ ...range, scope }), [range, scope])
  const { pages, isLoading, error, hasNext, loadNext, refresh, reset } = useInfiniteQuery('/ai-usage-records/local', {
    query,
    limit: 25
  })
  const refreshObservations = useMemo(
    () =>
      debounce(() => {
        reset()
        void refresh()
      }, 300),
    [reset, refresh]
  )
  useEffect(() => () => refreshObservations.cancel(), [refreshObservations])
  useDataChange(['/ai-usage-records/local'], refreshObservations)
  const items = useInfiniteFlatItems(pages)
  const unknown = t('chat.message.token_details.unavailable')
  return (
    <>
      <p className="px-3 py-2 text-muted-foreground text-xs">
        {t(scope === 'turn' ? 'settings.usage.local.turnHint' : 'settings.usage.local.costHint')}
      </p>
      {items.length === 0 ? (
        <p className="p-3 text-muted-foreground text-sm">
          {error ? t('common.error') : isLoading ? t('common.loading') : t('settings.usage.empty.title')}
        </p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('settings.usage.local.observation')}</TableHead>
              <TableHead>{t('settings.usage.local.agent')}</TableHead>
              {scope === 'turn' ? <TableHead>{t('settings.usage.local.model')}</TableHead> : null}
              <TableHead>{t('settings.usage.local.reportedAt')}</TableHead>
              <TableHead className="text-right">
                {t(scope === 'turn' ? 'settings.usage.local.totalTokens' : 'settings.usage.local.cost')}
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((item) => (
              <TableRow key={`${item.scope}:${item.id}`}>
                <TableCell>
                  {t(
                    item.scope === 'legacy-turn'
                      ? 'settings.usage.local.legacy'
                      : item.scope === 'turn'
                        ? 'settings.usage.local.turn'
                        : 'settings.usage.local.sessionCost'
                  )}
                  {item.scope === 'turn' ? (
                    <Tooltip
                      content={t(
                        item.summary?.correlation === 'gateway'
                          ? 'settings.usage.local.correlated'
                          : 'settings.usage.local.unknown'
                      )}>
                      <div className="text-muted-foreground text-xs">
                        {t(item.summary?.correlation === 'gateway' ? 'code.api_gateway.title' : 'common.unknown')}
                      </div>
                    </Tooltip>
                  ) : null}
                </TableCell>
                <TableCell>
                  {item.agentName ?? unknown}
                  {item.sessionName ? (
                    <div className="max-w-56 truncate text-muted-foreground text-xs" title={item.sessionName}>
                      {item.sessionName}
                    </div>
                  ) : null}
                </TableCell>
                {scope === 'turn' ? (
                  <TableCell className="max-w-52 truncate" title={item.model ?? undefined}>
                    {item.model ?? unknown}
                  </TableCell>
                ) : null}
                <TableCell className="whitespace-nowrap">
                  {new Date(item.reportedAt).toLocaleString(i18n.resolvedLanguage)}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {scope === 'turn'
                    ? ((item.summary?.usage.totalTokens ?? item.legacyTokens)?.toLocaleString(i18n.resolvedLanguage) ??
                      unknown)
                    : item.cost
                      ? new Intl.NumberFormat(i18n.resolvedLanguage, {
                          style: 'currency',
                          currency: item.cost.currency,
                          maximumSignificantDigits: 6
                        }).format(item.cost.amount)
                      : unknown}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
      {hasNext ? (
        <Button variant="ghost" className="m-2" onClick={loadNext}>
          {t('settings.usage.explore.loadMore')}
        </Button>
      ) : null}
    </>
  )
}

export function LocalAgentUsage({ range }: { range: BoundedTimeRange }) {
  const { t } = useTranslation()
  const [scope, setScope] = useState<LocalAgentUsageQuery['scope']>('turn')
  return (
    <UsagePanel>
      <UsagePanelHeader className="flex flex-wrap items-center justify-between gap-2">
        <UsagePanelTitle>{t('settings.usage.local.title')}</UsagePanelTitle>
        <SegmentedControl
          size="sm"
          value={scope}
          onValueChange={setScope}
          options={[
            { value: 'turn', label: t('settings.usage.local.turns') },
            { value: 'session-cost', label: t('settings.usage.local.sessionCost') }
          ]}
        />
      </UsagePanelHeader>
      <Observations key={`${scope}:${range.from}:${range.to}`} range={range} scope={scope} />
    </UsagePanel>
  )
}
