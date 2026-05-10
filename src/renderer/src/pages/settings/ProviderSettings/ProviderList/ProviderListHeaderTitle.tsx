import { providerListClasses } from '@renderer/pages/settings/ProviderSettings/shared/primitives/ProviderSettingsPrimitives'
import { useTranslation } from 'react-i18next'

export default function ProviderListHeaderTitle() {
  const { t } = useTranslation()

  return <h2 className={providerListClasses.headerTitle}>{t('settings.provider.title')}</h2>
}
