import {
  CheckCircleFilled,
  CloseCircleFilled,
  EditOutlined,
  ExclamationCircleFilled,
  LoadingOutlined,
  MinusCircleOutlined,
  PlusOutlined,
  SettingOutlined
} from '@ant-design/icons'
import ModelTags from '@renderer/components/ModelTags'
import { getModelLogo } from '@renderer/config/models'
import { PROVIDER_CONFIG } from '@renderer/config/providers'
import { useAssistants, useDefaultModel } from '@renderer/hooks/useAssistant'
import { useProvider } from '@renderer/hooks/useProvider'
import { ModelCheckStatus } from '@renderer/services/HealthCheckService'
import { useAppDispatch } from '@renderer/store'
import { setModel } from '@renderer/store/assistants'
import { Model, Provider } from '@renderer/types'
import { maskApiKey } from '@renderer/utils/api'
import { Avatar, Button, Card, Flex, Space, Tooltip, Typography } from 'antd'
import { groupBy, sortBy, toPairs } from 'lodash'
import React, { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

import { SettingHelpLink, SettingHelpText, SettingHelpTextRow } from '..'
import AddModelPopup from './AddModelPopup'
import EditModelsPopup from './EditModelsPopup'
import ModelEditContent from './ModelEditContent'

const STATUS_COLORS = {
  success: '#52c41a',
  error: '#ff4d4f',
  warning: '#faad14'
}

interface ModelListProps {
  provider: Provider
  modelStatuses?: ModelStatus[]
}

export interface ModelStatus {
  model: Model
  status?: ModelCheckStatus
  checking?: boolean
  error?: string
  keyResults?: any[]
  latency?: number
}

/**
 * Format check time to a human-readable string
 */
function formatLatency(time: number): string {
  return `${(time / 1000).toFixed(2)}s`
}

/**
 * Hook for rendering model status UI elements
 */
function useModelStatusRendering() {
  const { t } = useTranslation()

  /**
   * Generate tooltip content for model check results
   */
  const renderKeyCheckResultTooltip = useCallback(
    (status: ModelStatus) => {
      const statusTitle =
        status.status === ModelCheckStatus.SUCCESS
          ? t('settings.models.check.passed')
          : t('settings.models.check.failed')

      if (!status.keyResults || status.keyResults.length === 0) {
        // Simple tooltip for single key result
        return (
          <div>
            <strong>{statusTitle}</strong>
            {status.error && <div style={{ marginTop: 5, color: STATUS_COLORS.error }}>{status.error}</div>}
          </div>
        )
      }

      // Detailed tooltip for multiple key results
      return (
        <div>
          {statusTitle}
          {status.error && <div style={{ marginTop: 5, marginBottom: 5 }}>{status.error}</div>}
          <div style={{ marginTop: 5 }}>
            <ul style={{ maxHeight: '300px', overflowY: 'auto', margin: 0, padding: 0, listStyleType: 'none' }}>
              {status.keyResults.map((kr, idx) => {
                // Mask API key for security
                const maskedKey = maskApiKey(kr.key)

                return (
                  <li
                    key={idx}
                    style={{ marginBottom: '5px', color: kr.isValid ? STATUS_COLORS.success : STATUS_COLORS.error }}>
                    {maskedKey}: {kr.isValid ? t('settings.models.check.passed') : t('settings.models.check.failed')}
                    {kr.error && !kr.isValid && ` (${kr.error})`}
                    {kr.latency && kr.isValid && ` (${formatLatency(kr.latency)})`}
                  </li>
                )
              })}
            </ul>
          </div>
        </div>
      )
    },
    [t]
  )

  /**
   * Render status indicator based on model check status
   */
  function renderStatusIndicator(modelStatus: ModelStatus | undefined): React.ReactNode {
    if (!modelStatus) return null

    if (modelStatus.checking) {
      return (
        <StatusIndicator type="checking">
          <LoadingOutlined spin />
        </StatusIndicator>
      )
    }

    if (!modelStatus.status) return null

    let icon: React.ReactNode = null
    let statusType = ''

    switch (modelStatus.status) {
      case ModelCheckStatus.SUCCESS:
        icon = <CheckCircleFilled />
        statusType = 'success'
        break
      case ModelCheckStatus.FAILED:
        icon = <CloseCircleFilled />
        statusType = 'error'
        break
      case ModelCheckStatus.PARTIAL:
        icon = <ExclamationCircleFilled />
        statusType = 'partial'
        break
      default:
        return null
    }

    return (
      <Tooltip title={renderKeyCheckResultTooltip(modelStatus)}>
        <StatusIndicator type={statusType}>{icon}</StatusIndicator>
      </Tooltip>
    )
  }

  function renderLatencyText(modelStatus: ModelStatus | undefined): React.ReactNode {
    if (!modelStatus?.latency) return null
    if (modelStatus.status === ModelCheckStatus.SUCCESS || modelStatus.status === ModelCheckStatus.PARTIAL) {
      return <ModelLatencyText type="secondary">{formatLatency(modelStatus.latency)}</ModelLatencyText>
    }
    return null
  }

  return { renderStatusIndicator, renderLatencyText }
}

const ModelList: React.FC<ModelListProps> = ({ provider: _provider, modelStatuses = [] }) => {
  const { t } = useTranslation()
  const { provider } = useProvider(_provider.id)
  const { updateProvider, models, removeModel } = useProvider(_provider.id)
  const { assistants } = useAssistants()
  const dispatch = useAppDispatch()
  const { defaultModel, setDefaultModel } = useDefaultModel()

  const { renderStatusIndicator, renderLatencyText } = useModelStatusRendering()
  const providerConfig = PROVIDER_CONFIG[provider.id]
  const docsWebsite = providerConfig?.websites?.docs
  const modelsWebsite = providerConfig?.websites?.models

  const [editingModel, setEditingModel] = useState<Model | null>(null)
  const modelGroups = groupBy(models, 'group')
  const sortedModelGroups = sortBy(toPairs(modelGroups), [0]).reduce((acc, [key, value]) => {
    acc[key] = value
    return acc
  }, {})

  const onManageModel = () => EditModelsPopup.show({ provider })
  const onAddModel = () => AddModelPopup.show({ title: t('settings.models.add.add_model'), provider })
  const onEditModel = (model: Model) => {
    setEditingModel(model)
  }

  const onUpdateModel = (updatedModel: Model) => {
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
  }

  return (
    <>
      {Object.keys(sortedModelGroups).map((group) => (
        <Card
          key={group}
          type="inner"
          title={group}
          extra={
            <Tooltip title={t('settings.models.manage.remove_whole_group')}>
              <HoveredRemoveIcon
                onClick={() =>
                  modelGroups[group]
                    .filter((model) => provider.models.some((m) => m.id === model.id))
                    .forEach((model) => removeModel(model))
                }
              />
            </Tooltip>
          }
          style={{ marginBottom: '10px', border: '0.5px solid var(--color-border)' }}
          size="small">
          {sortedModelGroups[group].map((model) => {
            const modelStatus = modelStatuses.find((status) => status.model.id === model.id)
            const isChecking = modelStatus?.checking === true

            return (
              <ModelListItem key={model.id}>
                <ModelListHeader>
                  <Avatar src={getModelLogo(model.id)} size={22} style={{ marginRight: '8px' }}>
                    {model?.name?.[0]?.toUpperCase()}
                  </Avatar>
                  <ModelNameRow>
                    <span>{model?.name}</span>
                    <ModelTags model={model} />
                  </ModelNameRow>
                  <SettingIcon
                    onClick={() => !isChecking && onEditModel(model)}
                    style={{ cursor: isChecking ? 'not-allowed' : 'pointer', opacity: isChecking ? 0.5 : 1 }}
                  />
                  {renderLatencyText(modelStatus)}
                </ModelListHeader>
                <Space>
                  {renderStatusIndicator(modelStatus)}
                  <RemoveIcon
                    onClick={() => !isChecking && removeModel(model)}
                    style={{ cursor: isChecking ? 'not-allowed' : 'pointer', opacity: isChecking ? 0.5 : 1 }}
                  />
                </Space>
              </ModelListItem>
            )
          })}
        </Card>
      ))}
      {docsWebsite && (
        <SettingHelpTextRow>
          <SettingHelpText>{t('settings.provider.docs_check')} </SettingHelpText>
          <SettingHelpLink target="_blank" href={docsWebsite}>
            {t(`provider.${provider.id}`) + ' '}
            {t('common.docs')}
          </SettingHelpLink>
          <SettingHelpText>{t('common.and')}</SettingHelpText>
          <SettingHelpLink target="_blank" href={modelsWebsite}>
            {t('common.models')}
          </SettingHelpLink>
          <SettingHelpText>{t('settings.provider.docs_more_details')}</SettingHelpText>
        </SettingHelpTextRow>
      )}
      <Flex gap={10} style={{ marginTop: '10px' }}>
        <Button type="primary" onClick={onManageModel} icon={<EditOutlined />}>
          {t('button.manage')}
        </Button>
        <Button type="default" onClick={onAddModel} icon={<PlusOutlined />}>
          {t('button.add')}
        </Button>
      </Flex>
      {models.map((model) => (
        <ModelEditContent
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

const ModelListItem = styled.div`
  display: flex;
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
  padding: 5px 0;
`

const ModelListHeader = styled.div`
  display: flex;
  flex-direction: row;
  align-items: center;
`

const ModelNameRow = styled.div`
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 10px;
`

const RemoveIcon = styled(MinusCircleOutlined)`
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 18px;
  color: var(--color-error);
  cursor: pointer;
  transition: all 0.2s ease-in-out;
`

const HoveredRemoveIcon = styled(RemoveIcon)`
  opacity: 0;
  margin-top: 2px;
  &:hover {
    opacity: 1;
  }
`

const SettingIcon = styled(SettingOutlined)`
  margin-left: 2px;
  color: var(--color-text);
  cursor: pointer;
  transition: all 0.2s ease-in-out;
  &:hover {
    color: var(--color-text-2);
  }
`

const StatusIndicator = styled.div<{ type: string }>`
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 18px;
  cursor: pointer;
  color: ${(props) => {
    switch (props.type) {
      case 'success':
        return STATUS_COLORS.success
      case 'error':
        return STATUS_COLORS.error
      case 'partial':
        return STATUS_COLORS.warning
      default:
        return 'var(--color-text)'
    }
  }};
`

const ModelLatencyText = styled(Typography.Text)`
  margin-left: 10px;
  color: var(--color-text-secondary);
`

export default ModelList
