import { MinusOutlined, PlusOutlined } from '@ant-design/icons'
import { loggerService } from '@logger'
import CustomCollapse from '@renderer/components/CustomCollapse'
import CustomTag from '@renderer/components/CustomTag'
import ExpandableText from '@renderer/components/ExpandableText'
import ModelIdWithTags from '@renderer/components/ModelIdWithTags'
import NewApiAddModelPopup from '@renderer/components/ModelList/NewApiAddModelPopup'
import NewApiBatchAddModelPopup from '@renderer/components/ModelList/NewApiBatchAddModelPopup'
import Scrollbar from '@renderer/components/Scrollbar'
import { TopView } from '@renderer/components/TopView'
import {
  getModelLogo,
  groupQwenModels,
  isEmbeddingModel,
  isFunctionCallingModel,
  isReasoningModel,
  isRerankModel,
  isVisionModel,
  isWebSearchModel,
  SYSTEM_MODELS
} from '@renderer/config/models'
import { useProvider } from '@renderer/hooks/useProvider'
import FileItem from '@renderer/pages/files/FileItem'
import { fetchModels } from '@renderer/services/ApiService'
import { Model, Provider } from '@renderer/types'
import {
  filterModelsByKeywords,
  getDefaultGroupName,
  getFancyProviderName,
  isFreeModel,
  runAsyncFunction
} from '@renderer/utils'
import { Avatar, Button, Empty, Flex, Modal, Spin, Tabs, Tooltip } from 'antd'
import Input from 'antd/es/input/Input'
import { groupBy, isEmpty, uniqBy } from 'lodash'
import { debounce } from 'lodash'
import { Search } from 'lucide-react'
import { memo, useCallback, useEffect, useMemo, useOptimistic, useRef, useState, useTransition } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

const logger = loggerService.withContext('EditModelsPopup')

interface ShowParams {
  provider: Provider
}

interface Props extends ShowParams {
  resolve: (data: any) => void
}

// Check if the model exists in the provider's model list
const isModelInProvider = (provider: Provider, modelId: string): boolean => {
  return provider.models.some((m) => m.id === modelId)
}

const isValidNewApiModel = (model: Model): boolean => {
  return !!(model.supported_endpoint_types && model.supported_endpoint_types.length > 0)
}

const PopupContainer: React.FC<Props> = ({ provider: _provider, resolve }) => {
  const [open, setOpen] = useState(true)
  const { provider, models, addModel, removeModel } = useProvider(_provider.id)
  const [listModels, setListModels] = useState<Model[]>([])
  const [loading, setLoading] = useState(false)
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

  const systemModels = SYSTEM_MODELS[_provider.id] || []
  const allModels = uniqBy([...systemModels, ...listModels, ...models], 'id')

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
              endpoint_type: model.supported_endpoint_types[0]
            })
          } else {
            NewApiAddModelPopup.show({ title: t('settings.models.add.add_model'), provider, model })
          }
        } else {
          addModel(model)
        }
      }
    },
    [addModel, provider, t]
  )

  const onRemoveModel = useCallback((model: Model) => removeModel(model), [removeModel])

  useEffect(() => {
    runAsyncFunction(async () => {
      try {
        setLoading(true)
        const models = await fetchModels(_provider)
        setListModels(
          models
            .map((model) => ({
              // @ts-ignore modelId
              id: model?.id || model?.name,
              // @ts-ignore name
              name: model?.display_name || model?.displayName || model?.name || model?.id,
              provider: _provider.id,
              // @ts-ignore group
              group: getDefaultGroupName(model?.id || model?.name, _provider.id),
              // @ts-ignore description
              description: model?.description || '',
              // @ts-ignore owned_by
              owned_by: model?.owned_by || '',
              // @ts-ignore supported_endpoint_types
              supported_endpoint_types: model?.supported_endpoint_types
            }))
            .filter((model) => !isEmpty(model.name))
        )
      } catch (error) {
        logger.error('Failed to fetch models', error as Error)
      } finally {
        setTimeout(() => setLoading(false), 300)
      }
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (open && searchInputRef.current) {
      setTimeout(() => {
        searchInputRef.current?.focus()
      }, 350)
    }
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
      <Tooltip
        destroyTooltipOnHide
        title={
          isAllFilteredInProvider ? t('settings.models.manage.remove_listed') : t('settings.models.manage.add_listed')
        }
        mouseLeaveDelay={0}
        placement="top">
        <Button
          type="default"
          icon={isAllFilteredInProvider ? <MinusOutlined /> : <PlusOutlined />}
          size="large"
          onClick={(e) => {
            e.stopPropagation()
            if (isAllFilteredInProvider) {
              list.filter((model) => isModelInProvider(provider, model.id)).forEach(onRemoveModel)
            } else {
              const wouldAddModel = list.filter((model) => !isModelInProvider(provider, model.id))
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
          }}
          disabled={loading || list.length === 0}
        />
      </Tooltip>
    )
  }, [list, t, loading, provider, onRemoveModel, models, onAddModel])

  const renderGroupTools = useCallback(
    (group: string) => {
      const isAllInProvider = modelGroups[group].every((model) => isModelInProvider(provider, model.id))
      return (
        <Tooltip
          destroyTooltipOnHide
          title={
            isAllInProvider
              ? t(`settings.models.manage.remove_whole_group`)
              : t(`settings.models.manage.add_whole_group`)
          }
          mouseLeaveDelay={0}
          placement="top">
          <Button
            type="text"
            icon={isAllInProvider ? <MinusOutlined /> : <PlusOutlined />}
            onClick={(e) => {
              e.stopPropagation()
              if (isAllInProvider) {
                modelGroups[group].filter((model) => isModelInProvider(provider, model.id)).forEach(onRemoveModel)
              } else {
                const wouldAddModel = modelGroups[group].filter((model) => !isModelInProvider(provider, model.id))
                if (provider.id === 'new-api') {
                  if (wouldAddModel.every(isValidNewApiModel)) {
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
            }}
          />
        </Tooltip>
      )
    },
    [modelGroups, provider, onRemoveModel, onAddModel, t]
  )

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
            prefix={<Search size={14} />}
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
      <ListContainer>
        {loading || isFilterTypePending || isSearchPending ? (
          <Flex justify="center" align="center" style={{ height: '70%' }}>
            <Spin size="large" />
          </Flex>
        ) : (
          Object.keys(modelGroups).map((group, i) => {
            return (
              <CustomCollapse
                key={i}
                defaultActiveKey={['1']}
                styles={{ body: { padding: '0 10px' } }}
                label={
                  <Flex align="center" gap={10}>
                    <span style={{ fontWeight: 600 }}>{group}</span>
                    <CustomTag color="#02B96B" size={10}>
                      {modelGroups[group].length}
                    </CustomTag>
                  </Flex>
                }
                extra={renderGroupTools(group)}>
                <FlexColumn style={{ margin: '10px 0' }}>
                  {modelGroups[group].map((model) => (
                    <ModelListItem
                      key={model.id}
                      model={model}
                      provider={provider}
                      onAddModel={onAddModel}
                      onRemoveModel={onRemoveModel}
                    />
                  ))}
                </FlexColumn>
              </CustomCollapse>
            )
          })
        )}
        {!(loading || isFilterTypePending || isSearchPending) && isEmpty(list) && (
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('settings.models.empty')} />
        )}
      </ListContainer>
    </Modal>
  )
}

interface ModelListItemProps {
  model: Model
  provider: Provider
  onAddModel: (model: Model) => void
  onRemoveModel: (model: Model) => void
}

const ModelListItem: React.FC<ModelListItemProps> = memo(({ model, provider, onAddModel, onRemoveModel }) => {
  const isAdded = useMemo(() => isModelInProvider(provider, model.id), [provider, model.id])

  return (
    <FileItem
      style={{
        backgroundColor: isAdded ? 'rgba(0, 126, 0, 0.06)' : '',
        border: 'none',
        boxShadow: 'none'
      }}
      fileInfo={{
        icon: <Avatar src={getModelLogo(model.id)}>{model?.name?.[0]?.toUpperCase()}</Avatar>,
        name: <ModelIdWithTags model={model} />,
        extra: model.description && <ExpandableText text={model.description} />,
        ext: '.model',
        actions: isAdded ? (
          <Button type="text" onClick={() => onRemoveModel(model)} icon={<MinusOutlined />} />
        ) : (
          <Button type="text" onClick={() => onAddModel(model)} icon={<PlusOutlined />} />
        )
      }}
    />
  )
})

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

const ListContainer = styled(Scrollbar)`
  height: calc(100vh - 300px);
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding-bottom: 30px;
`

const FlexColumn = styled.div`
  display: flex;
  flex-direction: column;
  gap: 12px;
  margin-top: 16px;
`

const ModelHeaderTitle = styled.div`
  color: var(--color-text);
  font-size: 18px;
  font-weight: 600;
  margin-right: 10px;
`

export default class EditModelsPopup {
  static topviewId = 0
  static hide() {
    TopView.hide('EditModelsPopup')
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
        'EditModelsPopup'
      )
    })
  }
}
