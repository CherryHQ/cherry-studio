import { ExternalLink } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { SettingsSection } from './SettingsSection'

export const PADDLEOCR_DEPLOYMENT_URL = 'https://github.com/PaddlePaddle/PaddleOCR'

export function PaddleOCRDeploymentInfo() {
  const { t } = useTranslation()

  return (
    <SettingsSection title={t('settings.tool.file_processing.sections.description')}>
      <p className="text-foreground/40 text-xs leading-relaxed">
        {t('settings.tool.file_processing.paddleocr.deployment_description')}
      </p>
      <a
        href={PADDLEOCR_DEPLOYMENT_URL}
        target="_blank"
        rel="noreferrer"
        className="inline-flex items-center gap-1 text-primary/70 text-xs leading-tight transition-colors hover:text-primary">
        {t('settings.tool.file_processing.paddleocr.docker_deployment_docs')}
        <ExternalLink size={8} />
      </a>
    </SettingsSection>
  )
}
