import CollapsibleSearchBar from '@renderer/components/CollapsibleSearchBar'
import { StreamlineGoodHealthAndWellBeing } from '@renderer/components/Icons/SVGIcon'
import { HStack } from '@renderer/components/Layout'
import AddModelPopup from '@renderer/components/ModelList/AddModelPopup'
import EditModelsPopup from '@renderer/components/ModelList/EditModelsPopup'
import ModelEditContent from '@renderer/components/ModelList/ModelEditContent'
import NewApiAddModelPopup from '@renderer/components/ModelList/NewApiAddModelPopup'
import { PROVIDER_CONFIG } from '@renderer/config/providers'
import { useAssistants, useDefaultModel } from '@renderer/hooks/useAssistant'
import { useProvider } from '@renderer/hooks/useProvider'
import { SettingHelpLink, SettingHelpText, SettingHelpTextRow, SettingSubtitle } from '@renderer/pages/settings'
import { useAppDispatch } from '@renderer/store'
import { setModel } from '@renderer/store/assistants'
import { Model } from '@renderer/types'
import { filterModelsByKeywords } from '@renderer/utils'
import { Button, Flex, Tooltip } from 'antd'
import { groupBy, sortBy, toPairs } from 'lodash'
import { ListCheck, Plus } from 'lucide-react'
import React, { memo, startTransition, useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import ModelListGroup from './ModelListGroup'
import { useHealthCheck } from './useHealthCheck'

interface ModelListProps {
  providerId: string
}

/**
 * 模型列表组件，用于 CRUD 操作和健康检查
 */
const ModelList: React.FC<ModelListProps> = ({ providerId }) => {
  const dispatch = useAppDispatch()
  const { t } = useTranslation()
  const { provider, updateProvider, models, removeModel } = useProvider(providerId)
  const { assistants } = useAssistants()
  const { defaultModel, setDefaultModel } = useDefaultModel()

  const providerConfig = PROVIDER_CONFIG[provider.id]
  const docsWebsite = providerConfig?.websites?.docs
  const modelsWebsite = providerConfig?.websites?.models

  const [editingModel, setEditingModel] = useState<Model | null>(null)
  const [searchText, _setSearchText] = useState('')

  const { isChecking: isHealthChecking, modelStatuses, runHealthCheck } = useHealthCheck(provider, models)

  const setSearchText = useCallback((text: string) => {
    startTransition(() => {
      _setSearchText(text)
    })
  }, [])

  const modelGroups = useMemo(() => {
    const filteredModels = searchText ? filterModelsByKeywords(searchText, models) : models
    return groupBy(filteredModels, 'group')
  }, [searchText, models])

  const sortedModelGroups = useMemo(() => {
    return sortBy(toPairs(modelGroups), [0]).reduce((acc, [key, value]) => {
      acc[key] = value
      return acc
    }, {})
  }, [modelGroups])

  const onManageModel = useCallback(() => {
    EditModelsPopup.show({ provider })
  }, [provider])

  const onAddModel = useCallback(() => {
    if (provider.id === 'new-api') {
      NewApiAddModelPopup.show({ title: t('settings.models.add.add_model'), provider })
    } else {
      AddModelPopup.show({ title: t('settings.models.add.add_model'), provider })
    }
  }, [provider, t])

  const onEditModel = useCallback((model: Model) => {
    setEditingModel(model)
  }, [])

  const onUpdateModel = useCallback(
    (updatedModel: Model) => {
      const updatedModels = models.map((m) => (m.id === updatedModel.id ? updatedModel : m))

      updateProvider({ models: updatedModels })

      assistants.forEach((assistant) => {
        if (assistant?.model?.id === updatedModel.id && assistant.model.provider === provider.id) {
          dispatch(
            setModel({
              assistantId: assistant.id,
              model: updatedModel
            })
          )
        }
      })

      if (defaultModel?.id === updatedModel.id && defaultModel?.provider === provider.id) {
        setDefaultModel(updatedModel)
      }
    },
    [models, updateProvider, provider.id, assistants, defaultModel, dispatch, setDefaultModel]
  )

  return (
    <>
      <SettingSubtitle style={{ marginBottom: 5 }}>
        <HStack alignItems="center" justifyContent="space-between" style={{ width: '100%' }}>
          <HStack alignItems="center" gap={8}>
            <SettingSubtitle style={{ marginTop: 0 }}>{t('common.models')}</SettingSubtitle>
            <CollapsibleSearchBar onSearch={setSearchText} />
          </HStack>
          <HStack>
            <Tooltip title={t('button.manage')} mouseLeaveDelay={0}>
              <Button type="text" onClick={onManageModel} icon={<ListCheck size={16} />} disabled={isHealthChecking} />
            </Tooltip>
            <Tooltip title={t('button.add')} mouseLeaveDelay={0}>
              <Button type="text" onClick={onAddModel} icon={<Plus size={16} />} disabled={isHealthChecking} />
            </Tooltip>
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
      <Flex gap={12} vertical>
        {Object.keys(sortedModelGroups).map((group, i) => (
          <ModelListGroup
            key={group}
            groupName={group}
            models={sortedModelGroups[group]}
            modelStatuses={modelStatuses}
            defaultOpen={i <= 5}
            disabled={isHealthChecking}
            onEditModel={onEditModel}
            onRemoveModel={removeModel}
            onRemoveGroup={() => modelGroups[group].forEach((model) => removeModel(model))}
          />
        ))}
        {docsWebsite || modelsWebsite ? (
          <SettingHelpTextRow>
            <SettingHelpText>{t('settings.provider.docs_check')} </SettingHelpText>
            {docsWebsite && (
              <SettingHelpLink target="_blank" href={docsWebsite}>
                {t(`provider.${provider.id}`) + ' '}
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
      {models.map((model) => (
        <ModelEditContent
          provider={provider}
          model={model}
          onUpdateModel={onUpdateModel}
          open={editingModel?.id === model.id}
          onClose={() => setEditingModel(null)}
          key={model.id}
        />
      ))}
    </>
  )
}

export default memo(ModelList)
