import { Button, Flex, RowFlex, Tooltip } from '@cherrystudio/ui'
import { loggerService } from '@logger'
import { LoadingIcon } from '@renderer/components/Icons'
import { TopView } from '@renderer/components/TopView'
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
import NewApiAddModelPopup from '@renderer/pages/settings/ProviderSettingsV2/ModelList/NewApiAddModelPopup'
import NewApiBatchAddModelPopup from '@renderer/pages/settings/ProviderSettingsV2/ModelList/NewApiBatchAddModelPopup'
import { getFancyProviderName, isNewApiProvider } from '@renderer/pages/settings/ProviderSettingsV2/utils/provider'
import type { Model } from '@shared/data/types/model'
import { parseUniqueModelId } from '@shared/data/types/model'
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
import { fetchResolvedProviderModels, toCreateModelDto } from './modelSync'
import { filterProviderSettingModelsByKeywords, isValidNewApiModel } from './utils'

const logger = loggerService.withContext('ManageModelsPopup')

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
  const { createModel, createModels, deleteModel } = useModelMutations()
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

  const loadModels = useCallback(
    async (prov: Provider) => {
      setLoadingModels(true)
      try {
        setListModels(await fetchResolvedProviderModels(providerId, prov))
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
        indicator={<LoadingIcon color="var(--color-muted-foreground)" style={{ opacity: loadingModels ? 1 : 0 }} />}>
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
  color: var(--color-foreground);
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
