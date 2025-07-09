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
import { maskApiKey } from '@renderer/utils/api'
import { Avatar, Button, Tooltip, Typography } from 'antd'
import { Bolt } from 'lucide-react'
import React, { memo, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

import { ModelCheckStatus } from '../../services/HealthCheckService'
import { ModelStatus } from './ModelList'

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
            {status.error && <div style={{ marginTop: 5, color: 'var(--color-status-error)' }}>{status.error}</div>}
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
                    style={{
                      marginBottom: '5px',
                      color: kr.isValid ? 'var(--color-status-success)' : 'var(--color-status-error)'
                    }}>
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
        <StatusIndicator $type="checking">
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
      <Tooltip title={renderKeyCheckResultTooltip(modelStatus)} mouseEnterDelay={0.5}>
        <StatusIndicator $type={statusType}>{icon}</StatusIndicator>
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

interface ModelListItemProps {
  ref?: React.RefObject<HTMLDivElement>
  model: Model
  modelStatus: ModelStatus | undefined
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
