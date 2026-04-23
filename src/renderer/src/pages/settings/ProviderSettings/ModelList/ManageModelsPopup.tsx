import { Button, Flex, RowFlex, Tooltip } from '@cherrystudio/ui'
import { loggerService } from '@logger'
import { LoadingIcon } from '@renderer/components/Icons'
import { TopView } from '@renderer/components/TopView'
import {
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
import NewApiAddModelPopup from '@renderer/pages/settings/ProviderSettings/ModelList/NewApiAddModelPopup'
import NewApiBatchAddModelPopup from '@renderer/pages/settings/ProviderSettings/ModelList/NewApiBatchAddModelPopup'
import { fetchModels } from '@renderer/services/ApiService'
import type { Model, Provider } from '@renderer/types'
import { filterModelsByKeywords, getFancyProviderName } from '@renderer/utils'
import { getDuplicateModelNames, isFreeModel } from '@renderer/utils/model'
import { isNewApiProvider } from '@renderer/utils/provider'
import { cn } from '@renderer/utils/style'
import { Empty, Modal, Spin, Tabs } from 'antd'
import Input from 'antd/es/input/Input'
import { groupBy, isEmpty, uniqBy } from 'lodash'
import { debounce } from 'lodash'
import { ListMinus, ListPlus, RefreshCcw, Search } from 'lucide-react'
import type React from 'react'
import { useCallback, useEffect, useMemo, useOptimistic, useRef, useState, useTransition } from 'react'
import { useTranslation } from 'react-i18next'

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

  const allModels = useMemo(
    () => uniqBy([...(SYSTEM_MODELS[provider.id] || []), ...listModels, ...models], 'id'),
    [provider.id, listModels, models]
  )
  const duplicateModelNames = useMemo(() => getDuplicateModelNames(allModels), [allModels])

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
        const hasSupportedEndpointTypes = model.supported_endpoint_types?.length

        // NewAPI provider without supported_endpoint_types needs manual configuration
        if (isNewApiProvider(provider) && !hasSupportedEndpointTypes) {
          void NewApiAddModelPopup.show({ title: t('settings.models.add.add_model'), provider, model })
          return
        }

        addModel(model)
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
        if (isNewApiProvider(provider)) {
          if (wouldAddModel.every(isValidNewApiModel)) {
            wouldAddModel.forEach(onAddModel)
          } else {
            void NewApiBatchAddModelPopup.show({
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
  }, [list, onAddModel, provider, t])

  const loadModels = useCallback(async (provider: Provider) => {
    setLoadingModels(true)
    try {
      const models = await fetchModels(provider)
      const filteredModels = models.filter((model) => !isEmpty(model.name))
      setListModels(filteredModels)
    } catch (error) {
      logger.error(`Failed to load models for provider ${getFancyProviderName(provider)}`, error as Error)
    } finally {
      setLoadingModels(false)
    }
  }, [])

  useEffect(() => {
    void loadModels(provider)
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
          <Button variant="ghost" size="icon-lg" onClick={() => loadModels(provider)} disabled={loadingModels}>
            <RefreshCcw size={16} />
          </Button>
        </Tooltip>
      </RowFlex>
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
        indicator={
          <LoadingIcon color="var(--color-foreground-secondary)" style={{ opacity: loadingModels ? 1 : 0 }} />
        }>
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
              duplicateModelNames={duplicateModelNames}
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

const SearchContainer = ({ className, ...props }: React.ComponentPropsWithoutRef<'div'>) => (
  <div
    className={cn('flex flex-col gap-[5px] [&_.ant-radio-group]:flex [&_.ant-radio-group]:flex-wrap', className)}
    {...props}
  />
)

const TopToolsWrapper = ({ className, ...props }: React.ComponentPropsWithoutRef<'div'>) => (
  <div className={cn('mt-2.5 mb-0 flex items-center gap-2', className)} {...props} />
)

const ListContainer = ({ className, ...props }: React.ComponentPropsWithoutRef<'div'>) => (
  <div className={cn('h-[calc(90vh-300px)]', className)} {...props} />
)

const ModelHeaderTitle = ({ className, ...props }: React.ComponentPropsWithoutRef<'div'>) => (
  <div className={cn('mr-2.5 font-semibold text-foreground text-lg', className)} {...props} />
)

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
