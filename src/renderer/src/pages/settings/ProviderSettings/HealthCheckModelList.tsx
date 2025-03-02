import { CheckCircleFilled, CloseCircleFilled, ExclamationCircleFilled, LoadingOutlined } from '@ant-design/icons'
import { HStack } from '@renderer/components/Layout'
import ModelTags from '@renderer/components/ModelTags'
import Scrollbar from '@renderer/components/Scrollbar'
import { getModelLogo } from '@renderer/config/models'
import { ModelCheckStatus } from '@renderer/services/HealthCheckService'
import { maskApiKey } from '@renderer/utils/api'
import { Avatar, List, Space, Spin, Tooltip, Typography } from 'antd'
import { TFunction } from 'i18next'
import React, { useCallback } from 'react'
import { useTranslation } from 'react-i18next'

import { ModelStatus } from './HealthCheckPopup'

// Status colors
const STATUS_COLORS = {
  success: '#52c41a',
  error: '#ff4d4f',
  warning: '#faad14'
}

interface ModelListProps {
  modelStatuses: ModelStatus[]
}

/**
 * Format check time to a human-readable string
 */
function formatCheckTime(time?: number): string {
  if (!time) return ''
  return `${(time / 1000).toFixed(2)}s`
}

/**
 * Hook for rendering model status UI elements
 */
function useModelStatusRendering(t: TFunction) {
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
                    {kr.checkTime && kr.isValid && ` (${formatCheckTime(kr.checkTime)})`}
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
  const renderStatusIndicator = useCallback(
    (status: ModelStatus) => {
      if (status.checking) {
        return <Spin indicator={<LoadingOutlined spin />} />
      }

      switch (status.status) {
        case ModelCheckStatus.SUCCESS:
          return (
            <Tooltip title={renderKeyCheckResultTooltip(status)}>
              <CheckCircleFilled style={{ color: STATUS_COLORS.success }} />
            </Tooltip>
          )
        case ModelCheckStatus.FAILED:
          return (
            <Tooltip title={renderKeyCheckResultTooltip(status)}>
              <CloseCircleFilled style={{ color: STATUS_COLORS.error }} />
            </Tooltip>
          )
        case ModelCheckStatus.PARTIAL:
          return (
            <Tooltip title={renderKeyCheckResultTooltip(status)}>
              <ExclamationCircleFilled style={{ color: STATUS_COLORS.warning }} />
            </Tooltip>
          )
        default:
          return <span>{t('settings.models.check.not_checked')}</span>
      }
    },
    [t, renderKeyCheckResultTooltip]
  )

  return { renderStatusIndicator }
}

/**
 * Component for displaying a list of models with their check status
 */
const HealthCheckModelList: React.FC<ModelListProps> = ({ modelStatuses }) => {
  const { t } = useTranslation()
  const { renderStatusIndicator } = useModelStatusRendering(t)

  return (
    <Scrollbar style={{ maxHeight: '50vh', overflowX: 'hidden' }}>
      <List
        dataSource={modelStatuses}
        renderItem={(status) => (
          <List.Item>
            <HStack style={{ width: '100%', justifyContent: 'space-between' }}>
              <Space>
                <Avatar src={getModelLogo(status.model.id)} size={22} style={{ marginRight: '2px' }}>
                  {status.model?.name?.[0]?.toUpperCase()}
                </Avatar>
                <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: '5px' }}>
                  <span>{status.model?.name}</span>
                  <ModelTags model={status.model} />
                </div>
                {/* Display response time for successful or partially successful models */}
                {status.checkTime &&
                  (status.status === ModelCheckStatus.SUCCESS || status.status === ModelCheckStatus.PARTIAL) && (
                    <Typography.Text type="secondary">{formatCheckTime(status.checkTime)}</Typography.Text>
                  )}
              </Space>
              <Space>{renderStatusIndicator(status)}</Space>
            </HStack>
          </List.Item>
        )}
      />
    </Scrollbar>
  )
}

export default HealthCheckModelList
