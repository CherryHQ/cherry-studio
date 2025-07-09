import {
  CheckCircleFilled,
  CloseCircleFilled,
  ExclamationCircleFilled,
  LoadingOutlined,
  MinusOutlined
} from '@ant-design/icons'
import { HStack } from '@renderer/components/Layout'
import ModelIdWithTags from '@renderer/components/ModelIdWithTags'
import { getModelLogo } from '@renderer/config/models'
import { Model } from '@renderer/types'
import { ApiKeyWithStatus, HealthStatus, ModelWithStatus } from '@renderer/types/healthCheck'
import { maskApiKey } from '@renderer/utils/api'
import { Avatar, Button, Tooltip, Typography } from 'antd'
import { Bolt } from 'lucide-react'
import React, { memo, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

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
    (status: ModelWithStatus) => {
      const getStatusText = (s: HealthStatus) => {
        switch (s) {
          case HealthStatus.SUCCESS:
            return t('settings.models.check.passed')
          case HealthStatus.FAILED:
            return t('settings.models.check.failed')
          default:
            return ''
        }
      }

      if (!status.keyResults || status.keyResults.length === 0) {
        // Simple tooltip for single key result
        return (
          <div>
            <strong>{getStatusText(status.status)}</strong>
            {status.error && <div style={{ marginTop: 5, color: 'var(--color-status-error)' }}>{status.error}</div>}
          </div>
        )
      }

      // Detailed tooltip for multiple key results
      return (
        <div>
          {status.error && <div style={{ marginTop: 5, marginBottom: 5 }}>{status.error}</div>}
          <div style={{ marginTop: 5 }}>
            <ul style={{ maxHeight: '300px', overflowY: 'auto', margin: 0, padding: 0, listStyleType: 'none' }}>
              {status.keyResults.map((kr: ApiKeyWithStatus, idx) => {
                // Mask API key for security
                const maskedKey = maskApiKey(kr.key)
                const statusText = getStatusText(kr.status)

                return (
                  <li
                    key={idx}
                    style={{
                      marginBottom: '5px',
                      color:
                        kr.status === HealthStatus.SUCCESS ? 'var(--color-status-success)' : 'var(--color-status-error)'
                    }}>
                    {maskedKey}: {statusText}
                    {kr.error && kr.status === HealthStatus.FAILED && ` (${kr.error})`}
                    {kr.latency && kr.status === HealthStatus.SUCCESS && ` (${formatLatency(kr.latency)})`}
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
  function renderStatusIndicator(modelStatus: ModelWithStatus | undefined): React.ReactNode {
    if (!modelStatus) return null

    if (modelStatus.checking) {
      return (
        <StatusIndicator $type="checking">
          <LoadingOutlined spin />
        </StatusIndicator>
      )
    }

    if (modelStatus.status === HealthStatus.NOT_CHECKED) return null

    let icon: React.ReactNode = null
    let statusType = ''

    switch (modelStatus.status) {
      case HealthStatus.SUCCESS:
        icon = <CheckCircleFilled />
        statusType = 'success'
        break
      case HealthStatus.FAILED: {
        const hasSuccessKey = modelStatus.keyResults.some((r) => r.status === HealthStatus.SUCCESS)
        if (hasSuccessKey) {
          icon = <ExclamationCircleFilled />
          statusType = 'partial'
        } else {
          icon = <CloseCircleFilled />
          statusType = 'error'
        }
        break
      }
      default:
        return null
    }

    return (
      <Tooltip title={renderKeyCheckResultTooltip(modelStatus)} mouseEnterDelay={0.5}>
        <StatusIndicator $type={statusType}>{icon}</StatusIndicator>
      </Tooltip>
    )
  }

  function renderLatencyText(modelStatus: ModelWithStatus | undefined): React.ReactNode {
    if (!modelStatus?.latency) return null
    if (modelStatus.status === HealthStatus.SUCCESS || modelStatus.status === HealthStatus.FAILED) {
      return <ModelLatencyText type="secondary">{formatLatency(modelStatus.latency)}</ModelLatencyText>
    }
    return null
  }

  return { renderStatusIndicator, renderLatencyText }
}

interface ModelListItemProps {
  ref?: React.RefObject<HTMLDivElement>
  model: Model
  modelStatus: ModelWithStatus | undefined
  disabled?: boolean
  onEdit: (model: Model) => void
  onRemove: (model: Model) => void
}

const ModelListItem: React.FC<ModelListItemProps> = ({ ref, model, modelStatus, disabled, onEdit, onRemove }) => {
  const { t } = useTranslation()
  const { renderStatusIndicator, renderLatencyText } = useModelStatusRendering()
  const isChecking = modelStatus?.checking === true

  return (
    <ListItem ref={ref}>
      <HStack alignItems="center" gap={10} style={{ flex: 1 }}>
        <Avatar src={getModelLogo(model.id)} size={24}>
          {model?.name?.[0]?.toUpperCase()}
        </Avatar>
        <ModelIdWithTags
          model={model}
          style={{
            flex: 1,
            width: 0,
            overflow: 'hidden'
          }}
        />
      </HStack>
      <HStack alignItems="center" gap={6}>
        {renderLatencyText(modelStatus)}
        {renderStatusIndicator(modelStatus)}
        <HStack alignItems="center" gap={0}>
          <Tooltip title={t('models.edit')} mouseLeaveDelay={0}>
            <Button
              type="text"
              onClick={() => onEdit(model)}
              disabled={disabled || isChecking}
              icon={<Bolt size={16} />}
            />
          </Tooltip>
          <Tooltip title={t('settings.models.manage.remove_model')} mouseLeaveDelay={0}>
            <Button
              type="text"
              onClick={() => onRemove(model)}
              disabled={disabled || isChecking}
              icon={<MinusOutlined />}
            />
          </Tooltip>
        </HStack>
      </HStack>
    </ListItem>
  )
}

const ListItem = styled.div`
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 10px;
  color: var(--color-text);
  font-size: 14px;
  line-height: 1;
`

const StatusIndicator = styled.div<{ $type: string }>`
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 14px;
  color: ${(props) => {
    switch (props.$type) {
      case 'success':
        return 'var(--color-status-success)'
      case 'error':
        return 'var(--color-status-error)'
      case 'partial':
        return 'var(--color-status-warning)'
      default:
        return 'var(--color-text)'
    }
  }};
`

const ModelLatencyText = styled(Typography.Text)`
  margin-left: 10px;
  color: var(--color-text-secondary);
  font-size: 12px;
`

export default memo(ModelListItem)
