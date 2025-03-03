import {
  CheckCircleFilled,
  CloseCircleFilled,
  ExclamationCircleFilled,
  LoadingOutlined,
  MinusCircleOutlined,
  SettingOutlined
} from '@ant-design/icons'
import ModelTags from '@renderer/components/ModelTags'
import { getModelLogo } from '@renderer/config/models'
import { ModelCheckStatus } from '@renderer/services/HealthCheckService'
import { Model, Provider } from '@renderer/types'
import { maskApiKey } from '@renderer/utils/api'
import { Avatar, Card, Space, Tooltip, Typography } from 'antd'
import { groupBy, sortBy, toPairs } from 'lodash'
import React, { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

const STATUS_COLORS = {
  success: '#52c41a',
  error: '#ff4d4f',
  warning: '#faad14'
}

interface ModelListProps {
  provider: Provider
  models: Model[]
  onRemoveModel: (model: Model) => void
  onEditModel: (model: Model) => void
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

const ModelList: React.FC<ModelListProps> = ({ provider, models, onRemoveModel, onEditModel, modelStatuses = [] }) => {
  const { renderStatusIndicator, renderLatencyText } = useModelStatusRendering()
  const { t } = useTranslation()
  const modelGroups = groupBy(models, 'group')
  const sortedModelGroups = sortBy(toPairs(modelGroups), [0]).reduce((acc, [key, value]) => {
    acc[key] = value
    return acc
  }, {})

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
                    .forEach((model) => onRemoveModel(model))
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
                    onClick={() => !isChecking && onRemoveModel(model)}
                    style={{ cursor: isChecking ? 'not-allowed' : 'pointer', opacity: isChecking ? 0.5 : 1 }}
                  />
                </Space>
              </ModelListItem>
            )
          })}
        </Card>
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
