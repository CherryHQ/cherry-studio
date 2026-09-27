import { Info } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { cn } from '@renderer/utils/style'

import { useProviderMeta } from '@renderer/pages/settings/ProviderSettings/hooks/providerSetting/useProviderMeta'
import { ProviderHelpLink } from '../primitives/ProviderSettingsPrimitives'

interface DoubaoSetupGuideProps {
  providerId: string
  className?: string
}

export default function DoubaoSetupGuide({ providerId, className }: DoubaoSetupGuideProps) {
  const { t } = useTranslation()
  const meta = useProviderMeta(providerId)

  return (
    <div
      className={cn(
        'flex gap-2 rounded-md border border-primary/20 bg-primary/5 px-3 py-2.5 text-sm text-foreground',
        className
      )}
      role="status">
      <Info className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
      <div className="min-w-0 space-y-2">
        <p className="leading-snug">{t('settings.provider.doubao.setup_guide')}</p>
        <p className="text-muted-foreground text-xs leading-5">{t('settings.provider.doubao.setup_guide_detail')}</p>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
          {meta.apiKeyWebsite ? (
            <ProviderHelpLink target="_blank" rel="noreferrer" href={meta.apiKeyWebsite} className="mx-0">
              {t('settings.provider.get_api_key')}
            </ProviderHelpLink>
          ) : null}
          {meta.modelsWebsite ? (
            <ProviderHelpLink target="_blank" rel="noreferrer" href={meta.modelsWebsite} className="mx-0">
              {t('settings.provider.doubao.ark_model_console')}
            </ProviderHelpLink>
          ) : null}
          {meta.docsWebsite ? (
            <ProviderHelpLink target="_blank" rel="noreferrer" href={meta.docsWebsite} className="mx-0">
              {t('settings.provider.doubao.ark_api_docs')}
            </ProviderHelpLink>
          ) : null}
        </div>
      </div>
    </div>
  )
}
