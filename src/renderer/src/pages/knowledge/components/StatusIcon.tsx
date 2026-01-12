import { CheckCircleOutlined, CloseCircleOutlined } from '@ant-design/icons'
import { Tooltip } from '@cherrystudio/ui'
import { loggerService } from '@logger'
import type { KnowledgeBase, ProcessingStatus } from '@renderer/types'
import type { ItemStatus, KnowledgeItem as KnowledgeItemV2 } from '@shared/data/types/knowledge'
import { Progress } from 'antd'
import type { FC } from 'react'
import React, { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

const logger = loggerService.withContext('StatusIcon')
interface StatusIconProps {
  sourceId: string
  base?: KnowledgeBase
  getProcessingStatus?: (sourceId: string) => ProcessingStatus | undefined
  type: string
  progress?: number
  isPreprocessed?: boolean
  item?: KnowledgeItemV2
}

const normalizeV2Status = (status: ItemStatus): ProcessingStatus => {
  switch (status) {
    case 'idle':
    case 'pending':
      return 'pending'
    case 'preprocessing':
    case 'embedding':
      return 'processing'
    case 'completed':
      return 'completed'
    case 'failed':
      return 'failed'
    default:
      return 'pending'
  }
}

const StatusIcon: FC<StatusIconProps> = ({
  sourceId,
  base,
  getProcessingStatus,
  type,
  progress = 0,
  isPreprocessed,
  item
}) => {
  const { t } = useTranslation()
  const itemV1 = base?.items.find((baseItem) => baseItem.id === sourceId)
  const status = item ? normalizeV2Status(item.status) : getProcessingStatus?.(sourceId)
  const errorText = item?.error ?? itemV1?.processingError
  const resolvedType = item?.type ?? itemV1?.type ?? type
  const resolvedId = item?.id ?? itemV1?.id ?? sourceId
  logger.debug(`[StatusIcon] Rendering for item: ${resolvedId} Status: ${status} Progress: ${progress}`)

  return useMemo(() => {
    if (!status) {
      if (itemV1?.uniqueId) {
        if (isPreprocessed && resolvedType === 'file') {
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
  }, [status, itemV1?.uniqueId, resolvedType, t, isPreprocessed, errorText, progress])
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
  const prevUsesV2 = !!prevProps.item
  const nextUsesV2 = !!nextProps.item

  if (prevUsesV2 || nextUsesV2) {
    return (
      prevProps.sourceId === nextProps.sourceId &&
      prevProps.type === nextProps.type &&
      prevProps.progress === nextProps.progress &&
      prevProps.isPreprocessed === nextProps.isPreprocessed &&
      prevProps.item?.status === nextProps.item?.status &&
      prevProps.item?.error === nextProps.item?.error
    )
  }

  const prevStatus = prevProps.getProcessingStatus?.(prevProps.sourceId)
  const nextStatus = nextProps.getProcessingStatus?.(nextProps.sourceId)
  const prevError = prevProps.base?.items.find((item) => item.id === prevProps.sourceId)?.processingError
  const nextError = nextProps.base?.items.find((item) => item.id === nextProps.sourceId)?.processingError

  return (
    prevProps.sourceId === nextProps.sourceId &&
    prevProps.type === nextProps.type &&
    prevProps.base?.id === nextProps.base?.id &&
    prevProps.progress === nextProps.progress &&
    prevStatus === nextStatus &&
    prevError === nextError
  )
})
