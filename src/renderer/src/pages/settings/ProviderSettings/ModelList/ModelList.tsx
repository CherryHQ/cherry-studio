import { Button, ColFlex, Flex, RowFlex, Tooltip } from '@cherrystudio/ui'
import { useModelMutations, useModels } from '@data/hooks/useModels'
import { useProvider } from '@data/hooks/useProviders'
import CollapsibleSearchBar from '@renderer/components/CollapsibleSearchBar'
import { LoadingIcon, StreamlineGoodHealthAndWellBeing } from '@renderer/components/Icons'
import CustomTag from '@renderer/components/Tags/CustomTag'
import { PROVIDER_URLS } from '@renderer/config/providers'
import { getProviderLabel } from '@renderer/i18n/label'
import { SettingHelpLink, SettingHelpText, SettingHelpTextRow, SettingSubtitle } from '@renderer/pages/settings'
import EditModelPopup from '@renderer/pages/settings/ProviderSettings/EditModelPopup/EditModelPopup'
import AddModelPopup from '@renderer/pages/settings/ProviderSettings/ModelList/AddModelPopup'
import DownloadOVMSModelPopup from '@renderer/pages/settings/ProviderSettings/ModelList/DownloadOVMSModelPopup'
import ManageModelsPopup from '@renderer/pages/settings/ProviderSettings/ModelList/ManageModelsPopup'
import NewApiAddModelPopup from '@renderer/pages/settings/ProviderSettings/ModelList/NewApiAddModelPopup'
import { filterModelsByKeywords } from '@renderer/utils'
import { isNewApiProvider } from '@renderer/utils/provider.v2'
import type { Model } from '@shared/data/types/model'
import { parseUniqueModelId } from '@shared/data/types/model'
import { Spin } from 'antd'
import { groupBy, isEmpty, sortBy, toPairs } from 'lodash'
import { ListCheck, Plus } from 'lucide-react'
import React, { memo, startTransition, useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import ModelListGroup from './ModelListGroup'
import { useHealthCheck } from './useHealthCheck'

interface ModelListProps {
  providerId: string
}

type ModelGroups = Record<string, Model[]>
const MODEL_COUNT_THRESHOLD = 10

/**
 * 根据搜索文本筛选模型、分组并排序
 */
const calculateModelGroups = (models: Model[], searchText: string): ModelGroups => {
  const filteredModels = searchText ? filterModelsByKeywords(searchText, models as any) : models
  const grouped = groupBy(filteredModels, 'group')
  return sortBy(toPairs(grouped), [0]).reduce((acc, [key, value]) => {
    acc[key] = value
    return acc
  }, {})
}

/**
 * 模型列表组件，用于 CRUD 操作和健康检查
 */
const ModelList: React.FC<ModelListProps> = ({ providerId }) => {
  const { t } = useTranslation()
  const { provider } = useProvider(providerId)
  const { models } = useModels({ providerId })
  const { deleteModel } = useModelMutations()

  const removeModel = useCallback(
    async (model: Model) => {
      const { modelId } = parseUniqueModelId(model.id)
      await deleteModel(model.providerId, modelId)
    },
    [deleteModel]
  )

  // 稳定的编辑模型回调，避免内联函数导致子组件 memo 失效
  const handleEditModel = useCallback(
    (model: Model) => provider && EditModelPopup.show({ provider: provider as any, model: model as any }),
    [provider]
  )

  const providerConfig = provider ? PROVIDER_URLS[provider.id as keyof typeof PROVIDER_URLS] : undefined
  const docsWebsite = provider?.websites?.docs ?? providerConfig?.websites?.docs
  const modelsWebsite = provider?.websites?.models ?? providerConfig?.websites?.models

  const [searchText, _setSearchText] = useState('')
  const [displayedModelGroups, setDisplayedModelGroups] = useState<ModelGroups | null>(() => {
    if (models.length > MODEL_COUNT_THRESHOLD) {
      return null
    }
    return calculateModelGroups(models, '')
  })

  const { isChecking: isHealthChecking, modelStatuses, runHealthCheck } = useHealthCheck(provider as any, models as any)

  // 将 modelStatuses 数组转换为 Map，实现 O(1) 查找
  const modelStatusMap = useMemo(() => {
    return new Map(modelStatuses.map((status) => [status.model.id, status]))
  }, [modelStatuses])

  const setSearchText = useCallback((text: string) => {
    startTransition(() => {
      _setSearchText(text)
    })
  }, [])

  useEffect(() => {
    if (models.length > MODEL_COUNT_THRESHOLD) {
      startTransition(() => {
        setDisplayedModelGroups(calculateModelGroups(models, searchText))
      })
    } else {
      setDisplayedModelGroups(calculateModelGroups(models, searchText))
    }
  }, [models, searchText])

  const modelCount = useMemo(() => {
    return Object.values(displayedModelGroups ?? {}).reduce((acc, group) => acc + group.length, 0)
  }, [displayedModelGroups])

  const onManageModel = useCallback(() => {
    if (provider) ManageModelsPopup.show({ providerId: provider.id })
  }, [provider])

  const onAddModel = useCallback(() => {
    if (!provider) return
    if (isNewApiProvider(provider)) {
      NewApiAddModelPopup.show({ title: t('settings.models.add.add_model'), provider: provider as any })
    } else {
      AddModelPopup.show({ title: t('settings.models.add.add_model'), provider: provider as any })
    }
  }, [provider, t])

  const onDownloadModel = useCallback(
    () => provider && DownloadOVMSModelPopup.show({ title: t('ovms.download.title'), provider: provider as any }),
    [provider, t]
  )

  const isLoading = useMemo(() => displayedModelGroups === null, [displayedModelGroups])

  return (
    <>
      <SettingSubtitle className="mb-[5px]">
        <RowFlex className="w-full items-center justify-between">
          <RowFlex className="items-center gap-2">
            <SettingSubtitle className="mt-0">{t('common.models')}</SettingSubtitle>
            {modelCount > 0 && (
              <CustomTag color="#8c8c8c" size={10}>
                {modelCount}
              </CustomTag>
            )}
            <CollapsibleSearchBar
              onSearch={setSearchText}
              placeholder={t('models.search.placeholder')}
              tooltip={t('models.search.tooltip')}
            />
          </RowFlex>
          <RowFlex>
            <Tooltip content={t('settings.models.check.button_caption')} closeDelay={0}>
              <Button variant="ghost" onClick={runHealthCheck}>
                <StreamlineGoodHealthAndWellBeing size={16} isActive={isHealthChecking} />
              </Button>
            </Tooltip>
          </RowFlex>
        </RowFlex>
      </SettingSubtitle>
      <Spin spinning={isLoading} indicator={<LoadingIcon color="var(--color-text-2)" />}>
        {displayedModelGroups && !isEmpty(displayedModelGroups) && (
          <ColFlex className="gap-3">
            {Object.keys(displayedModelGroups).map((group, i) => (
              <ModelListGroup
                key={group}
                groupName={group}
                models={displayedModelGroups[group] as any}
                modelStatusMap={modelStatusMap as any}
                defaultOpen={i <= 5}
                onEditModel={handleEditModel as any}
                onRemoveModel={removeModel as any}
                onRemoveGroup={() => displayedModelGroups[group].forEach((model) => removeModel(model))}
              />
            ))}
          </ColFlex>
        )}
      </Spin>
      <Flex className="items-center justify-between">
        {docsWebsite || modelsWebsite ? (
          <SettingHelpTextRow>
            <SettingHelpText>{t('settings.provider.docs_check')} </SettingHelpText>
            {docsWebsite && (
              <SettingHelpLink target="_blank" href={docsWebsite}>
                {getProviderLabel(provider?.id ?? '') + ' '}
                {t('common.docs')}
              </SettingHelpLink>
            )}
            {docsWebsite && modelsWebsite && <SettingHelpText>{t('common.and')}</SettingHelpText>}
            {modelsWebsite && (
              <SettingHelpLink target="_blank" href={modelsWebsite}>
                {t('common.models')}
              </SettingHelpLink>
            )}
            <SettingHelpText>{t('settings.provider.docs_more_details')}</SettingHelpText>
          </SettingHelpTextRow>
        ) : (
          <div className="h-[5px]" />
        )}
      </Flex>
      <Flex className="mt-3 gap-2.5">
        <Button onClick={onManageModel} disabled={isHealthChecking}>
          <ListCheck fill="currentColor" size={16} />
          {t('button.manage')}
        </Button>
        {provider?.id !== 'ovms' ? (
          <Button variant="default" onClick={onAddModel} disabled={isHealthChecking}>
            <Plus size={16} />
            {t('button.add')}
          </Button>
        ) : (
          <Button onClick={onDownloadModel} disabled={isHealthChecking}>
            <Plus size={16} />
            {t('button.download')}
          </Button>
        )}
      </Flex>
    </>
  )
}

export default memo(ModelList)
