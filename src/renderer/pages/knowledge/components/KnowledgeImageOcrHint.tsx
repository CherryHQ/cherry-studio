import { useTranslation } from 'react-i18next'

import { imageExts } from '@shared/utils/file'

/** Keep the upload hint tied to the same image extensions used for OCR routing. */
export function KnowledgeImageOcrHint() {
  const { t } = useTranslation()
  return (
    <p className="max-w-md text-center text-xs leading-5 text-muted-foreground">
      {t('knowledge.data_source.image_ocr_hint', {
        formats: imageExts.map((ext) => ext.slice(1).toUpperCase()).join(', ')
      })}
    </p>
  )
}
