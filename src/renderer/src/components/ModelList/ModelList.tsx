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
import { getProviderLabel } from '@renderer/i18n/label'
import { SettingHelpLink, SettingHelpText, SettingHelpTextRow, SettingSubtitle } from '@renderer/pages/settings'
import { useAppDispatch } from '@renderer/store'
import { setModel } from '@renderer/store/assistants'
import { Model } from '@renderer/types'
import { filterModelsByKeywords } from '@renderer/utils'
import { Button, Flex, Spin, Tooltip } from 'antd'
import { groupBy, sortBy, toPairs } from 'lodash'
import { ListCheck, Plus } from 'lucide-react'
import React, { memo, useCallback, useEffect, useState, useTransition } from 'react'
import { useTranslation } from 'react-i18next'

import SvgSpinners180Ring from '../Icons/SvgSpinners180Ring'
import ModelListGroup from './ModelListGroup'
import { useHealthCheck } from './useHealthCheck'

interface ModelListProps {
  providerId: string
}

type ModelGroups = Record<string, Model[]>

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
  const [isPending, startTransition] = useTransition()
  const [displayedModelGroups, setDisplayedModelGroups] = useState<ModelGroups>({})

  const { isChecking: isHealthChecking, modelStatuses, runHealthCheck } = useHealthCheck(provider, models)

  const setSearchText = useCallback((text: string) => {
    startTransition(() => {
      _setSearchText(text)
    })
  }, [])

  useEffect(() => {
    startTransition(() => {
      const filteredModels = searchText ? filterModelsByKeywords(searchText, models) : models
      const grouped = groupBy(filteredModels, 'group')
      const sorted = sortBy(toPairs(grouped), [0]).reduce((acc, [key, value]) => {
        acc[key] = value
        return acc
      }, {})
      setDisplayedModelGroups(sorted)
    })
  }, [models, searchText])

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
      {isPending ? (
        <Flex align="center" justify="center" style={{ minHeight: '8rem' }}>
          <Spin indicator={<SvgSpinners180Ring color="var(--color-text-2)" />} />
        </Flex>
      ) : (
        <Flex gap={12} vertical>
          {Object.keys(displayedModelGroups).map((group, i) => (
            <ModelListGroup
              key={group}
              groupName={group}
              models={displayedModelGroups[group]}
              modelStatuses={modelStatuses}
              defaultOpen={i <= 5}
              disabled={isHealthChecking}
              onEditModel={onEditModel}
              onRemoveModel={removeModel}
              onRemoveGroup={() => displayedModelGroups[group].forEach((model) => removeModel(model))}
            />
          ))}
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
      )}
      <Flex gap={10} style={{ marginTop: 10 }}>
        <Button type="primary" onClick={onManageModel} icon={<ListCheck size={16} />} disabled={isHealthChecking}>
          {t('button.manage')}
        </Button>
        <Button type="default" onClick={onAddModel} icon={<Plus size={16} />} disabled={isHealthChecking}>
          {t('button.add')}
        </Button>
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
