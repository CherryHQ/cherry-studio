import { CheckCircleOutlined, CloseCircleOutlined } from '@ant-design/icons'
import { KnowledgeBase, ProcessingStatus } from '@renderer/types'
import { Progress, Tooltip } from 'antd'
import { FC } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

interface StatusIconProps {
  sourceId: string
  base: KnowledgeBase
  getProcessingStatus: (sourceId: string) => ProcessingStatus | undefined
  getProcessingPercent?: (sourceId: string) => number | undefined
  type: string
}

const StatusIcon: FC<StatusIconProps> = ({ sourceId, base, getProcessingStatus, getProcessingPercent, type }) => {
  const { t } = useTranslation()
  const status = getProcessingStatus(sourceId)
  const percent = getProcessingPercent?.(sourceId)
  const item = base.items.find((item) => item.id === sourceId)
  const errorText = item?.processingError

  if (!status) {
    if (item?.uniqueId) {
      return (
        <Tooltip title={t('knowledge.status_completed')} placement="left">
          <CheckCircleOutlined style={{ color: '#52c41a' }} />
        </Tooltip>
      )
    }
    return (
      <Tooltip title={t('knowledge.status_new')} placement="left">
        <StatusDot $status="new" />
      </Tooltip>
    )
  }

  switch (status) {
    case 'pending':
      return (
        <Tooltip title={t('knowledge.status_pending')} placement="left">
          <StatusDot $status="pending" />
        </Tooltip>
      )

    case 'processing': {
      return type === 'directory' ? (
        <Progress type="circle" size={14} percent={Number(percent?.toFixed(0))} />
      ) : (
        <Tooltip title={t('knowledge.status_processing')} placement="left">
          <StatusDot $status="processing" />
        </Tooltip>
      )
    }
    case 'completed':
      return (
        <Tooltip title={t('knowledge.status_completed')} placement="left">
          <CheckCircleOutlined style={{ color: '#52c41a' }} />
        </Tooltip>
      )
    case 'failed':
      return (
        <Tooltip title={errorText || t('knowledge.status_failed')} placement="left">
          <CloseCircleOutlined style={{ color: '#ff4d4f' }} />
        </Tooltip>
      )
    default:
      return null
  }
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

export default StatusIcon
