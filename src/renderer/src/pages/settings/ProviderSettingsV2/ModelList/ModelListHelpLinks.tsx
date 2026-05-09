import { useProvider, useProviderPresetMetadata } from '@renderer/hooks/useProviders'
import { getProviderLabel } from '@renderer/i18n/label'
import type React from 'react'
import { useTranslation } from 'react-i18next'

import {
  ProviderHelpLink,
  ProviderHelpText,
  ProviderHelpTextRow
} from '../shared/primitives/ProviderSettingsPrimitives'

interface ModelListHelpLinksProps {
  providerId: string
}

const ModelListHelpLinks: React.FC<ModelListHelpLinksProps> = ({ providerId }) => {
  const { t } = useTranslation()
  const { provider } = useProvider(providerId)
  const { data: presetMetadata } = useProviderPresetMetadata(providerId)

  const docsWebsite = presetMetadata?.websites?.docs
  const modelsWebsite = presetMetadata?.websites?.models

  if (!docsWebsite && !modelsWebsite) {
    return null
  }

  return (
    <div className="flex items-center justify-between">
      <ProviderHelpTextRow>
        <ProviderHelpText>{t('settings.provider.docs_check')} </ProviderHelpText>
        {docsWebsite && (
          <ProviderHelpLink target="_blank" href={docsWebsite}>
            {`${getProviderLabel(provider?.id ?? '')} `}
            {t('common.docs')}
          </ProviderHelpLink>
        )}
        {docsWebsite && modelsWebsite && <ProviderHelpText>{t('common.and')}</ProviderHelpText>}
        {modelsWebsite && (
          <ProviderHelpLink target="_blank" href={modelsWebsite}>
            {t('settings.models.list_title')}
          </ProviderHelpLink>
        )}
        <ProviderHelpText>{t('settings.provider.docs_more_details')}</ProviderHelpText>
      </ProviderHelpTextRow>
    </div>
  )
}

export default ModelListHelpLinks
