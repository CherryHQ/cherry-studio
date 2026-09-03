import { ResourceCatalogView } from '@renderer/components/resourceCatalog/catalog'
import { SettingsContentBody } from '@renderer/components/SettingsPrimitives'
import { useSkillLauncher } from '@renderer/hooks/useSkillLauncher'
import { useNavigate } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'

export function SkillsSettings() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const launchSkill = useSkillLauncher()

  return (
    <SettingsContentBody className="min-h-0 flex-1 overflow-hidden pt-4" innerClassName="flex min-h-0 flex-1 flex-col">
      <ResourceCatalogView
        resourceType="skill"
        variant="settings"
        title={t('settings.skills.title')}
        className="min-h-0 flex-1"
        onOpenSkill={(skill) => void navigate({ to: '/settings/skills/$skillId', params: { skillId: skill.id } })}
        onLaunchSkill={launchSkill}
      />
    </SettingsContentBody>
  )
}
