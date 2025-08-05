import { loggerService } from '@logger'
import { LoadingIcon } from '@renderer/components/Icons'
import { TopView } from '@renderer/components/TopView'
import {
  groupQwenModels,
  isEmbeddingModel,
  isFunctionCallingModel,
  isNotSupportedTextDelta,
  isReasoningModel,
  isRerankModel,
  isVisionModel,
  isWebSearchModel,
  SYSTEM_MODELS
} from '@renderer/config/models'
import { useProvider } from '@renderer/hooks/useProvider'
import NewApiAddModelPopup from '@renderer/pages/settings/ProviderSettings/ModelList/NewApiAddModelPopup'
import NewApiBatchAddModelPopup from '@renderer/pages/settings/ProviderSettings/ModelList/NewApiBatchAddModelPopup'
import { fetchModels } from '@renderer/services/ApiService'
import { Model, Provider } from '@renderer/types'
import { filterModelsByKeywords, getDefaultGroupName, getFancyProviderName, isFreeModel } from '@renderer/utils'
import { Button, Empty, Flex, Modal, Spin, Tabs, Tooltip } from 'antd'
import Input from 'antd/es/input/Input'
import { groupBy, isEmpty, uniqBy } from 'lodash'
import { debounce } from 'lodash'
import { ListMinus, ListPlus, RefreshCcw, Search } from 'lucide-react'
import { useCallback, useEffect, useMemo, useOptimistic, useRef, useState, useTransition } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

import { HStack } from '../../../../components/Layout'
import ManageModelsList from './ManageModelsList'
import { isModelInProvider, isValidNewApiModel } from './utils'

const logger = loggerService.withContext('ManageModelsPopup')

interface ShowParams {
  providerId: string
}

interface Props extends ShowParams {
  resolve: (data: any) => void
}

const PopupContainer: React.FC<Props> = ({ providerId, resolve }) => {
  const [open, setOpen] = useState(true)
  const { provider, models, addModel, removeModel } = useProvider(providerId)
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

  const systemModels = SYSTEM_MODELS[provider.id] || []
  const allModels = uniqBy([...systemModels, ...listModels, ...models], 'id')

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

  const modelGroups = useMemo(
    () =>
      provider.id === 'dashscope'
        ? {
            ...groupBy(
              list.filter((model) => !model.id.startsWith('qwen')),
              'group'
            ),
            ...groupQwenModels(list.filter((model) => model.id.startsWith('qwen')))
          }
        : groupBy(list, 'group'),
    [list, provider.id]
  )

  const onOk = useCallback(() => setOpen(false), [])

  const onCancel = useCallback(() => setOpen(false), [])

  const onClose = useCallback(() => resolve({}), [resolve])

  const onAddModel = useCallback(
    (model: Model) => {
      if (!isEmpty(model.name)) {
        if (provider.id === 'new-api') {
          if (model.supported_endpoint_types && model.supported_endpoint_types.length > 0) {
            addModel({
              ...model,
              endpoint_type: model.supported_endpoint_types[0],
              supported_text_delta: !isNotSupportedTextDelta(model)
            })
          } else {
            NewApiAddModelPopup.show({ title: t('settings.models.add.add_model'), provider, model })
          }
        } else {
          addModel({ ...model, supported_text_delta: !isNotSupportedTextDelta(model) })
        }
      }
    },
    [addModel, provider, t]
  )

  const onRemoveModel = useCallback((model: Model) => removeModel(model), [removeModel])

  const onRemoveAll = useCallback(() => {
    list.filter((model) => isModelInProvider(provider, model.id)).forEach(onRemoveModel)
  }, [list, onRemoveModel, provider])

  const onAddAll = useCallback(() => {
    const wouldAddModel = list.filter((model) => !isModelInProvider(provider, model.id))
    window.modal.confirm({
      title: t('settings.models.manage.add_listed.label'),
      content: t('settings.models.manage.add_listed.confirm'),
      centered: true,
      onOk: () => {
        if (provider.id === 'new-api') {
          if (models.every(isValidNewApiModel)) {
            wouldAddModel.forEach(onAddModel)
          } else {
            NewApiBatchAddModelPopup.show({
              title: t('settings.models.add.batch_add_models'),
              batchModels: wouldAddModel,
              provider
            })
          }
        } else {
          wouldAddModel.forEach(onAddModel)
        }
      }
    })
  }, [list, models, onAddModel, provider, t])

  const loadModels = useCallback(async (provider: Provider) => {
    setLoadingModels(true)
    try {
      const models = await fetchModels(provider)
      const filteredModels = models
        .map((model) => ({
          // @ts-ignore modelId
          id: model?.id || model?.name,
          // @ts-ignore name
          name: model?.display_name || model?.displayName || model?.name || model?.id,
          provider: provider.id,
          // @ts-ignore group
          group: getDefaultGroupName(model?.id || model?.name, provider.id),
          // @ts-ignore description
          description: model?.description || '',
          // @ts-ignore owned_by
          owned_by: model?.owned_by || '',
          // @ts-ignore supported_endpoint_types
          supported_endpoint_types: model?.supported_endpoint_types
        }))
        .filter((model) => !isEmpty(model.name))

      setListModels(filteredModels)
    } catch (error) {
      logger.error(`Failed to load models for provider ${getFancyProviderName(provider)}`, error as Error)
    } finally {
      setLoadingModels(false)
    }
  }, [])

  useEffect(() => {
    loadModels(provider)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

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
          {getFancyProviderName(provider)}
          {i18n.language.startsWith('zh') ? '' : ' '}
          {t('common.models')}
        </ModelHeaderTitle>
      </Flex>
    )
  }

  const renderTopTools = useCallback(() => {
    const isAllFilteredInProvider = list.length > 0 && list.every((model) => isModelInProvider(provider, model.id))

    return (
      <HStack gap={8}>
        <Tooltip
          title={
            isAllFilteredInProvider
              ? t('settings.models.manage.remove_listed')
              : t('settings.models.manage.add_listed.label')
          }
          destroyTooltipOnHide
          mouseLeaveDelay={0}>
          <Button
            type="default"
            icon={isAllFilteredInProvider ? <ListMinus size={18} /> : <ListPlus size={18} />}
            size="large"
            onClick={(e) => {
              e.stopPropagation()
              isAllFilteredInProvider ? onRemoveAll() : onAddAll()
            }}
            disabled={loadingModels || list.length === 0}
          />
        </Tooltip>
        <Tooltip title={t('settings.models.manage.refetch_list')} destroyTooltipOnHide mouseLeaveDelay={0}>
          <Button
            type="default"
            icon={<RefreshCcw size={16} />}
            size="large"
            onClick={() => loadModels(provider)}
            disabled={loadingModels}
          />
        </Tooltip>
      </HStack>
    )
  }, [list, t, loadingModels, provider, onRemoveAll, onAddAll, loadModels])

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
              style={{ visibility: loadingModels ? 'hidden' : 'visible' }}
            />
          ) : (
            <ManageModelsList
              modelGroups={modelGroups}
              provider={provider}
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
  height: calc(100vh - 300px);
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
