import { LoadingOutlined, MinusOutlined, PlusOutlined } from '@ant-design/icons'
import CustomCollapse from '@renderer/components/CustomCollapse'
import CustomTag from '@renderer/components/CustomTag'
import ModelTagsWithLabel from '@renderer/components/ModelTagsWithLabel'
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
import { getDefaultGroupName, isFreeModel, runAsyncFunction } from '@renderer/utils'
import { Avatar, Button, Empty, Flex, Modal, Tabs, Tooltip, Typography } from 'antd'
import Input from 'antd/es/input/Input'
import { groupBy, isEmpty, uniqBy } from 'lodash'
import { Search } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

import { TopView } from '../../../components/TopView'

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

const PopupContainer: React.FC<Props> = ({ provider: _provider, resolve }) => {
  const [open, setOpen] = useState(true)
  const { provider, models, addModel, removeModel } = useProvider(_provider.id)
  const [listModels, setListModels] = useState<Model[]>([])
  const [loading, setLoading] = useState(false)
  const [searchText, setSearchText] = useState('')
  const [filterType, setFilterType] = useState<string>('all')
  const { t, i18n } = useTranslation()
  const searchInputRef = useRef<any>(null)

  const systemModels = SYSTEM_MODELS[_provider.id] || []
  const allModels = uniqBy([...systemModels, ...listModels, ...models], 'id')

  const list = allModels.filter((model) => {
    if (
      searchText &&
      !model.id.toLocaleLowerCase().includes(searchText.toLocaleLowerCase()) &&
      !model.name?.toLocaleLowerCase().includes(searchText.toLocaleLowerCase())
    ) {
      return false
    }

    switch (filterType) {
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
  })

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
        addModel(model)
      }
    },
    [addModel]
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
              id: model.id,
              // @ts-ignore name
              name: model.name || model.id,
              provider: _provider.id,
              group: getDefaultGroupName(model.id, _provider.id),
              // @ts-ignore name
              description: model?.description,
              owned_by: model?.owned_by
            }))
            .filter((model) => !isEmpty(model.name))
        )
        setLoading(false)
      } catch (error) {
        setLoading(false)
      }
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (open && searchInputRef.current) {
      setTimeout(() => {
        searchInputRef.current?.focus()
      }, 100)
    }
  }, [open])

  const ModalHeader = () => {
    return (
      <Flex>
        <ModelHeaderTitle>
          {provider.isSystem ? t(`provider.${provider.id}`) : provider.name}
          {i18n.language.startsWith('zh') ? '' : ' '}
          {t('common.models')}
        </ModelHeaderTitle>
        {loading && <LoadingOutlined size={20} />}
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
        placement="top">
        <Button
          type={isAllFilteredInProvider ? 'default' : 'primary'}
          icon={isAllFilteredInProvider ? <MinusOutlined /> : <PlusOutlined />}
          size="large"
          onClick={(e) => {
            e.stopPropagation()
            if (isAllFilteredInProvider) {
              list.filter((model) => isModelInProvider(provider, model.id)).forEach(onRemoveModel)
            } else {
              list.filter((model) => !isModelInProvider(provider, model.id)).forEach(onAddModel)
            }
          }}
          disabled={list.length === 0}
        />
      </Tooltip>
    )
  }, [list, provider, onAddModel, onRemoveModel, t])

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
          placement="top">
          <Button
            type="text"
            icon={isAllInProvider ? <MinusOutlined /> : <PlusOutlined />}
            onClick={(e) => {
              e.stopPropagation()
              if (isAllInProvider) {
                modelGroups[group].filter((model) => isModelInProvider(provider, model.id)).forEach(onRemoveModel)
              } else {
                modelGroups[group].filter((model) => !isModelInProvider(provider, model.id)).forEach(onAddModel)
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
      styles={{
        content: { padding: 0 },
        header: { padding: '16px 22px 30px 22px' }
      }}
      transitionName="animation-move-down"
      centered>
      <SearchContainer>
        <TopToolsWrapper>
          <Input
            prefix={<Search size={14} />}
            size="large"
            ref={searchInputRef}
            placeholder={t('settings.provider.search_placeholder')}
            allowClear
            onChange={(e) => setSearchText(e.target.value)}
          />
          {renderTopTools()}
        </TopToolsWrapper>
        <Tabs
          size={i18n.language.startsWith('zh') ? 'middle' : 'small'}
          defaultActiveKey="all"
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
          onChange={(key) => setFilterType(key)}
        />
      </SearchContainer>
      <ListContainer>
        {Object.keys(modelGroups).map((group, i) => {
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
                  <FileItem
                    style={{
                      backgroundColor: isModelInProvider(provider, model.id)
                        ? 'rgba(0, 126, 0, 0.06)'
                        : 'rgba(255, 255, 255, 0.04)',
                      border: 'none',
                      boxShadow: 'none'
                    }}
                    key={model.id}
                    fileInfo={{
                      icon: <Avatar src={getModelLogo(model.id)}>{model?.name?.[0]?.toUpperCase()}</Avatar>,
                      name: (
                        <ListItemName>
                          <Tooltip
                            styles={{
                              root: {
                                width: 'auto',
                                maxWidth: '500px'
                              }
                            }}
                            destroyTooltipOnHide
                            title={
                              <Typography.Text style={{ color: 'white' }} copyable={{ text: model.id }}>
                                {model.id}
                              </Typography.Text>
                            }
                            placement="top">
                            <span style={{ cursor: 'help' }}>{model.name}</span>
                          </Tooltip>
                          <ModelTagsWithLabel model={model} size={11} />
                        </ListItemName>
                      ),
                      extra: model.description && (
                        <div style={{ marginTop: 6 }}>
                          <Typography.Paragraph
                            type="secondary"
                            ellipsis={{ rows: 1, expandable: true }}
                            style={{ marginBottom: 0, marginTop: 5 }}>
                            {model.description}
                          </Typography.Paragraph>
                        </div>
                      ),
                      ext: '.model',
                      actions: (
                        <div>
                          {isModelInProvider(provider, model.id) ? (
                            <Button type="text" onClick={() => onRemoveModel(model)} icon={<MinusOutlined />} />
                          ) : (
                            <Button type="text" onClick={() => onAddModel(model)} icon={<PlusOutlined />} />
                          )}
                        </div>
                      )
                    }}
                  />
                ))}
              </FlexColumn>
            </CustomCollapse>
          )
        })}
        {isEmpty(list) && <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('settings.models.empty')} />}
      </ListContainer>
    </Modal>
  )
}

const SearchContainer = styled.div`
  display: flex;
  flex-direction: column;
  gap: 15px;
  padding: 0 22px;
  margin-top: -10px;

  .ant-radio-group {
    display: flex;
    flex-wrap: wrap;
  }
`

const TopToolsWrapper = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
`

const ListContainer = styled.div`
  height: calc(100vh - 300px);
  overflow-y: scroll;
  padding: 0 6px 16px 6px;
  margin-left: 16px;
  margin-right: 10px;
  display: flex;
  flex-direction: column;
  gap: 16px;
`

const FlexColumn = styled.div`
  display: flex;
  flex-direction: column;
  gap: 12px;
  margin-top: 16px;
`

const ListItemName = styled.div`
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 10px;
  color: var(--color-text);
  font-size: 14px;
  line-height: 1;
  font-weight: 600;
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
