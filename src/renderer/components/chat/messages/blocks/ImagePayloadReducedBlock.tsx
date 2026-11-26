import React from 'react'
import { useTranslation } from 'react-i18next'

import type { ImagePayloadReducedPartData } from '@shared/data/types/uiParts'

import MessageTimelineMarker from './MessageTimelineMarker'

interface Props {
  data?: ImagePayloadReducedPartData
}

const ImagePayloadReducedBlock: React.FC<Props> = ({ data }) => {
  const { t } = useTranslation()

  if (!data || (data.reducedCount <= 0 && data.omittedCount <= 0)) return null

  const label =
    data.reducedCount > 0 && data.omittedCount > 0
      ? t('chat.image_payload.reduced_and_omitted', {
          reducedCount: data.reducedCount,
          omittedCount: data.omittedCount
        })
      : data.omittedCount > 0
        ? t('chat.image_payload.omitted', { count: data.omittedCount })
        : t('chat.image_payload.reduced', { count: data.reducedCount })

  return (
    <MessageTimelineMarker>
      <span className="text-center">{label}</span>
    </MessageTimelineMarker>
  )
}

export default React.memo(ImagePayloadReducedBlock)
