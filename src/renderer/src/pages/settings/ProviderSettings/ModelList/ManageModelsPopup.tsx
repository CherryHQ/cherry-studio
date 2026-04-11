import { Button, Flex, RowFlex, Tooltip } from '@cherrystudio/ui'
import { dataApiService } from '@data/DataApiService'
import { useModelMutations, useModels } from '@data/hooks/useModels'
import { useProvider, useProviderRegistryModels } from '@data/hooks/useProviders'
import { loggerService } from '@logger'
import { LoadingIcon } from '@renderer/components/Icons'
import { TopView } from '@renderer/components/TopView'
import {
  groupQwenModels,
  isEmbeddingModel,
  isFreeModel,
  isFunctionCallingModel,
  isReasoningModel,
  isRerankModel,
  isVisionModel,
  isWebSearchModel
} from '@renderer/config/models/v2'
import NewApiAddModelPopup from '@renderer/pages/settings/ProviderSettings/ModelList/NewApiAddModelPopup'
import NewApiBatchAddModelPopup from '@renderer/pages/settings/ProviderSettings/ModelList/NewApiBatchAddModelPopup'
import { fetchModels } from '@renderer/services/ApiService'
import type { Model as LegacyModel, ModelCapability as LegacyModelCapability } from '@renderer/types'
import { filterModelsByKeywords } from '@renderer/utils'
import { getFancyProviderName, isNewApiProvider } from '@renderer/utils/provider.v2'
import { toV1ProviderShim } from '@renderer/utils/v1ProviderShim'
import type { CreateModelDto } from '@shared/data/api/schemas/models'
import {
  createUniqueModelId,
  ENDPOINT_TYPE,
  type EndpointType as RuntimeEndpointType,
  type Model,
  MODEL_CAPABILITY,
  type ModelCapability as RuntimeModelCapability,
  parseUniqueModelId
} from '@shared/data/types/model'
import type { Provider } from '@shared/data/types/provider'
import { Empty, Modal, Spin, Tabs } from 'antd'
import Input from 'antd/es/input/Input'
import { groupBy, isEmpty, uniqBy } from 'lodash'
import { debounce } from 'lodash'
import { ListMinus, ListPlus, RefreshCcw, Search } from 'lucide-react'
import { useCallback, useEffect, useMemo, useOptimistic, useRef, useState, useTransition } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

import { normalizeModelGroupName } from './grouping'
import ManageModelsList from './ManageModelsList'
import { isValidNewApiModel } from './utils'

const logger = loggerService.withContext('ManageModelsPopup')

const LEGACY_CAPABILITY_TO_V2: Record<LegacyModelCapability['type'], RuntimeModelCapability | undefined> = {
  text: undefined,
  vision: MODEL_CAPABILITY.IMAGE_RECOGNITION,
  embedding: MODEL_CAPABILITY.EMBEDDING,
  reasoning: MODEL_CAPABILITY.REASONING,
  function_calling: MODEL_CAPABILITY.FUNCTION_CALL,
  web_search: MODEL_CAPABILITY.WEB_SEARCH,
  rerank: MODEL_CAPABILITY.RERANK
}

const LEGACY_ENDPOINT_TO_V2: Record<string, RuntimeEndpointType> = {
  openai: ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS,
  'openai-response': ENDPOINT_TYPE.OPENAI_RESPONSES,
  anthropic: ENDPOINT_TYPE.ANTHROPIC_MESSAGES,
  gemini: ENDPOINT_TYPE.GOOGLE_GENERATE_CONTENT,
  'image-generation': ENDPOINT_TYPE.OPENAI_IMAGE_GENERATION,
  'jina-rerank': ENDPOINT_TYPE.JINA_RERANK
}

function toCreateModelDto(providerId: string, model: Model, endpointTypes?: RuntimeEndpointType[]): CreateModelDto {
  const modelId = model.apiModelId ?? parseUniqueModelId(model.id).modelId

  return {
    providerId,
    modelId,
    name: model.name,
    group: model.group,
    ...(endpointTypes ? { endpointTypes } : {})
  }
}

function normalizeFetchedModel(providerId: string, model: LegacyModel): Model {
  const capabilities =
    model.capabilities
      ?.map((capability) => LEGACY_CAPABILITY_TO_V2[capability.type])
      .filter((capability): capability is RuntimeModelCapability => capability !== undefined) ?? []

  const endpointTypes = [
    ...(model.supported_endpoint_types
      ?.map((endpointType) => LEGACY_ENDPOINT_TO_V2[endpointType])
      .filter((endpointType): endpointType is RuntimeEndpointType => endpointType !== undefined) ?? []),
    ...(model.endpoint_type && LEGACY_ENDPOINT_TO_V2[model.endpoint_type]
      ? [LEGACY_ENDPOINT_TO_V2[model.endpoint_type]]
      : [])
  ]

  return {
    id: createUniqueModelId(providerId, model.id),
    providerId,
    apiModelId: model.id,
    name: model.name,
    description: model.description,
    group: model.group,
    capabilities,
    endpointTypes: endpointTypes.length > 0 ? endpointTypes : undefined,
    supportsStreaming: model.supported_text_delta ?? true,
    isEnabled: true,
    isHidden: false
  }
}

interface ShowParams {
  providerId: string
}

interface Props extends ShowParams {
  resolve: (data: any) => void
}

const PopupContainer: React.FC<Props> = ({ providerId, resolve }) => {
  const [open, setOpen] = useState(true)
  const { provider } = useProvider(providerId)
  const { models: existingModels } = useModels({ providerId })
  const { data: catalogModels = [] } = useProviderRegistryModels(providerId)
  const { createModel, createModelsBatch, deleteModel } = useModelMutations()
  const existingModelIds = useMemo(() => new Set<string>(existingModels.map((m) => m.id)), [existingModels])
  const [listModels, setListModels] = useState<Model[]>([])
  const [loadingModels, setLoadingModels] = useState(false)
  const [searchText, setSearchText] = useState('')
  const [filterSearchText, setFilterSearchText] = useState('')
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
  const [actualFilterType, setActualFilterType] = useState<string>('all')
  const [optimisticFilterType, setOptimisticFilterTypeFn] = useOptimistic(
    actualFilterType,
    (_currentFilterType, newFilterType: string) => newFilterType
  )
  const [isSearchPending, startSearchTransition] = useTransition()
  const [isFilterTypePending, startFilterTypeTransition] = useTransition()
  const { t, i18n } = useTranslation()
  const searchInputRef = useRef<any>(null)

  // v2 three-way merge: catalog + remote-fetched + existing DB models
  const allModels = useMemo(
    () => uniqBy([...catalogModels, ...listModels, ...existingModels], 'id'),
    [catalogModels, listModels, existingModels]
  )

  const isLoading = useMemo(
    () => loadingModels || isFilterTypePending || isSearchPending,
    [loadingModels, isFilterTypePending, isSearchPending]
  )

  const list = useMemo(
    () =>
      filterModelsByKeywords(filterSearchText, allModels).filter((model) => {
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
    [filterSearchText, actualFilterType, allModels]
  )

  const modelGroups: Record<string, Model[]> = useMemo(() => {
    const groupFn = (m: Model) => normalizeModelGroupName(m.group, provider?.id)
    if (provider?.id === 'dashscope') {
      const isQwen = (m: Model) => parseUniqueModelId(m.id).modelId.startsWith('qwen')
      const qwenModels = list.filter(isQwen)
      const nonQwenModels = list.filter((m) => !isQwen(m))
      return {
        ...groupBy(nonQwenModels, groupFn),
        ...groupQwenModels(qwenModels)
      }
    }
    return groupBy(list, groupFn)
  }, [list, provider?.id])

  const onOk = useCallback(() => setOpen(false), [])

  const onCancel = useCallback(() => setOpen(false), [])

  const onClose = useCallback(() => resolve({}), [resolve])

  const onAddModel = useCallback(
    async (model: Model) => {
      if (!isEmpty(model.name) && provider) {
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
        } else {
          await createModel(toCreateModelDto(providerId, model))
        }
      }
    },
    [provider, providerId, createModel, t]
  )

  const onRemoveModel = useCallback(
    async (model: Model) => {
      const { modelId } = parseUniqueModelId(model.id)
      await deleteModel(providerId, modelId)
    },
    [providerId, deleteModel]
  )

  const onRemoveAll = useCallback(() => {
    list.filter((model) => existingModelIds.has(model.id)).forEach((m) => onRemoveModel(m))
  }, [list, onRemoveModel, existingModelIds])

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
            await createModelsBatch(
              directAddModels.map((model) => toCreateModelDto(providerId, model, model.endpointTypes))
            )
          }

          if (pendingEndpointModels.length > 0) {
            void NewApiBatchAddModelPopup.show({
              title: t('settings.models.add.batch_add_models'),
              batchModels: pendingEndpointModels,
              provider
            })
          }
        } else {
          await createModelsBatch(wouldAddModel.map((model) => toCreateModelDto(providerId, model)))
        }
      }
    })
  }, [createModelsBatch, existingModelIds, list, provider, providerId, t])

  const loadModels = useCallback(
    async (prov: Provider) => {
      setLoadingModels(true)
      try {
        let apiKey = ''
        try {
          const keyData = await dataApiService.get(`/providers/${providerId}/rotated-key` as const)
          apiKey = (keyData as any)?.apiKey ?? ''
        } catch {
          // Provider may have no keys configured
        }
        const v1Provider = toV1ProviderShim(prov, { apiKey })
        const fetched = await fetchModels(v1Provider)
        const filteredModels = fetched.filter((model) => !isEmpty(model.name))
        try {
          const resolved = await dataApiService.post(`/providers/${providerId}/registry-models` as const, {
            body: {
              models: filteredModels.map((m) => ({
                modelId: m.id,
                name: m.name,
                group: m.group,
                description: m.description
              }))
            }
          })
          // ── Enrich: fetched models as primary, registry as supplement ──
          //
          // The fetched list from the provider's API is the source of truth for
          // model identity (ID, name, group, endpointTypes, count). The registry
          // POST (`/registry-models`) only supplements catalog metadata such as
          // capabilities, pricing, contextWindow, description, etc.
          //
          // We iterate over fetched models (not resolved), convert each to v2 via
          // normalizeFetchedModel, then overlay any richer fields the registry
          // provided. This guarantees no models are lost to registry normalization
          // (e.g. "agent/deepseek-v3.2" and "agent/deepseek-v3.2(free)" both
          // resolving to the same preset "deepseek-v3-2").
          //
          // Registry lookup: the registry normalizes IDs during resolution
          // (e.g. "agent/deepseek-v3.2" → "deepseek-v3-2"), so we index resolved
          // models under their apiModelId for O(1) lookup from the fetched side.
          const resolvedMap = new Map<string, Model>()
          for (const model of resolved as Model[]) {
            const key = model.apiModelId ?? parseUniqueModelId(model.id).modelId
            if (!resolvedMap.has(key)) {
              resolvedMap.set(key, model)
            }
          }

          // Fields to supplement from registry when available
          const REGISTRY_FIELDS = [
            'capabilities',
            'inputModalities',
            'outputModalities',
            'contextWindow',
            'maxOutputTokens',
            'maxInputTokens',
            'reasoning',
            'pricing',
            'description',
            'family',
            'ownedBy'
          ] as const

          const enriched = filteredModels.map((fetched) => {
            // Start from the fetched model converted to v2 (preserves ID, group, endpointTypes)
            const base = normalizeFetchedModel(providerId, fetched)

            // Try to find a matching registry model by normalized ID variants
            const bare = fetched.id.includes('/') ? fetched.id.substring(fetched.id.lastIndexOf('/') + 1) : fetched.id
            const dashed = bare.replace(/\./g, '-')
            const registry = resolvedMap.get(fetched.id) ?? resolvedMap.get(bare) ?? resolvedMap.get(dashed)
            if (!registry) return base

            // Overlay registry catalog fields onto the fetched base
            const merged = { ...base }
            for (const field of REGISTRY_FIELDS) {
              const val = registry[field]
              if (val !== undefined && val !== null && !(Array.isArray(val) && val.length === 0)) {
                ;(merged as Record<string, unknown>)[field] = val
              }
            }
            return merged
          })
          setListModels(enriched)
        } catch {
          setListModels(filteredModels.map((model) => normalizeFetchedModel(providerId, model)))
        }
      } catch (error) {
        logger.error(`Failed to load models for provider ${getFancyProviderName(prov)}`, error as Error)
      } finally {
        setLoadingModels(false)
      }
    },
    [providerId]
  )

  useEffect(() => {
    if (provider) void loadModels(provider)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [provider?.id])

  useEffect(() => {
    if (open && searchInputRef.current) {
      const timer = setTimeout(() => {
        searchInputRef.current?.focus()
      }, 350)

      return () => {
        clearTimeout(timer)
      }
    }
    return
  }, [open])

  const ModalHeader = () => {
    return (
      <Flex>
        <ModelHeaderTitle>
          {provider ? getFancyProviderName(provider) : ''}
          {i18n.language.startsWith('zh') ? '' : ' '}
          {t('common.models')}
        </ModelHeaderTitle>
      </Flex>
    )
  }

  const renderTopTools = useCallback(() => {
    const isAllFilteredInProvider = list.length > 0 && list.every((model) => existingModelIds.has(model.id))

    return (
      <RowFlex className="gap-2">
        <Tooltip
          content={
            isAllFilteredInProvider
              ? t('settings.models.manage.remove_listed')
              : t('settings.models.manage.add_listed.label')
          }>
          <Button
            variant="ghost"
            size="icon-lg"
            onClick={() => {
              isAllFilteredInProvider ? onRemoveAll() : onAddAll()
            }}
            disabled={loadingModels || list.length === 0}>
            {isAllFilteredInProvider ? <ListMinus size={18} /> : <ListPlus size={18} />}
          </Button>
        </Tooltip>
        <Tooltip content={t('settings.models.manage.refetch_list')}>
          <Button
            variant="ghost"
            size="icon-lg"
            onClick={() => provider && loadModels(provider)}
            disabled={loadingModels}>
            <RefreshCcw size={16} />
          </Button>
        </Tooltip>
      </RowFlex>
    )
  }, [list, t, loadingModels, provider, existingModelIds, onRemoveAll, onAddAll, loadModels])

  return (
    <Modal
      title={<ModalHeader />}
      open={open}
      onOk={onOk}
      onCancel={onCancel}
      afterClose={onClose}
      footer={null}
      width="800px"
      transitionName="animation-move-down"
      styles={{
        body: {
          overflowY: 'hidden'
        }
      }}
      centered>
      <SearchContainer>
        <TopToolsWrapper>
          <Input
            prefix={<Search size={16} style={{ marginRight: 4 }} />}
            size="large"
            ref={searchInputRef}
            placeholder={t('settings.provider.search_placeholder')}
            allowClear
            value={searchText}
            onChange={(e) => {
              const newSearchValue = e.target.value
              setSearchText(newSearchValue) // Update input field immediately
              debouncedSetFilterText(newSearchValue)
            }}
            disabled={loadingModels}
          />
          {renderTopTools()}
        </TopToolsWrapper>
        <Tabs
          size={i18n.language.startsWith('zh') ? 'middle' : 'small'}
          defaultActiveKey="all"
          activeKey={optimisticFilterType}
          items={[
            { label: t('models.all'), key: 'all' },
            { label: t('models.type.reasoning'), key: 'reasoning' },
            { label: t('models.type.vision'), key: 'vision' },
            { label: t('models.type.websearch'), key: 'websearch' },
            { label: t('models.type.free'), key: 'free' },
            { label: t('models.type.embedding'), key: 'embedding' },
            { label: t('models.type.rerank'), key: 'rerank' },
            { label: t('models.type.function_calling'), key: 'function_calling' }
          ]}
          onChange={(key) => {
            setOptimisticFilterTypeFn(key)
            startFilterTypeTransition(() => {
              setActualFilterType(key)
            })
          }}
        />
      </SearchContainer>
      <Spin
        spinning={isLoading}
        indicator={<LoadingIcon color="var(--color-text-2)" style={{ opacity: loadingModels ? 1 : 0 }} />}>
        <ListContainer>
          {loadingModels || isEmpty(list) ? (
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description={t('settings.models.empty')}
              style={{
                visibility: loadingModels ? 'hidden' : 'visible',
                display: 'flex',
                justifyContent: 'center',
                alignItems: 'center',
                height: '100%',
                margin: '0'
              }}
            />
          ) : (
            <ManageModelsList
              modelGroups={modelGroups}
              provider={provider!}
              existingModelIds={existingModelIds}
              onAddModel={onAddModel}
              onRemoveModel={onRemoveModel}
            />
          )}
        </ListContainer>
      </Spin>
    </Modal>
  )
}

const SearchContainer = styled.div`
  display: flex;
  flex-direction: column;
  gap: 5px;

  .ant-radio-group {
    display: flex;
    flex-wrap: wrap;
  }
`

const TopToolsWrapper = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 10px;
  margin-bottom: 0;
`

const ListContainer = styled.div`
  height: calc(90vh - 300px);
`

const ModelHeaderTitle = styled.div`
  color: var(--color-text);
  font-size: 18px;
  font-weight: 600;
  margin-right: 10px;
`

const TopViewKey = 'ManageModelsPopup'

export default class ManageModelsPopup {
  static topviewId = 0
  static hide() {
    TopView.hide(TopViewKey)
  }
  static show(props: ShowParams) {
    return new Promise<any>((resolve) => {
      TopView.show(
        <PopupContainer
          {...props}
          resolve={(v) => {
            resolve(v)
            this.hide()
          }}
        />,
        TopViewKey
      )
    })
  }
}
