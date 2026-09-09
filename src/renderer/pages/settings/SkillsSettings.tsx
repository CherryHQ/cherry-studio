import { Tabs, TabsContent, TabsList, TabsTrigger } from '@cherrystudio/ui'
import { ResourceCatalogView } from '@renderer/components/resourceCatalog/catalog'
import { SettingsContentBody } from '@renderer/components/SettingsPrimitives'
import type { ResourceItem } from '@renderer/types/resourceCatalog'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

export function SkillsSettings() {
  const { t } = useTranslation()
  const [scope, setScope] = useState('all')
  const filterResource = (resource: ResourceItem) =>
    scope === 'all' || (resource.type === 'skill' && resource.raw.scope === scope)

  return (
    <SettingsContentBody className="min-h-0 flex-1 overflow-hidden pt-4" innerClassName="flex min-h-0 flex-1 flex-col">
      <Tabs value={scope} onValueChange={setScope} variant="underline" className="min-h-0 flex-1">
        <TabsContent value={scope} className="mt-0 flex min-h-0 flex-1 flex-col">
          <ResourceCatalogView
            resourceType="skill"
            variant="settings"
            title={t('settings.skills.title')}
            className="min-h-0 flex-1"
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
