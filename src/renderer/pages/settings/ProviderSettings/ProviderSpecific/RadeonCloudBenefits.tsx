import { Gift, SquareArrowOutUpRight } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { ProviderHelpLink } from '../primitives/ProviderSettingsPrimitives'

const TOKEN_FACTORY_URL = 'https://developer.amd.com.cn/radeon/tokenfactory?source=cherry-studio'

export default function RadeonCloudBenefits() {
  const { t } = useTranslation()

  return (
    <div
      data-testid="radeon-cloud-benefits"
      className="flex gap-3 rounded-lg border border-success/30 bg-success/10 p-3"
      role="note">
      <Gift className="mt-0.5 size-5 shrink-0 text-success" aria-hidden />
      <div className="min-w-0 flex-1">
        <div className="font-medium text-foreground text-sm">{t('settings.provider.radeon_cloud.benefits.title')}</div>
        <div className="mt-1 text-foreground-muted text-xs leading-relaxed">
          {t('settings.provider.radeon_cloud.benefits.description')}
        </div>
        <ProviderHelpLink
          className="mx-0 mt-2 inline-flex items-center gap-1"
          href={TOKEN_FACTORY_URL}
          target="_blank"
          rel="noreferrer">
          {t('settings.provider.radeon_cloud.benefits.cta')}
          <SquareArrowOutUpRight className="size-3" aria-hidden />
        </ProviderHelpLink>
      </div>
    </div>
  )
}
