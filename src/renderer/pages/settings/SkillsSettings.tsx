import { Tabs, TabsContent, TabsList, TabsTrigger } from '@cherrystudio/ui'
import { ResourceCatalogView } from '@renderer/components/resourceCatalog/catalog'
import { SettingsContentBody } from '@renderer/components/SettingsPrimitives'
import type { ResourceItem } from '@renderer/types/resourceCatalog'
import { useNavigate, useSearch } from '@tanstack/react-router'
import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'

export function SkillsSettings() {
  const { t } = useTranslation()
  const { id } = useSearch({ from: '/settings/skills' })
  const navigate = useNavigate({ from: '/settings/skills' })
  const [scope, setScope] = useState('all')
  const filterResource = (resource: ResourceItem) =>
    scope === 'all' || (resource.type === 'skill' && resource.raw.scope === scope)
  const handleSelectedSkillIdChange = useCallback(
    (selectedSkillId: string | undefined) => {
      void navigate({ search: (previous) => ({ ...previous, id: selectedSkillId }), replace: true })
    },
    [navigate]
  )

  return (
    <SettingsContentBody className="min-h-0 flex-1 overflow-hidden pt-4" innerClassName="flex min-h-0 flex-1 flex-col">
      <Tabs value={scope} onValueChange={setScope} variant="underline" className="min-h-0 flex-1">
        <TabsContent value={scope} className="mt-0 flex min-h-0 flex-1 flex-col">
          <ResourceCatalogView
            resourceType="skill"
            variant="settings"
            title={t('settings.skills.title')}
            className="min-h-0 flex-1"
            selectedSkillId={id}
            onSelectedSkillIdChange={handleSelectedSkillIdChange}
            filterResource={filterResource}
            allowColumnToggle
            toolbarFooter={
              <TabsList className="shrink-0" aria-label={t('settings.skills.title')}>
                <TabsTrigger value="all">{t('common.all')}</TabsTrigger>
                <TabsTrigger value="system">{t('settings.skills.tabs.system')}</TabsTrigger>
                <TabsTrigger value="builtin">{t('settings.skills.tabs.builtin')}</TabsTrigger>
              </TabsList>
            }
          />
        </TabsContent>
      </Tabs>
    </SettingsContentBody>
  )
}
