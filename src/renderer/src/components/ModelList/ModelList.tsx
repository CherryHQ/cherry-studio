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
import { checkModelsHealth, getModelCheckSummary, ModelCheckStatus } from '@renderer/services/HealthCheckService'
import { useAppDispatch } from '@renderer/store'
import { setModel } from '@renderer/store/assistants'
import { Model } from '@renderer/types'
import { splitApiKeyString } from '@renderer/utils/api'
import { Button, Flex, Tooltip } from 'antd'
import { groupBy, isEmpty, sortBy, toPairs } from 'lodash'
import { ListCheck, Plus } from 'lucide-react'
import React, { memo, useCallback, useDeferredValue, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { SettingHelpLink, SettingHelpText, SettingHelpTextRow, SettingSubtitle } from '../../pages/settings'
import ModelListGroup from './ModelListGroup'

export interface ModelStatus {
  model: Model
  status?: ModelCheckStatus
  checking?: boolean
  error?: string
  keyResults?: any[]
  latency?: number
}

interface ModelListProps {
  providerId: string
}

/**
 * Model list component
 */
const ModelList: React.FC<ModelListProps> = ({ providerId }) => {
  const { t } = useTranslation()
  const { provider, updateProvider, models, removeModel } = useProvider(providerId)
  const { assistants } = useAssistants()
  const dispatch = useAppDispatch()
  const { defaultModel, setDefaultModel } = useDefaultModel()
  const [_searchText, setSearchText] = useState('')
  const searchText = useDeferredValue(_searchText)

  const [modelStatuses, setModelStatuses] = useState<ModelStatus[]>([])
  const [isHealthChecking, setIsHealthChecking] = useState(false)

  const providerConfig = PROVIDER_CONFIG[provider.id]
  const docsWebsite = providerConfig?.websites?.docs
  const modelsWebsite = providerConfig?.websites?.models

  const [editingModel, setEditingModel] = useState<Model | null>(null)

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
      const updatedModels = models.map((m) => {
        if (m.id === updatedModel.id) {
          return updatedModel
        }
        return m
      })

      updateProvider({ ...provider, models: updatedModels })

      // Update assistants using this model
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

      // Update default model if needed
      if (defaultModel?.id === updatedModel.id && defaultModel?.provider === provider.id) {
        setDefaultModel(updatedModel)
      }
    },
    [models, updateProvider, provider, assistants, defaultModel?.id, defaultModel?.provider, dispatch, setDefaultModel]
  )

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

    // Add an empty key to enable health checks for local models.
    // Error messages will be shown for each model if a valid key is needed.
    if (keys.length === 0) {
      keys.push('')
    }

    // Show configuration dialog to get health check parameters
    const result = await HealthCheckPopup.show({
      title: t('settings.models.check.title'),
      provider,
      apiKeys: keys
    })

    if (result.cancelled) {
      return
    }

    // Prepare the list of models to be checked
    const initialStatuses = modelsToCheck.map((model) => ({
      model,
      checking: true,
      status: undefined
    }))
    setModelStatuses(initialStatuses)
    setIsHealthChecking(true)

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
              checking: false,
              status: checkResult.status,
              error: checkResult.error,
              keyResults: checkResult.keyResults,
              latency: checkResult.latency
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
      content: getModelCheckSummary(checkResults, provider.name)
    })

    // Reset health check status
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
