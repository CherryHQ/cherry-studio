import { CircularProgress, Tooltip } from '@cherrystudio/ui'
import { loggerService } from '@logger'
import type { KnowledgeBase, ProcessingStatus } from '@renderer/types'
import { CheckCircle, XCircle } from 'lucide-react'
import type { FC } from 'react'
import React, { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

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
              <CheckCircle size={14} className="text-[#52c41a]" />
            </Tooltip>
          )
        }
        return (
          <Tooltip placement="left" content={t('knowledge.status_embedding_completed')}>
            <CheckCircle size={14} className="text-[#52c41a]" />
          </Tooltip>
        )
      }
      return (
        <Tooltip placement="left" content={t('knowledge.status_new')}>
          <StatusDot status="new" />
        </Tooltip>
      )
    }

    switch (status) {
      case 'pending':
        return (
          <Tooltip placement="left" content={t('knowledge.status_pending')}>
            <StatusDot status="pending" />
          </Tooltip>
        )

      case 'processing': {
        return type === 'directory' || type === 'file' ? (
          <CircularProgress value={Number(progress?.toFixed(0))} size={14} showLabel={false} />
        ) : (
          <Tooltip placement="left" content={t('knowledge.status_processing')}>
            <StatusDot status="processing" />
          </Tooltip>
        )
      }
      case 'completed':
        return (
          <Tooltip placement="left" content={t('knowledge.status_completed')}>
            <CheckCircle size={14} className="text-[#52c41a]" />
          </Tooltip>
        )
      case 'failed':
        return (
          <Tooltip placement="left" content={errorText || t('knowledge.status_failed')}>
            <XCircle size={14} className="text-[#ff4d4f]" />
          </Tooltip>
        )
      default:
        return null
    }
  }, [status, item?.uniqueId, item?.type, t, isPreprocessed, errorText, type, progress])
}

const StatusDot: FC<{ status: 'pending' | 'processing' | 'new' }> = ({ status }) => {
  const colors = {
    pending: 'bg-[#faad14]',
    new: 'bg-[#918999]',
    processing: 'bg-[#1890ff]'
  }

  return (
    <>
      <div
        className={`h-[10px] w-[10px] cursor-pointer rounded-full status-dot-${status} ${colors[status]}`}
        style={status === 'processing' ? { animation: 'pulse-status 2s infinite' } : undefined}
      />
      {status === 'processing' && (
        <style>{`
          @keyframes pulse-status {
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
        `}</style>
      )}
    </>
  )
}

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
