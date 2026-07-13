import { InfoTooltip } from '@cherrystudio/ui'
import { SettingHelpLink, SettingHelpTextRow } from '@renderer/components/SettingsPrimitives'
import { ExternalLink } from 'lucide-react'
import { useTranslation } from 'react-i18next'

export const PADDLEOCR_DEPLOYMENT_URL = 'https://github.com/PaddlePaddle/PaddleOCR'

export function PaddleOcrDeploymentInfo() {
  const { t } = useTranslation()

  return (
    <SettingHelpTextRow className="flex-wrap items-center gap-x-1.5 gap-y-1">
      <SettingHelpLink
        href={PADDLEOCR_DEPLOYMENT_URL}
        target="_blank"
        rel="noreferrer"
        className="inline-flex items-center gap-1">
        {t('settings.tool.file_processing.processors.paddleocr.deployment.docs')}
        <ExternalLink size={10} />
      </SettingHelpLink>
      <InfoTooltip
        content={t('settings.tool.file_processing.processors.paddleocr.deployment.description')}
        iconProps={{ size: 14, className: 'shrink-0 cursor-pointer text-foreground-muted' }}
      />
    </SettingHelpTextRow>
  )
}
