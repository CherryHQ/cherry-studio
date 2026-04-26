import { Button, Input, Tabs, TabsList, TabsTrigger, Tooltip } from '@cherrystudio/ui'
import { loggerService } from '@logger'
import { LoadingIcon } from '@renderer/components/Icons'
import { useModelMutations, useModels } from '@renderer/hooks/useModels'
import { useProvider, useProviderRegistryModels } from '@renderer/hooks/useProviders'
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
import type { Model } from '@shared/data/types/model'
import { parseUniqueModelId } from '@shared/data/types/model'
import type { Provider } from '@shared/data/types/provider'
import { debounce, groupBy, isEmpty, uniqBy } from 'lodash'
import { ListMinus, ListPlus, RefreshCcw, Search } from 'lucide-react'
import { useCallback, useEffect, useMemo, useOptimistic, useRef, useState, useTransition } from 'react'
import { useTranslation } from 'react-i18next'

import ProviderSettingsDrawer from '../components/ProviderSettingsDrawer'
import { normalizeModelGroupName } from './grouping'
import ManageModelsList from './ManageModelsList'
import { fetchResolvedProviderModels, toCreateModelDto } from './modelSync'
import NewApiAddModelPopup from './NewApiAddModelPopup'
import NewApiBatchAddModelPopup from './NewApiBatchAddModelPopup'
import { filterProviderSettingModelsByKeywords, isValidNewApiModel } from './utils'

const logger = loggerService.withContext('ManageModelsDrawer')

interface ManageModelsDrawerProps {
  open: boolean
  providerId: string
  onClose: () => void
}

export default function ManageModelsDrawer({ open, providerId, onClose }: ManageModelsDrawerProps) {
  const { provider } = useProvider(providerId)
  const { models: existingModels } = useModels({ providerId })
  const { data: catalogModels = [] } = useProviderRegistryModels(providerId)
  const { createModel, createModels, deleteModel } = useModelMutations()
  const existingModelIds = useMemo(() => new Set<string>(existingModels.map((m) => m.id)), [existingModels])
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
  const searchInputRef = useRef<HTMLInputElement | null>(null)
  const { t } = useTranslation()

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

  const allModels = useMemo(
    () => uniqBy([...catalogModels, ...listModels, ...existingModels], 'id'),
    [catalogModels, existingModels, listModels]
  )

  const list = useMemo(
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

  const isLoading = loadingModels || isSearchPending || isFilterTypePending

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
    if (open && provider) {
      void loadModels(provider)
    }
  }, [loadModels, open, provider])

  useEffect(() => {
    if (!open) {
      return
    }

    const timer = window.setTimeout(() => {
      searchInputRef.current?.focus()
    }, 100)

    return () => window.clearTimeout(timer)
  }, [open])

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
          void NewApiAddModelPopup.show({
            title: t('settings.models.add.add_model'),
            provider,
            model
          })
        }
        return
      }

      await createModel(toCreateModelDto(providerId, model))
    },
    [createModel, provider, providerId, t]
  )

  const onRemoveModel = useCallback(
    async (model: Model) => {
      const { modelId } = parseUniqueModelId(model.id)
      await deleteModel(providerId, modelId)
    },
    [deleteModel, providerId]
  )

  const onRemoveAll = useCallback(() => {
    list
      .filter((model) => existingModelIds.has(model.id))
      .forEach((model) => {
        void onRemoveModel(model)
      })
  }, [existingModelIds, list, onRemoveModel])

  const onAddAll = useCallback(() => {
    const wouldAddModel = list.filter((model) => !existingModelIds.has(model.id))
    window.modal.confirm({
      title: t('settings.models.manage.add_listed.label'),
      content: t('settings.models.manage.add_listed.confirm'),
      centered: true,
      onOk: async () => {
        if (provider && isNewApiProvider(provider)) {
          const directAddModels = wouldAddModel.filter(isValidNewApiModel)
          const pendingEndpointModels = wouldAddModel.filter((model) => !isValidNewApiModel(model))

          if (directAddModels.length > 0) {
            await createModels(directAddModels.map((model) => toCreateModelDto(providerId, model, model.endpointTypes)))
          }

          if (pendingEndpointModels.length > 0) {
            void NewApiBatchAddModelPopup.show({
              title: t('settings.models.add.batch_add_models'),
              batchModels: pendingEndpointModels,
              provider
            })
          }
        } else {
          await createModels(wouldAddModel.map((model) => toCreateModelDto(providerId, model)))
        }
      }
    })
  }, [createModels, existingModelIds, list, provider, providerId, t])

  return (
    <ProviderSettingsDrawer
      open={open}
      onClose={onClose}
      title={provider ? `${getFancyProviderName(provider)} ${t('common.models')}` : t('common.models')}
      size="wide"
      bodyClassName="flex min-h-0 flex-col gap-4 px-5 py-4">
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-[15rem] flex-1">
            <Search
              size={14}
              className="-translate-y-1/2 pointer-events-none absolute top-1/2 left-3 text-muted-foreground/60"
            />
            <Input
              ref={searchInputRef}
              value={searchText}
              disabled={loadingModels}
              placeholder={t('settings.provider.search_placeholder')}
              className="pl-9"
              onChange={(event) => {
                const nextValue = event.target.value
                setSearchText(nextValue)
                debouncedSetFilterText(nextValue)
              }}
            />
          </div>
          <div className="flex items-center gap-2">
            <Tooltip
              content={
                list.length > 0 && list.every((model) => existingModelIds.has(model.id))
                  ? t('settings.models.manage.remove_listed')
                  : t('settings.models.manage.add_listed.label')
              }>
              <Button
                variant="outline"
                size="icon-sm"
                disabled={loadingModels || list.length === 0}
                onClick={() => {
                  const isAllFilteredInProvider =
                    list.length > 0 && list.every((model) => existingModelIds.has(model.id))
                  isAllFilteredInProvider ? onRemoveAll() : onAddAll()
                }}>
                {list.length > 0 && list.every((model) => existingModelIds.has(model.id)) ? (
                  <ListMinus size={16} />
                ) : (
                  <ListPlus size={16} />
                )}
              </Button>
            </Tooltip>
            <Tooltip content={t('settings.models.manage.refetch_list')}>
              <Button
                variant="outline"
                size="icon-sm"
                disabled={loadingModels || !provider}
                onClick={() => provider && void loadModels(provider)}>
                <RefreshCcw size={16} />
              </Button>
            </Tooltip>
          </div>
        </div>

        <Tabs
          value={optimisticFilterType}
          onValueChange={(value) => {
            setOptimisticFilterType(value)
            startFilterTypeTransition(() => {
              setActualFilterType(value)
            })
          }}
          variant="line">
          <TabsList className="flex h-auto w-full flex-wrap justify-start gap-1.5 bg-transparent p-0">
            {[
              { label: t('models.all'), key: 'all' },
              { label: t('models.type.reasoning'), key: 'reasoning' },
              { label: t('models.type.vision'), key: 'vision' },
              { label: t('models.type.websearch'), key: 'websearch' },
              { label: t('models.type.free'), key: 'free' },
              { label: t('models.type.embedding'), key: 'embedding' },
              { label: t('models.type.rerank'), key: 'rerank' },
              { label: t('models.type.function_calling'), key: 'function_calling' }
            ].map((item) => (
              <TabsTrigger
                key={item.key}
                value={item.key}
                className={cn(
                  'rounded-lg border border-border/60 px-3 py-1.5 font-medium text-[12px] text-foreground/70 after:hidden',
                  optimisticFilterType === item.key && 'border-primary/40 bg-primary/10 text-primary'
                )}>
                {item.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      </div>

      <div className="relative min-h-0 flex-1 overflow-hidden rounded-xl border border-border/60 bg-background">
        {isLoading ? (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-background/80">
            <LoadingIcon color="var(--color-muted-foreground)" />
          </div>
        ) : null}

        {isEmpty(list) ? (
          <div className="flex h-full min-h-52 items-center justify-center px-6 text-center text-[13px] text-muted-foreground/75">
            {t('settings.models.empty')}
          </div>
        ) : (
          <div className="h-full">
            <ManageModelsList
              modelGroups={modelGroups}
              provider={provider!}
              existingModelIds={existingModelIds}
              onAddModel={(model) => void onAddModel(model)}
              onRemoveModel={(model) => void onRemoveModel(model)}
            />
          </div>
        )}
      </div>
    </ProviderSettingsDrawer>
  )
}
