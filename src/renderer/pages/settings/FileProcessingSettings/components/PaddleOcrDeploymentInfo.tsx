import { ExternalLink } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { SettingHelpLink, SettingHelpText, SettingHelpTextRow } from '../..'

export const PADDLEOCR_DEPLOYMENT_URL = 'https://github.com/PaddlePaddle/PaddleOCR'

export function PaddleOcrDeploymentInfo() {
  const { t } = useTranslation()

  return (
    <div className="border-border-muted border-t pt-4">
      <SettingHelpTextRow className="flex-wrap gap-x-1.5 gap-y-1 py-0">
        <SettingHelpText className="text-xs leading-relaxed">
          {t('settings.tool.file_processing.processors.paddleocr.deployment.description')}
        </SettingHelpText>
        <SettingHelpLink
          href={PADDLEOCR_DEPLOYMENT_URL}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1">
          {t('settings.tool.file_processing.processors.paddleocr.deployment.docs')}
          <ExternalLink size={10} />
        </SettingHelpLink>
      </SettingHelpTextRow>
    </div>
  )
}
