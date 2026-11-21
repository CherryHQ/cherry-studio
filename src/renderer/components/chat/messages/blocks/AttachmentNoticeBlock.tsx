import React from 'react'
import { useTranslation } from 'react-i18next'

import { Alert } from '@cherrystudio/ui'
import type { AttachmentNoticePartData } from '@shared/data/types/uiParts'

/**
 * Non-blocking note on the assistant reply: some of the turn's attachments reached the model in a
 * different form than the user sent them (e.g. images inlined as OCR text for a non-vision model).
 */
const AttachmentNoticeBlock: React.FC<{ data: AttachmentNoticePartData }> = ({ data }) => {
  const { t } = useTranslation()
  if (data.kind !== 'image-ocr' || data.fileNames.length === 0) return null

  return (
    <Alert className="my-2" type="info" role="note" showIcon>
      {t('message.attachment_notice.image_ocr', { names: data.fileNames.join(', ') })}
    </Alert>
  )
}

export default React.memo(AttachmentNoticeBlock)
