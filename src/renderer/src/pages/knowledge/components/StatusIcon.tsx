import { CheckCircleOutlined, CloseCircleOutlined } from '@ant-design/icons'
import { Center } from '@renderer/components/Layout'
import { KnowledgeBase, ProcessingStatus } from '@renderer/types'
import { Tooltip } from 'antd'
import { FC } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

interface StatusIconProps {
  sourceId: string
  base: KnowledgeBase
  getProcessingStatus: (sourceId: string) => ProcessingStatus | undefined
}

const StatusIcon: FC<StatusIconProps> = ({ sourceId, base, getProcessingStatus }) => {
  const { t } = useTranslation()
  const status = getProcessingStatus(sourceId)
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
        <Center style={{ width: '16px', height: '16px' }}>
          <StatusDot $status="new" />
        </Center>
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
    case 'processing':
      return (
        <Tooltip title={t('knowledge.status_processing')} placement="left">
          <StatusDot $status="processing" />
        </Tooltip>
      )
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
  width: 8px;
  height: 8px;
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
