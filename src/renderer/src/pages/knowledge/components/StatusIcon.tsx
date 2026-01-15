import { CheckCircleOutlined, CloseCircleOutlined } from '@ant-design/icons'
import { Tooltip } from '@cherrystudio/ui'
import { loggerService } from '@logger'
import type { KnowledgeItem as KnowledgeItemV2 } from '@shared/data/types/knowledge'
import { Progress } from 'antd'
import type { FC } from 'react'
import React, { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

const logger = loggerService.withContext('StatusIcon')
interface StatusIconProps {
  sourceId: string
  type: string
  progress?: number
  isPreprocessed?: boolean
  item?: KnowledgeItemV2
}

const StatusIcon: FC<StatusIconProps> = ({ sourceId, type, progress = 0, isPreprocessed, item }) => {
  const { t } = useTranslation()
  const status = item?.status
  const errorText = item?.error
  const resolvedType = item?.type ?? type
  const resolvedId = item?.id ?? sourceId
  logger.debug(`[StatusIcon] Rendering for item: ${resolvedId} Status: ${status} Progress: ${progress}`)

  return useMemo(() => {
    if (!status || status === 'idle') {
      return (
        <Tooltip placement="left" content={t('knowledge.status_new')}>
          <StatusDot $status="idle" />
        </Tooltip>
      )
    }

    switch (status) {
      case 'pending':
        return (
          <Tooltip placement="left" content={t('knowledge.status_pending')}>
            <StatusDot $status="pending" />
          </Tooltip>
        )

      case 'preprocessing':
      case 'embedding': {
        return resolvedType === 'directory' || resolvedType === 'file' ? (
          <Progress type="circle" size={14} percent={Number(progress?.toFixed(0))} />
        ) : (
          <Tooltip placement="left" content={t('knowledge.status_processing')}>
            <StatusDot $status="processing" />
          </Tooltip>
        )
      }
      case 'completed':
        if (isPreprocessed && resolvedType === 'file') {
          return (
            <Tooltip placement="left" content={t('knowledge.status_preprocess_completed')}>
              <CheckCircleOutlined style={{ color: '#52c41a' }} />
            </Tooltip>
          )
        }
        return (
          <Tooltip placement="left" content={t('knowledge.status_completed')}>
            <CheckCircleOutlined style={{ color: '#52c41a' }} />
          </Tooltip>
        )
      case 'failed':
        return (
          <Tooltip placement="left" content={errorText || t('knowledge.status_failed')}>
            <CloseCircleOutlined style={{ color: '#ff4d4f' }} />
          </Tooltip>
        )
      default:
        return null
    }
  }, [status, resolvedType, t, isPreprocessed, errorText, progress])
}

const StatusDot = styled.div<{ $status: 'idle' | 'pending' | 'processing' }>`
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background-color: ${(props) =>
    props.$status === 'pending' ? '#faad14' : props.$status === 'idle' ? '#918999' : '#1890ff'};
  animation: ${(props) => (props.$status === 'processing' ? 'pulse 2s infinite' : 'none')};
  cursor: pointer;

  @keyframes pulse {
    0% {
      opacity: 1;
    }
    50% {
      opacity: 0.4;
    }
    100% {
      opacity: 1;
    }
  }
`

export default React.memo(StatusIcon, (prevProps, nextProps) => {
  return (
    prevProps.sourceId === nextProps.sourceId &&
    prevProps.type === nextProps.type &&
    prevProps.progress === nextProps.progress &&
    prevProps.isPreprocessed === nextProps.isPreprocessed &&
    prevProps.item?.status === nextProps.item?.status &&
    prevProps.item?.error === nextProps.item?.error
  )
})
