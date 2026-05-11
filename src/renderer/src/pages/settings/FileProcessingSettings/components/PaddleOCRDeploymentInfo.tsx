import { ExternalLink } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { SettingHelpLink, SettingHelpText, SettingHelpTextRow, SettingSubtitle } from '../..'

export const PADDLEOCR_DEPLOYMENT_URL = 'https://github.com/PaddlePaddle/PaddleOCR'

export function PaddleOCRDeploymentInfo() {
  const { t } = useTranslation()

  return (
    <>
      <SettingSubtitle>{t('settings.tool.file_processing.sections.description')}</SettingSubtitle>
      <SettingHelpText className="text-xs leading-relaxed">
        {t('settings.tool.file_processing.processors.paddleocr.deployment.description')}
      </SettingHelpText>
      <SettingHelpTextRow>
        <SettingHelpLink
          href={PADDLEOCR_DEPLOYMENT_URL}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1">
          {t('settings.tool.file_processing.processors.paddleocr.deployment.docs')}
          <ExternalLink size={10} />
        </SettingHelpLink>
      </SettingHelpTextRow>
    </>
  )
}
