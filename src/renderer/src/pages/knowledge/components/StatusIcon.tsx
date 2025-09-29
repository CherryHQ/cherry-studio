import { CheckCircleOutlined, CloseCircleOutlined } from '@ant-design/icons'
import { Tooltip } from '@cherrystudio/ui'
import { loggerService } from '@logger'
import type { KnowledgeBase, ProcessingStatus } from '@renderer/types'
import { Progress } from 'antd'
import type { FC } from 'react'
import React, { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

const logger = loggerService.withContext('StatusIcon')
interface StatusIconProps {
  sourceId: string
  base: KnowledgeBase
  getProcessingStatus: (sourceId: string) => ProcessingStatus | undefined
  type: string
  progress?: number
  isPreprocessed?: boolean
}

const StatusIcon: FC<StatusIconProps> = ({
  sourceId,
  base,
  getProcessingStatus,
  type,
  progress = 0,
  isPreprocessed
}) => {
  const { t } = useTranslation()
  const status = getProcessingStatus(sourceId)
  const item = base.items.find((item) => item.id === sourceId)
  const errorText = item?.processingError
  logger.debug(`[StatusIcon] Rendering for item: ${item?.id} Status: ${status} Progress: ${progress}`)

  return useMemo(() => {
    if (!status) {
      if (item?.uniqueId) {
        if (isPreprocessed && item.type === 'file') {
          return (
            <Tooltip placement="left" content={t('knowledge.status_preprocess_completed')}>
              <CheckCircleOutlined style={{ color: '#52c41a' }} />
            </Tooltip>
          )
        }
        return (
          <Tooltip placement="left" content={t('knowledge.status_embedding_completed')}>
            <CheckCircleOutlined style={{ color: '#52c41a' }} />
          </Tooltip>
        )
      }
      return (
        <Tooltip placement="left" content={t('knowledge.status_new')}>
          <StatusDot $status="new" />
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

      case 'processing': {
        return type === 'directory' || type === 'file' ? (
          <Progress type="circle" size={14} percent={Number(progress?.toFixed(0))} />
        ) : (
          <Tooltip placement="left" content={t('knowledge.status_processing')}>
            <StatusDot $status="processing" />
          </Tooltip>
        )
      }
      case 'completed':
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
  }, [status, item?.uniqueId, item?.type, t, isPreprocessed, errorText, type, progress])
}

const StatusDot = styled.div<{ $status: 'pending' | 'processing' | 'new' }>`
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background-color: ${(props) =>
    props.$status === 'pending' ? '#faad14' : props.$status === 'new' ? '#918999' : '#1890ff'};
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
    prevProps.base.id === nextProps.base.id &&
    prevProps.progress === nextProps.progress &&
    prevProps.getProcessingStatus(prevProps.sourceId) === nextProps.getProcessingStatus(nextProps.sourceId) &&
    prevProps.base.items.find((item) => item.id === prevProps.sourceId)?.processingError ===
      nextProps.base.items.find((item) => item.id === nextProps.sourceId)?.processingError
  )
})
