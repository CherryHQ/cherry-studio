import { ResourceCatalogView } from '@renderer/components/resourceCatalog/catalog'
import { SettingsContentBody } from '@renderer/components/SettingsPrimitives'
import { useNavigate, useSearch } from '@tanstack/react-router'
import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'

export function SkillsSettings() {
  const { t } = useTranslation()
  const { id } = useSearch({ from: '/settings/skills' })
  const navigate = useNavigate({ from: '/settings/skills' })
  const handleSelectedSkillIdChange = useCallback(
    (selectedSkillId: string | undefined) => {
      void navigate({ search: (previous) => ({ ...previous, id: selectedSkillId }), replace: true })
    },
    [navigate]
  )

  return (
    <SettingsContentBody className="min-h-0 flex-1 overflow-hidden pt-4" innerClassName="flex min-h-0 flex-1 flex-col">
      <ResourceCatalogView
        resourceType="skill"
        variant="settings"
        title={t('settings.skills.title')}
        className="min-h-0 flex-1"
        selectedSkillId={id}
        onSelectedSkillIdChange={handleSelectedSkillIdChange}
      />
    </SettingsContentBody>
  )
}
