import { Button, ColFlex, Flex, RowFlex, Tooltip } from '@cherrystudio/ui'
import CollapsibleSearchBar from '@renderer/components/CollapsibleSearchBar'
import { LoadingIcon, StreamlineGoodHealthAndWellBeing } from '@renderer/components/Icons'
import CustomTag from '@renderer/components/Tags/CustomTag'
import { isNewApiProvider, PROVIDER_URLS } from '@renderer/config/providers'
import { useProvider } from '@renderer/hooks/useProvider'
import { getProviderLabel } from '@renderer/i18n/label'
import { SettingHelpLink, SettingHelpText, SettingHelpTextRow, SettingSubtitle } from '@renderer/pages/settings'
import EditModelPopup from '@renderer/pages/settings/ProviderSettings/EditModelPopup/EditModelPopup'
import AddModelPopup from '@renderer/pages/settings/ProviderSettings/ModelList/AddModelPopup'
import ManageModelsPopup from '@renderer/pages/settings/ProviderSettings/ModelList/ManageModelsPopup'
import NewApiAddModelPopup from '@renderer/pages/settings/ProviderSettings/ModelList/NewApiAddModelPopup'
import type { Model } from '@renderer/types'
import { filterModelsByKeywords } from '@renderer/utils'
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
  const filteredModels = searchText ? filterModelsByKeywords(searchText, models) : models
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
  const { provider, models, removeModel } = useProvider(providerId)

  const providerConfig = PROVIDER_URLS[provider.id]
  const docsWebsite = providerConfig?.websites?.docs
  const modelsWebsite = providerConfig?.websites?.models

  const [searchText, _setSearchText] = useState('')
  const [displayedModelGroups, setDisplayedModelGroups] = useState<ModelGroups | null>(() => {
    if (models.length > MODEL_COUNT_THRESHOLD) {
      return null
    }
    return calculateModelGroups(models, '')
  })

  const { isChecking: isHealthChecking, modelStatuses, runHealthCheck } = useHealthCheck(provider, models)

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
    ManageModelsPopup.show({ providerId: provider.id })
  }, [provider.id])

  const onAddModel = useCallback(() => {
    if (isNewApiProvider(provider)) {
      NewApiAddModelPopup.show({ title: t('settings.models.add.add_model'), provider })
    } else {
      AddModelPopup.show({ title: t('settings.models.add.add_model'), provider })
    }
  }, [provider, t])

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
              <Button
                variant="light"
                onPress={runHealthCheck}
                startContent={<StreamlineGoodHealthAndWellBeing size={16} isActive={isHealthChecking} />}
                isIconOnly
              />
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
                models={displayedModelGroups[group]}
                modelStatuses={modelStatuses}
                defaultOpen={i <= 5}
                onEditModel={(model) => EditModelPopup.show({ provider, model })}
                onRemoveModel={removeModel}
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
                {getProviderLabel(provider.id) + ' '}
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
        <Button
          color="primary"
          onPress={onManageModel}
          startContent={<ListCheck fill="currentColor" size={16} />}
          isDisabled={isHealthChecking}>
          {t('button.manage')}
        </Button>
        <Button variant="solid" onPress={onAddModel} startContent={<Plus size={16} />} isDisabled={isHealthChecking}>
          {t('button.add')}
        </Button>
      </Flex>
    </>
  )
}

export default memo(ModelList)
