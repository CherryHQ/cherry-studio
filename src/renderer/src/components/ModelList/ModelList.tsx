import CollapsibleSearchBar from '@renderer/components/CollapsibleSearchBar'
import { StreamlineGoodHealthAndWellBeing } from '@renderer/components/Icons/SVGIcon'
import { HStack } from '@renderer/components/Layout'
import AddModelPopup from '@renderer/components/ModelList/AddModelPopup'
import EditModelsPopup from '@renderer/components/ModelList/EditModelsPopup'
import HealthCheckPopup from '@renderer/components/ModelList/HealthCheckPopup'
import ModelEditContent from '@renderer/components/ModelList/ModelEditContent'
import NewApiAddModelPopup from '@renderer/components/ModelList/NewApiAddModelPopup'
import { isRerankModel } from '@renderer/config/models'
import { PROVIDER_CONFIG } from '@renderer/config/providers'
import { useAssistants, useDefaultModel } from '@renderer/hooks/useAssistant'
import { useProvider } from '@renderer/hooks/useProvider'
import { checkModelsHealth } from '@renderer/services/HealthCheckService'
import { useAppDispatch } from '@renderer/store'
import { setModel } from '@renderer/store/assistants'
import { Model } from '@renderer/types'
import { HealthStatus, ModelWithStatus } from '@renderer/types/healthCheck'
import { splitApiKeyString } from '@renderer/utils/api'
import { summarizeHealthResults } from '@renderer/utils/healthCheck'
import { Button, Flex, Tooltip } from 'antd'
import { groupBy, isEmpty, sortBy, toPairs } from 'lodash'
import { ListCheck, Plus } from 'lucide-react'
import React, { memo, startTransition, useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { SettingHelpLink, SettingHelpText, SettingHelpTextRow, SettingSubtitle } from '../../pages/settings'
import ModelListGroup from './ModelListGroup'

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
  const [modelStatuses, setModelStatuses] = useState<ModelWithStatus[]>([])
  const [isHealthChecking, setIsHealthChecking] = useState(false)
  const [searchText, _setSearchText] = useState('')

  const setSearchText = useCallback((text: string) => {
    startTransition(() => {
      _setSearchText(text)
    })
  }, [])

  const modelGroups = useMemo(() => {
    const filteredModels = searchText
      ? models.filter((model) => model.name.toLowerCase().includes(searchText.toLowerCase()))
      : models
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

  /**
   * 执行所有模型的健康检查，结果实时更新到 UI
   */
  const onHealthCheck = async () => {
    const modelsToCheck = models.filter((model) => !isRerankModel(model))

    if (isEmpty(modelsToCheck)) {
      window.message.error({
        key: 'no-models',
        style: { marginTop: '3vh' },
        duration: 5,
        content: t('settings.provider.no_models_for_check')
      })
      return
    }

    const keys = splitApiKeyString(provider.apiKey)

    // 若无 key，插入空字符串以支持本地模型健康检查
    if (keys.length === 0) {
      keys.push('')
    }

    // 弹出健康检查参数配置弹窗
    const result = await HealthCheckPopup.show({
      title: t('settings.models.check.title'),
      provider,
      apiKeys: keys
    })

    if (result.cancelled) {
      return
    }

    // 初始化健康检查状态
    const initialStatuses: ModelWithStatus[] = modelsToCheck.map((model) => ({
      model,
      checking: true,
      status: HealthStatus.NOT_CHECKED,
      keyResults: []
    }))
    setModelStatuses(initialStatuses)
    setIsHealthChecking(true)

    // 执行健康检查，逐步更新每个模型的状态
    const checkResults = await checkModelsHealth(
      {
        provider,
        models: modelsToCheck,
        apiKeys: result.apiKeys,
        isConcurrent: result.isConcurrent
      },
      (checkResult, index) => {
        setModelStatuses((current) => {
          const updated = [...current]
          if (updated[index]) {
            updated[index] = {
              ...updated[index],
              ...checkResult,
              checking: false
            }
          }
          return updated
        })
      }
    )

    window.message.info({
      key: 'health-check-summary',
      style: { marginTop: '3vh' },
      duration: 5,
      content: summarizeHealthResults(checkResults, provider.name)
    })

    setIsHealthChecking(false)
  }

  return (
    <>
      <SettingSubtitle style={{ marginBottom: 5 }}>
        <HStack alignItems="center" justifyContent="space-between" style={{ width: '100%' }}>
          <HStack alignItems="center" gap={8}>
            <SettingSubtitle style={{ marginTop: 0 }}>{t('common.models')}</SettingSubtitle>
            {!isEmpty(models) && <CollapsibleSearchBar onSearch={setSearchText} />}
          </HStack>
          {!isEmpty(models) && (
            <HStack>
              <Tooltip title={t('settings.models.check.button_caption')} mouseLeaveDelay={0}>
                <Button
                  type="text"
                  onClick={onHealthCheck}
                  icon={<StreamlineGoodHealthAndWellBeing size={16} isActive={isHealthChecking} />}
                />
              </Tooltip>
              <Tooltip title={t('button.manage')} mouseLeaveDelay={0}>
                <Button
                  type="text"
                  onClick={onManageModel}
                  icon={<ListCheck size={16} />}
                  disabled={isHealthChecking}
                />
              </Tooltip>
              <Tooltip title={t('button.add')} mouseLeaveDelay={0}>
                <Button type="text" onClick={onAddModel} icon={<Plus size={16} />} disabled={isHealthChecking} />
              </Tooltip>
            </HStack>
          )}
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
        {(docsWebsite || modelsWebsite) && (
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
