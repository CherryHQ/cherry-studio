import { Navbar, NavbarCenter } from '@renderer/components/app/Navbar'
import Scrollbar from '@renderer/components/Scrollbar'
import db from '@renderer/databases'
import { useSettings } from '@renderer/hooks/useSettings'
import { TopicManager } from '@renderer/hooks/useTopic'
import { locateToMessage } from '@renderer/services/MessagesService'
import { getProviderNameById } from '@renderer/services/ProviderService'
import {
  aggregateUsageTotals,
  bucketUsageEvents,
  filterUsageEvents,
  groupUsageByModel,
  groupUsageByModule,
  type UsageBucket,
  type UsageFilters
} from '@renderer/services/usage/UsageAnalyticsService'
import type { UsageCategory, UsageEvent, UsageModule } from '@renderer/types'
import type { Dayjs } from 'dayjs'
import dayjs from 'dayjs'
import { useLiveQuery } from 'dexie-react-hooks'
import type { FC } from 'react'
import { useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import styled from 'styled-components'

import FilterBar from './components/FilterBar'
import KPICards from './components/KPICards'
import StatsTable from './components/StatsTable'
import TrendChart from './components/TrendChart'
import UsageEventsTable from './components/UsageEventsTable'
import { getUsageCategoryLabelKey, getUsageModuleLabelKey } from './usageI18n'

const MODULE_ORDER: UsageModule[] = ['chat', 'agent', 'translate', 'knowledge', 'websearch', 'paintings']

const UsageStatsPage: FC = () => {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { defaultPaintingProvider } = useSettings()
  const [bucket, setBucket] = useState<UsageBucket>('day')
  const [range, setRange] = useState<[Dayjs | null, Dayjs | null] | null>([dayjs().subtract(29, 'day'), dayjs()])
  const [selectedModules, setSelectedModules] = useState<UsageModule[]>([])
  const [selectedCategories, setSelectedCategories] = useState<UsageCategory[]>([])
  const [selectedProviders, setSelectedProviders] = useState<string[]>([])
  const [selectedModels, setSelectedModels] = useState<string[]>([])

  const rangeStart = range?.[0]?.startOf('day').valueOf()
  const rangeEnd = range?.[1]?.endOf('day').valueOf()

  const rawEvents = useLiveQuery<UsageEvent[]>(() => {
    if (rangeStart && rangeEnd) {
      return db.usage_events.where('occurredAt').between(rangeStart, rangeEnd, true, true).toArray()
    }
    return db.usage_events.orderBy('occurredAt').reverse().toArray()
  }, [rangeStart, rangeEnd])

  const filters: UsageFilters = useMemo(
    () => ({
      modules: selectedModules.length ? selectedModules : undefined,
      categories: selectedCategories.length ? selectedCategories : undefined,
      providerIds: selectedProviders.length ? selectedProviders : undefined,
      modelIds: selectedModels.length ? selectedModels : undefined
    }),
    [selectedCategories, selectedModels, selectedModules, selectedProviders]
  )

  const filteredEvents = useMemo(() => {
    return filterUsageEvents(rawEvents || [], filters)
  }, [filters, rawEvents])

  const totals = useMemo(() => aggregateUsageTotals(filteredEvents), [filteredEvents])

  const formatNumber = useCallback((value: number) => new Intl.NumberFormat().format(value), [])
  const formatCurrencyMap = useCallback((map: Record<string, number>) => {
    const entries = Object.entries(map)
    if (!entries.length) {
      return '-'
    }
    return entries
      .sort((a, b) => b[1] - a[1])
      .map(([currency, amount]) => `${currency}${amount.toFixed(4)}`)
      .join(' · ')
  }, [])

  const pickPrimaryCurrency = useCallback((map: Record<string, number>) => {
    const entries = Object.entries(map)
    if (!entries.length) {
      return undefined
    }
    return entries.sort((a, b) => b[1] - a[1])[0][0]
  }, [])

  const pricingCurrency = useMemo(
    () => pickPrimaryCurrency(totals.costPricingByCurrency),
    [pickPrimaryCurrency, totals]
  )
  const providerCurrency = useMemo(
    () => pickPrimaryCurrency(totals.costProviderByCurrency),
    [pickPrimaryCurrency, totals]
  )

  const trendData = useMemo(() => {
    const points = bucketUsageEvents(filteredEvents, bucket)
    return points.map((point) => ({
      label: bucket === 'month' ? dayjs(point.bucketStart).format('YYYY-MM') : dayjs(point.bucketStart).format('MM-DD'),
      tokens: point.totals.totalTokens,
      pricingCost: pricingCurrency ? (point.totals.costPricingByCurrency[pricingCurrency] ?? 0) : undefined,
      providerCost: providerCurrency ? (point.totals.costProviderByCurrency[providerCurrency] ?? 0) : undefined
    }))
  }, [bucket, filteredEvents, pricingCurrency, providerCurrency])

  const moduleRows = useMemo(() => {
    return groupUsageByModule(filteredEvents)
      .map((row) => ({
        ...row,
        label: row.module ? t(getUsageModuleLabelKey(row.module)) : t('usage.unknown')
      }))
      .sort((a, b) => b.totals.totalTokens - a.totals.totalTokens)
  }, [filteredEvents, t])

  const modelRows = useMemo(() => {
    return groupUsageByModel(filteredEvents).sort((a, b) => b.totals.totalTokens - a.totals.totalTokens)
  }, [filteredEvents])

  const moduleOptions = useMemo(() => {
    const available = new Set<UsageModule>()
    ;(rawEvents || []).forEach((event) => {
      if (event.module) {
        available.add(event.module)
      }
    })
    return MODULE_ORDER.filter((value) => available.has(value)).map((value) => ({
      value,
      label: t(getUsageModuleLabelKey(value))
    }))
  }, [rawEvents, t])

  const categoryOptions = useMemo(() => {
    const available = new Set<UsageCategory>()
    ;(rawEvents || []).forEach((event) => {
      if (event.category) {
        available.add(event.category)
      }
    })
    return Array.from(available).map((value) => ({
      value,
      label: t(getUsageCategoryLabelKey(value))
    }))
  }, [rawEvents, t])

  const providerOptions = useMemo(() => {
    const available = new Set<string>()
    ;(rawEvents || []).forEach((event) => {
      if (event.providerId) {
        available.add(event.providerId)
      }
    })
    return Array.from(available).map((value) => ({
      value,
      label: getProviderNameById(value)
    }))
  }, [rawEvents])

  const modelOptions = useMemo(() => {
    const providerMap = new Map<string, Map<string, string>>()
    ;(rawEvents || []).forEach((event) => {
      if (!event.modelId) {
        return
      }
      const providerKey = event.providerId || t('usage.unknown')
      if (!providerMap.has(providerKey)) {
        providerMap.set(providerKey, new Map())
      }
      const modelLabel = event.modelName || event.modelId
      providerMap.get(providerKey)!.set(event.modelId, modelLabel)
    })

    return Array.from(providerMap.entries()).map(([provider, models]) => ({
      label: provider === t('usage.unknown') ? provider : getProviderNameById(provider),
      options: Array.from(models.entries()).map(([value, label]) => ({ value, label }))
    }))
  }, [rawEvents, t])

  const recentEvents = useMemo(() => {
    return [...(filteredEvents || [])].sort((a, b) => b.occurredAt - a.occurredAt).slice(0, 100)
  }, [filteredEvents])

  const resetFilters = useCallback(() => {
    setBucket('day')
    setRange([dayjs().subtract(29, 'day'), dayjs()])
    setSelectedModules([])
    setSelectedCategories([])
    setSelectedProviders([])
    setSelectedModels([])
  }, [])

  const openModule = useCallback(
    (module: UsageModule) => {
      if (module === 'paintings') {
        navigate(`/paintings/${defaultPaintingProvider}`)
        return
      }
      if (module === 'translate') {
        navigate('/translate')
        return
      }
      if (module === 'knowledge' || module === 'websearch') {
        navigate('/knowledge')
        return
      }
      navigate('/')
    },
    [defaultPaintingProvider, navigate]
  )

  const isOpenable = useCallback((event: UsageEvent) => {
    if (event.refType === 'translate_history' && event.refId) {
      return true
    }
    if ((event.module === 'chat' || event.module === 'agent') && event.topicId && event.messageId) {
      return true
    }
    if ((event.module === 'knowledge' || event.module === 'websearch') && event.baseId) {
      return true
    }
    if (event.module === 'paintings') {
      return true
    }
    return false
  }, [])

  const openUsageEvent = useCallback(
    async (event: UsageEvent) => {
      if (event.refType === 'translate_history' && event.refId) {
        navigate(`/translate?historyId=${event.refId}`)
        return
      }

      if ((event.module === 'chat' || event.module === 'agent') && event.topicId && event.messageId) {
        const messages = await TopicManager.getTopicMessages(event.topicId)
        const message = messages.find((item) => item.id === event.messageId)
        if (message) {
          await locateToMessage(navigate, message)
        } else {
          window.toast.warning(t('usage.open.not_found'))
        }
        return
      }

      if ((event.module === 'knowledge' || event.module === 'websearch') && event.baseId) {
        navigate(`/knowledge?baseId=${event.baseId}`)
        return
      }

      if (event.module === 'paintings') {
        navigate(`/paintings/${event.providerId || defaultPaintingProvider}`)
      }
    },
    [defaultPaintingProvider, navigate, t]
  )

  return (
    <Container>
      <Navbar>
        <NavbarCenter>{t('usage.title')}</NavbarCenter>
      </Navbar>
      <ContentContainer>
        <FilterBar
          range={range}
          onRangeChange={setRange}
          bucket={bucket}
          onBucketChange={setBucket}
          moduleOptions={moduleOptions}
          categoryOptions={categoryOptions}
          providerOptions={providerOptions}
          modelOptions={modelOptions}
          selectedModules={selectedModules}
          selectedCategories={selectedCategories}
          selectedProviders={selectedProviders}
          selectedModels={selectedModels}
          onModulesChange={setSelectedModules}
          onCategoriesChange={setSelectedCategories}
          onProvidersChange={setSelectedProviders}
          onModelsChange={setSelectedModels}
          onReset={resetFilters}
        />
        <KPICards totals={totals} formatNumber={formatNumber} formatCurrencyMap={formatCurrencyMap} />
        <TrendChart
          data={trendData}
          pricingCurrency={pricingCurrency}
          providerCurrency={providerCurrency}
          formatNumber={formatNumber}
        />
        <TablesGrid>
          <StatsTable
            title={t('usage.table.modules')}
            rows={moduleRows}
            variant="module"
            formatNumber={formatNumber}
            formatCurrencyMap={formatCurrencyMap}
            onOpen={(row) => row.module && openModule(row.module)}
          />
          <StatsTable
            title={t('usage.table.models')}
            rows={modelRows}
            variant="model"
            formatNumber={formatNumber}
            formatCurrencyMap={formatCurrencyMap}
          />
        </TablesGrid>
        <UsageEventsTable
          events={recentEvents}
          formatNumber={formatNumber}
          isOpenable={isOpenable}
          onOpen={openUsageEvent}
        />
      </ContentContainer>
    </Container>
  )
}

const Container = styled.div`
  display: flex;
  flex-direction: column;
  height: calc(100vh - var(--navbar-height));
  background-color: var(--color-background);
  color: var(--color-text-primary);
`

const ContentContainer = styled(Scrollbar)`
  flex: 1;
  padding: 24px;
  display: flex;
  flex-direction: column;
  gap: 16px;
`

const TablesGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
  gap: 16px;
`

export default UsageStatsPage
