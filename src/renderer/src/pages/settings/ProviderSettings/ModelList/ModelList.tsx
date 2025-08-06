import CollapsibleSearchBar from '@renderer/components/CollapsibleSearchBar'
import CustomTag from '@renderer/components/CustomTag'
import { LoadingIcon, StreamlineGoodHealthAndWellBeing } from '@renderer/components/Icons'
import { HStack } from '@renderer/components/Layout'
import { PROVIDER_CONFIG } from '@renderer/config/providers'
import { useProvider } from '@renderer/hooks/useProvider'
import { getProviderLabel } from '@renderer/i18n/label'
import { SettingHelpLink, SettingHelpText, SettingHelpTextRow, SettingSubtitle } from '@renderer/pages/settings'
import EditModelPopup from '@renderer/pages/settings/ProviderSettings/EditModelPopup/EditModelPopup'
import AddModelPopup from '@renderer/pages/settings/ProviderSettings/ModelList/AddModelPopup'
import ManageModelsPopup from '@renderer/pages/settings/ProviderSettings/ModelList/ManageModelsPopup'
import NewApiAddModelPopup from '@renderer/pages/settings/ProviderSettings/ModelList/NewApiAddModelPopup'
import { Model } from '@renderer/types'
import { filterModelsByKeywords } from '@renderer/utils'
import { Button, Empty, Flex, Spin, Tooltip } from 'antd'
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

  const providerConfig = PROVIDER_CONFIG[provider.id]
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
    if (provider.id === 'new-api') {
      NewApiAddModelPopup.show({ title: t('settings.models.add.add_model'), provider })
    } else {
      AddModelPopup.show({ title: t('settings.models.add.add_model'), provider })
    }
  }, [provider, t])

  const isLoading = useMemo(() => displayedModelGroups === null, [displayedModelGroups])

  return (
    <>
      <SettingSubtitle style={{ marginBottom: 5 }}>
        <HStack alignItems="center" justifyContent="space-between" style={{ width: '100%' }}>
          <HStack alignItems="center" gap={8}>
            <SettingSubtitle style={{ marginTop: 0 }}>{t('common.models')}</SettingSubtitle>
            {modelCount > 0 && (
              <CustomTag color="#8c8c8c" size={10}>
                {modelCount}
              </CustomTag>
            )}
            <CollapsibleSearchBar onSearch={setSearchText} />
          </HStack>
          <HStack>
            <Tooltip title={t('settings.models.check.button_caption')} mouseLeaveDelay={0}>
              <Button
                type="text"
                onClick={runHealthCheck}
                icon={<StreamlineGoodHealthAndWellBeing size={16} isActive={isHealthChecking} />}
              />
            </Tooltip>
          </HStack>
        </HStack>
      </SettingSubtitle>
      <Spin spinning={isLoading} indicator={<LoadingIcon color="var(--color-text-2)" />}>
        {displayedModelGroups && !isEmpty(displayedModelGroups) ? (
          <Flex gap={12} vertical>
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
          </Flex>
        ) : (
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description={t('settings.models.empty')}
            style={{ visibility: isLoading ? 'hidden' : 'visible' }}
          />
        )}
      </Spin>
      <Flex justify="space-between" align="center">
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
          <div style={{ height: 5 }} />
        )}
      </Flex>
      <Flex gap={10} style={{ marginTop: 12 }}>
        <Button type="primary" onClick={onManageModel} icon={<ListCheck size={16} />} disabled={isHealthChecking}>
          {t('button.manage')}
        </Button>
        <Button type="default" onClick={onAddModel} icon={<Plus size={16} />} disabled={isHealthChecking}>
          {t('button.add')}
        </Button>
      </Flex>
    </>
  )
}

export default memo(ModelList)
