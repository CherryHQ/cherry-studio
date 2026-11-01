import { Info } from 'lucide-react'
import React from 'react'
import { useTranslation } from 'react-i18next'

import type { AttachmentNoticePartData } from '@shared/data/types/uiParts'

/**
 * Non-blocking note on the assistant reply: some of the turn's attachments reached the model in a
 * different form than the user sent them (e.g. images inlined as OCR text for a non-vision model).
 */
const AttachmentNoticeBlock: React.FC<{ data: AttachmentNoticePartData }> = ({ data }) => {
  const { t } = useTranslation()
  if (data.kind !== 'image-ocr' || data.fileNames.length === 0) return null

  return (
    <div
      className="my-2 flex items-start gap-2 rounded-md border border-border-subtle px-3 py-2 text-muted-foreground text-xs"
      role="note">
      <Info className="mt-px size-3.5 shrink-0" aria-hidden />
      <span>{t('message.attachment_notice.image_ocr', { names: data.fileNames.join(', ') })}</span>
    </div>
  )
}

export default React.memo(AttachmentNoticeBlock)
