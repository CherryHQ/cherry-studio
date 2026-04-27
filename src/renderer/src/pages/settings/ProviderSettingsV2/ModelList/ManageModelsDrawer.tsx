import { Button } from '@cherrystudio/ui'
import { loggerService } from '@logger'
import { LoadingIcon } from '@renderer/components/Icons'
import { useModelMutations, useModels } from '@renderer/hooks/useModels'
import { useProvider } from '@renderer/hooks/useProviders'
import {
  groupQwenModels,
  isEmbeddingModel,
  isFreeModel,
  isFunctionCallingModel,
  isReasoningModel,
  isRerankModel,
  isVisionModel,
  isWebSearchModel
} from '@renderer/pages/settings/ProviderSettingsV2/config/models'
import { getFancyProviderName, isNewApiProvider } from '@renderer/pages/settings/ProviderSettingsV2/utils/provider'
import { cn } from '@renderer/utils'
import { getDefaultGroupName } from '@renderer/utils'
import type { EndpointType, Model } from '@shared/data/types/model'
import { ENDPOINT_TYPE, parseUniqueModelId } from '@shared/data/types/model'
import type { Provider } from '@shared/data/types/provider'
import { debounce, groupBy, isEmpty, uniqBy } from 'lodash'
import {
  ArrowDownWideNarrow,
  Brain,
  Check,
  Database,
  Eye,
  Gift,
  Globe,
  LayoutGrid,
  Plus,
  RefreshCw,
  Search,
  Wrench,
  X
} from 'lucide-react'
import type { ReactNode } from 'react'
import { useCallback, useEffect, useMemo, useOptimistic, useRef, useState, useTransition } from 'react'
import { useTranslation } from 'react-i18next'

import ProviderActions from '../components/ProviderActions'
import ProviderSettingsDrawer from '../components/ProviderSettingsDrawer'
import { normalizeModelGroupName } from './grouping'
import ManageModelsList from './ManageModelsList'
import { getModelApiId, splitModelIds } from './ModelDrawer/helpers'
import { fetchResolvedProviderModels, toCreateModelDto } from './modelSync'
import { filterProviderSettingModelsByKeywords } from './utils'

const logger = loggerService.withContext('ManageModelsDrawer')

interface ManageModelsDrawerProps {
  open: boolean
  providerId: string
  openWithInlineCustomAdd: boolean
  onConsumeOpenWithInlineCustomAdd: () => void
  onClose: () => void
}

export default function ManageModelsDrawer({
  open,
  providerId,
  openWithInlineCustomAdd,
  onConsumeOpenWithInlineCustomAdd,
  onClose
}: ManageModelsDrawerProps) {
  const { provider } = useProvider(providerId)
  const { models: existingModels, refetch: refetchExistingModels } = useModels({ providerId })
  const { createModel, deleteModel, updateModel } = useModelMutations()
  const existingModelIds = useMemo(() => new Set<string>(existingModels.map((m) => m.id)), [existingModels])
  const existingById = useMemo(() => new Map(existingModels.map((m) => [m.id, m] as const)), [existingModels])
  const [listModels, setListModels] = useState<Model[]>([])
  const [loadingModels, setLoadingModels] = useState(false)
  const [searchText, setSearchText] = useState('')
  const [filterSearchText, setFilterSearchText] = useState('')
  const [actualFilterType, setActualFilterType] = useState<string>('all')
  const [optimisticFilterType, setOptimisticFilterType] = useOptimistic(
    actualFilterType,
    (_current, next: string) => next
  )
  const [isSearchPending, startSearchTransition] = useTransition()
  const [isFilterTypePending, startFilterTypeTransition] = useTransition()
  const [isStatusPending, startStatusTransition] = useTransition()
  const [statusFilter, setStatusFilter] = useState<'all' | 'enabled' | 'disabled'>('all')
  const [optimisticStatusFilter, setOptimisticStatusFilter] = useOptimistic(
    statusFilter,
    (_c, next: 'all' | 'enabled' | 'disabled') => next
  )
  const [customAddExpanded, setCustomAddExpanded] = useState(false)
  const [customAddModelId, setCustomAddModelId] = useState('')
  const [customAddSubmitting, setCustomAddSubmitting] = useState(false)
  const searchInputRef = useRef<HTMLInputElement | null>(null)
  const customAddInputRef = useRef<HTMLInputElement | null>(null)
  const { t } = useTranslation()

  const manageCapabilityFilters = useMemo(
    () =>
      [
        { key: 'all', label: t('models.all'), Icon: LayoutGrid },
        { key: 'reasoning', label: t('models.type.reasoning'), Icon: Brain },
        { key: 'vision', label: t('models.type.vision'), Icon: Eye },
        { key: 'websearch', label: t('models.type.websearch'), Icon: Globe },
        { key: 'free', label: t('models.type.free'), Icon: Gift },
        { key: 'embedding', label: t('models.type.embedding'), Icon: Database },
        { key: 'rerank', label: t('models.type.rerank'), Icon: ArrowDownWideNarrow },
        { key: 'function_calling', label: t('models.type.function_calling'), Icon: Wrench }
      ] as const,
    [t]
  )

  const debouncedSetFilterText = useMemo(
    () =>
      debounce((value: string) => {
        startSearchTransition(() => {
          setFilterSearchText(value)
        })
      }, 300),
    []
  )

  useEffect(() => {
    return () => {
      debouncedSetFilterText.cancel()
    }
  }, [debouncedSetFilterText])

  const allModels = useMemo(() => uniqBy([...listModels, ...existingModels], 'id'), [existingModels, listModels])

  const capabilityFiltered = useMemo(
    () =>
      filterProviderSettingModelsByKeywords(filterSearchText, allModels).filter((model) => {
        switch (actualFilterType) {
          case 'reasoning':
            return isReasoningModel(model)
          case 'vision':
            return isVisionModel(model)
          case 'websearch':
            return isWebSearchModel(model)
          case 'free':
            return isFreeModel(model)
          case 'embedding':
            return isEmbeddingModel(model)
          case 'function_calling':
            return isFunctionCallingModel(model)
          case 'rerank':
            return isRerankModel(model)
          default:
            return true
        }
      }),
    [actualFilterType, allModels, filterSearchText]
  )

  const list = useMemo(() => {
    return capabilityFiltered.filter((model) => {
      const inProvider = existingModelIds.has(model.id)
      const enabled = inProvider ? (existingById.get(model.id)?.isEnabled ?? true) : false
      switch (statusFilter) {
        case 'enabled':
          return inProvider && enabled
        case 'disabled':
          return !inProvider || !enabled
        default:
          return true
      }
    })
  }, [capabilityFiltered, existingById, existingModelIds, statusFilter])

  const modelGroups: Record<string, Model[]> = useMemo(() => {
    const groupFn = (model: Model) => normalizeModelGroupName(model.group, provider?.id)
    if (provider?.id === 'dashscope') {
      const isQwen = (model: Model) => parseUniqueModelId(model.id).modelId.startsWith('qwen')
      const qwenModels = list.filter(isQwen)
      const nonQwenModels = list.filter((model) => !isQwen(model))
      return {
        ...groupBy(nonQwenModels, groupFn),
        ...groupQwenModels(qwenModels)
      }
    }

    return groupBy(list, groupFn)
  }, [list, provider?.id])

  const browseLoading = loadingModels || isSearchPending || isFilterTypePending || isStatusPending

  const loadModels = useCallback(
    async (currentProvider: Provider) => {
      setLoadingModels(true)
      try {
        setListModels(await fetchResolvedProviderModels(providerId, currentProvider))
      } catch (error) {
        logger.error(`Failed to load models for provider ${getFancyProviderName(currentProvider)}`, error as Error)
      } finally {
        setLoadingModels(false)
      }
    },
    [providerId]
  )

  useEffect(() => {
    if (!open || !provider) {
      return
    }
    void loadModels(provider)
  }, [loadModels, open, provider])

  useEffect(() => {
    if (!open) {
      setStatusFilter('all')
      setCustomAddExpanded(false)
      setCustomAddModelId('')
      setCustomAddSubmitting(false)
      return
    }

    if (openWithInlineCustomAdd) {
      return
    }

    const timer = window.setTimeout(() => {
      searchInputRef.current?.focus()
    }, 100)

    return () => window.clearTimeout(timer)
  }, [open, openWithInlineCustomAdd])

  useEffect(() => {
    if (open && openWithInlineCustomAdd) {
      setCustomAddExpanded(true)
      setCustomAddModelId('')
      onConsumeOpenWithInlineCustomAdd()
      window.setTimeout(() => {
        customAddInputRef.current?.focus()
      }, 0)
    }
  }, [open, openWithInlineCustomAdd, onConsumeOpenWithInlineCustomAdd])

  const cancelInlineCustomModel = useCallback(() => {
    setCustomAddExpanded(false)
    setCustomAddModelId('')
  }, [])

  const submitInlineCustomModel = useCallback(async () => {
    if (!provider || customAddSubmitting) {
      return
    }

    const raw = customAddModelId.trim().replaceAll('，', ',')
    if (!raw) {
      return
    }

    setCustomAddSubmitting(true)
    try {
      const useNewApiEndpoints = isNewApiProvider(provider)
      const defaultEndpoint = ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS as EndpointType

      const addOne = async (singleId: string) => {
        if (existingModels.some((m) => m.id.endsWith(`::${singleId}`))) {
          window.toast.error(t('error.model.exists'))
          return false
        }

        await createModel({
          providerId,
          modelId: singleId,
          name: singleId.toUpperCase(),
          group: getDefaultGroupName(singleId, provider.id),
          endpointTypes: useNewApiEndpoints ? [defaultEndpoint] : undefined
        })

        return true
      }

      if (raw.includes(',')) {
        for (const id of splitModelIds(raw)) {
          if (!(await addOne(id))) {
            return
          }
        }
      } else {
        if (!(await addOne(raw))) {
          return
        }
      }

      refetchExistingModels()
      await loadModels(provider)
      setCustomAddExpanded(false)
      setCustomAddModelId('')
    } catch (error) {
      logger.error('Failed to add custom model from inline form', { providerId, error })
    } finally {
      setCustomAddSubmitting(false)
    }
  }, [
    createModel,
    customAddModelId,
    customAddSubmitting,
    existingModels,
    loadModels,
    provider,
    providerId,
    refetchExistingModels,
    t
  ])

  const onAddModel = useCallback(
    async (model: Model) => {
      if (isEmpty(model.name) || !provider) {
        return
      }

      if (isNewApiProvider(provider)) {
        const endpointTypes = model.endpointTypes
        if (endpointTypes && endpointTypes.length > 0) {
          await createModel(toCreateModelDto(providerId, model, endpointTypes))
        } else {
          setCustomAddModelId(getModelApiId(model))
          setCustomAddExpanded(true)
          window.setTimeout(() => {
            customAddInputRef.current?.focus()
          }, 0)
        }
        return
      }

      await createModel(toCreateModelDto(providerId, model))
    },
    [createModel, provider, providerId]
  )

  const onRemoveModel = useCallback(
    async (model: Model) => {
      const { modelId } = parseUniqueModelId(model.id)
      await deleteModel(providerId, modelId)
    },
    [deleteModel, providerId]
  )

  const onEnableAllInProvider = useCallback(async () => {
    if (existingModels.length === 0) {
      return
    }
    try {
      await Promise.all(
        existingModels.map((m) => {
          const { modelId } = parseUniqueModelId(m.id)
          return updateModel(providerId, modelId, { isEnabled: true })
        })
      )
      refetchExistingModels()
    } catch (error) {
      logger.error('Failed to enable all models for provider', { providerId, error })
    }
  }, [existingModels, providerId, refetchExistingModels, updateModel])

  const onDisableAllInProvider = useCallback(async () => {
    if (existingModels.length === 0) {
      return
    }
    try {
      await Promise.all(
        existingModels.map((m) => {
          const { modelId } = parseUniqueModelId(m.id)
          return updateModel(providerId, modelId, { isEnabled: false })
        })
      )
      refetchExistingModels()
    } catch (error) {
      logger.error('Failed to disable all models for provider', { providerId, error })
    }
  }, [existingModels, providerId, refetchExistingModels, updateModel])

  const onToggleModelEnabled = useCallback(
    async (model: Model, enabled: boolean) => {
      const { modelId } = parseUniqueModelId(model.id)
      await updateModel(providerId, modelId, { isEnabled: enabled })
      refetchExistingModels()
    },
    [providerId, refetchExistingModels, updateModel]
  )

  const enabledInProviderCount = useMemo(() => existingModels.filter((m) => m.isEnabled).length, [existingModels])
  const allEnabledInProvider = existingModels.length > 0 && existingModels.every((m) => m.isEnabled)
  const allDisabledInProvider = existingModels.length > 0 && existingModels.every((m) => !m.isEnabled)

  const panelTitle: ReactNode = useMemo(() => {
    if (!provider) {
      return t('settings.models.list_title')
    }

    return (
      <div className="flex w-full min-w-0 items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <span className="truncate font-semibold text-foreground text-sm">
            {t('settings.models.manage.drawer_title')}
          </span>
          <span className="shrink-0 rounded-full bg-muted/50 px-1.5 py-[1px] text-muted-foreground/60 text-xs tabular-nums">
            {enabledInProviderCount} / {existingModels.length}
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={loadingModels || existingModels.length === 0 || allEnabledInProvider}
            className="h-auto min-h-0 gap-1 rounded-[var(--radius-control)] px-1.5 py-[2px] text-muted-foreground/60 text-xs hover:bg-accent hover:text-primary has-[>svg]:px-1.5"
            onClick={() => void onEnableAllInProvider()}>
            {t('settings.models.bulk_enable')}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={loadingModels || existingModels.length === 0 || allDisabledInProvider}
            className="h-auto min-h-0 gap-1 rounded-[var(--radius-control)] px-1.5 py-[2px] text-muted-foreground/60 text-xs hover:bg-accent hover:text-destructive has-[>svg]:px-1.5"
            onClick={() => void onDisableAllInProvider()}>
            {t('settings.models.bulk_disable')}
          </Button>
        </div>
      </div>
    )
  }, [
    allDisabledInProvider,
    allEnabledInProvider,
    enabledInProviderCount,
    existingModels.length,
    loadingModels,
    onDisableAllInProvider,
    onEnableAllInProvider,
    provider,
    t
  ])

  const panelFooter: ReactNode = (
    <ProviderActions className="flex items-center gap-2">
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="h-auto min-h-0 gap-1.5 px-2.5 py-1.5 text-muted-foreground text-xs hover:bg-accent hover:text-foreground"
        disabled={loadingModels || !provider}
        onClick={() => {
          if (provider) {
            void loadModels(provider)
          }
        }}>
        <RefreshCw size={10} aria-hidden />
        {t('settings.models.manage.reload_catalog')}
      </Button>
      <div className="min-w-0 flex-1" />
      <Button type="button" size="sm" className="h-auto min-h-0 px-3 py-1 text-xs" onClick={onClose}>
        {t('settings.models.manage.footer_done')}
      </Button>
    </ProviderActions>
  )

  return (
    <ProviderSettingsDrawer
      open={open}
      onClose={onClose}
      title={panelTitle}
      footer={panelFooter}
      size="manage"
      bodyClassName="min-h-0 flex-1 flex-col overflow-hidden !gap-0 !py-0">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <div className="shrink-0 pt-3 pb-1.5">
          <div className="flex items-center gap-2 rounded-lg border border-[color:var(--section-border)] bg-muted/50 px-2.5 py-[5px]">
            <Search className="size-2.5 shrink-0 text-muted-foreground/40" aria-hidden />
            <input
              ref={searchInputRef}
              value={searchText}
              disabled={loadingModels}
              placeholder={t('settings.models.manage.search_models_placeholder')}
              className="h-auto min-w-0 flex-1 border-none bg-transparent p-0 text-foreground text-sm shadow-none outline-none ring-0 placeholder:text-muted-foreground/60 focus-visible:ring-0"
              onChange={(event) => {
                const nextValue = event.target.value
                setSearchText(nextValue)
                debouncedSetFilterText(nextValue)
              }}
            />
          </div>
        </div>

        <div className="flex shrink-0 flex-col gap-1.5 pb-2">
          <div className="flex flex-wrap items-center gap-1">
            {(
              [
                { key: 'all' as const, label: t('settings.models.manage.status_all') },
                { key: 'enabled' as const, label: t('settings.models.manage.status_enabled') },
                { key: 'disabled' as const, label: t('settings.models.manage.status_disabled') }
              ] as const
            ).map((item) => (
              <Button
                key={item.key}
                type="button"
                variant="ghost"
                size="sm"
                className={cn(
                  'h-auto min-h-0 gap-1 rounded-full px-2 py-[2px] font-medium text-xs',
                  optimisticStatusFilter === item.key
                    ? 'bg-accent/50 text-background'
                    : 'text-muted-foreground/60 hover:bg-accent/50 hover:text-foreground'
                )}
                onClick={() => {
                  setOptimisticStatusFilter(item.key)
                  startStatusTransition(() => {
                    setStatusFilter(item.key)
                  })
                }}>
                {item.label}
              </Button>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-1">
            {manageCapabilityFilters.map(({ key, label, Icon }) => (
              <Button
                key={key}
                type="button"
                variant="ghost"
                size="sm"
                className={cn(
                  'h-auto min-h-0 min-w-0 items-center gap-[3px] rounded-full px-1.5 py-[2px] font-medium text-xs',
                  optimisticFilterType === key
                    ? 'bg-accent/50 text-background'
                    : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground'
                )}
                onClick={() => {
                  setOptimisticFilterType(key)
                  startFilterTypeTransition(() => {
                    setActualFilterType(key)
                  })
                }}>
                <Icon className="size-2 min-[380px]:size-2.5" aria-hidden />
                {label}
              </Button>
            ))}
          </div>
        </div>

        <div className="relative flex min-h-0 min-w-0 flex-1 flex-col">
          {browseLoading ? (
            <div className="absolute inset-0 z-10 flex items-center justify-center bg-background/80">
              <LoadingIcon color="var(--color-muted-foreground)" />
            </div>
          ) : null}

          <div className="flex min-h-0 min-w-0 flex-1 flex-col">
            <div className="min-h-0 flex-1 overflow-y-auto py-1">
              {isEmpty(list) ? (
                <div className="flex min-h-40 flex-col items-center justify-center px-6 py-8 text-center text-[13px] text-muted-foreground/75">
                  {t('settings.models.empty')}
                </div>
              ) : (
                <ManageModelsList
                  modelGroups={modelGroups}
                  provider={provider!}
                  existingModelIds={existingModelIds}
                  existingById={existingById}
                  onAddModel={(model) => void onAddModel(model)}
                  onRemoveModel={(model) => void onRemoveModel(model)}
                  onToggleModelEnabled={(model, enabled) => void onToggleModelEnabled(model, enabled)}
                />
              )}
            </div>

            <div className="mt-1 shrink-0 px-1 pt-2">
              {customAddExpanded && provider ? (
                <div className="flex items-center gap-1.5 rounded-xl border border-cherry-primary/20 bg-cherry-active-bg px-2.5 py-2">
                  <input
                    ref={customAddInputRef}
                    value={customAddModelId}
                    disabled={customAddSubmitting || loadingModels}
                    placeholder={t('settings.models.add.model_id.placeholder')}
                    spellCheck={false}
                    maxLength={200}
                    aria-label={t('settings.models.add.model_id.label')}
                    className="min-w-0 flex-1 border-none bg-transparent p-0 text-foreground text-xs shadow-none outline-none ring-0 placeholder:text-muted-foreground/60 focus-visible:ring-0"
                    onChange={(event) => setCustomAddModelId(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') {
                        event.preventDefault()
                        void submitInlineCustomModel()
                      }
                      if (event.key === 'Escape') {
                        event.preventDefault()
                        cancelInlineCustomModel()
                      }
                    }}
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    disabled={customAddSubmitting || loadingModels}
                    className="h-6 w-6 shrink-0 p-0 text-muted-foreground hover:text-foreground"
                    aria-label={t('common.confirm')}
                    onClick={() => void submitInlineCustomModel()}>
                    <Check className="size-3.5" aria-hidden />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    disabled={customAddSubmitting}
                    className="h-6 w-6 shrink-0 p-0 text-muted-foreground hover:text-foreground"
                    aria-label={t('common.cancel')}
                    onClick={cancelInlineCustomModel}>
                    <X className="size-3.5" aria-hidden />
                  </Button>
                </div>
              ) : (
                <Button
                  type="button"
                  variant="ghost"
                  disabled={loadingModels || !provider}
                  onClick={() => {
                    setCustomAddExpanded(true)
                    setCustomAddModelId('')
                    window.setTimeout(() => {
                      customAddInputRef.current?.focus()
                    }, 0)
                  }}
                  className="h-auto w-full justify-center gap-1.5 rounded-xl border border-[color:var(--section-border)] border-dashed py-2 text-muted-foreground/60 text-xs shadow-none hover:border-[color:var(--color-border)] hover:text-foreground">
                  <Plus size={10} />
                  {t('settings.models.manage.add_custom_model')}
                </Button>
              )}
            </div>
          </div>
        </div>
      </div>
    </ProviderSettingsDrawer>
  )
}
