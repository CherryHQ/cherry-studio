import { Tooltip } from '@cherrystudio/ui'
import type { KnowledgeItem as KnowledgeItemV2 } from '@shared/data/types/knowledge'
import { Progress } from 'antd'
import { CheckCircle2, CircleX } from 'lucide-react'
import type { FC } from 'react'
import React, { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

interface StatusIconProps {
  sourceId: string
  type: string
  progress?: number
  isPreprocessed?: boolean
  item?: KnowledgeItemV2
}

const StatusIcon: FC<StatusIconProps> = ({ type, progress: propProgress, isPreprocessed, item }) => {
  const { t } = useTranslation()
  const status = item?.status
  const errorText = item?.error
  const resolvedType = item?.type ?? type
  // Use item.progress if available, otherwise fall back to the prop
  const progress = item?.progress ?? propProgress ?? 0

  return useMemo(() => {
    if (!status || status === 'idle') {
      return (
        <Tooltip placement="top" content={t('knowledge.status_new')}>
          <StatusDot $status="idle" />
        </Tooltip>
      )
    }

    switch (status) {
      case 'pending':
        return (
          <Tooltip placement="top" content={t('knowledge.status_pending')}>
            <StatusDot $status="pending" />
          </Tooltip>
        )

      case 'ocr':
      case 'read':
      case 'embed': {
        // ocr: 黄色, read: 橙色, embed: 蓝色
        const strokeColor = status === 'ocr' ? '#faad14' : status === 'read' ? '#fa8c16' : '#1890ff'
        const tooltipKey = `knowledge.status_${status}` as const
        const tooltipContent = t(tooltipKey)

        return resolvedType === 'directory' || resolvedType === 'file' ? (
          <Tooltip placement="top" content={`${tooltipContent} ${progress}%`}>
            <Progress type="circle" size={14} percent={Number(progress?.toFixed(0))} strokeColor={strokeColor} />
          </Tooltip>
        ) : (
          <Tooltip placement="top" content={tooltipContent}>
            <StatusDot $status={status === 'ocr' ? 'pending' : 'processing'} />
          </Tooltip>
        )
      }
      case 'completed':
        if (isPreprocessed && resolvedType === 'file') {
          return (
            <Tooltip placement="top" content={t('knowledge.status_preprocess_completed')}>
              <CheckCircle2 size={16} className="text-primary" />
            </Tooltip>
          )
        }
        return (
          <Tooltip placement="top" content={t('knowledge.status_completed')}>
            <CheckCircle2 size={16} className="text-primary" />
          </Tooltip>
        )
      case 'failed':
        return (
          <Tooltip placement="top" content={errorText || t('knowledge.status_failed')}>
            <CircleX size={16} className="text-red-600" />
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
    prevProps.item?.error === nextProps.item?.error &&
    prevProps.item?.progress === nextProps.item?.progress
  )
})
