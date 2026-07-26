import { ResourceCatalogView } from '@renderer/components/resourceCatalog/catalog'
import { SettingsContentBody } from '@renderer/components/SettingsPrimitives'
import { useTranslation } from 'react-i18next'

export function SkillsSettings() {
  const { t } = useTranslation()

  return (
    <SettingsContentBody
      className="min-h-0 flex-1 overflow-hidden"
      innerClassName="flex min-h-0 flex-1 flex-col overflow-hidden">
      <ResourceCatalogView
        resourceType="skill"
        variant="settings"
        title={t('settings.skills.title')}
        description={t('settings.skills.pageDescription')}
        className="min-h-0 flex-1"
      />
    </SettingsContentBody>
  )
}
