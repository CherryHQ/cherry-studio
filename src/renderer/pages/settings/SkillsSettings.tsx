import { useNavigate, useSearch } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'

import { Tabs, TabsContent, TabsList, TabsTrigger } from '@cherrystudio/ui'
import { ResourceCatalogView } from '@renderer/components/resourceCatalog/catalog'
import { SettingsContentBody } from '@renderer/components/SettingsPrimitives'
import { useSkillLauncher } from '@renderer/hooks/useSkillLauncher'
import type { ResourceItem } from '@renderer/types/resourceCatalog'

type SkillScopeTab = 'all' | 'system' | 'builtin'

export function SkillsSettings() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const launchSkill = useSkillLauncher()
  // The tab lives in the route search so it survives the round-trip through the detail route.
  const search = useSearch({ strict: false }) as { scope?: SkillScopeTab }
  const scope = search.scope ?? 'all'
  const setScope = (next: string) => void navigate({ to: '/settings/skills', search: { scope: next as SkillScopeTab } })
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
            onOpenSkill={(skill) =>
              void navigate({ to: '/settings/skills/$skillId', params: { skillId: skill.id }, search: { scope } })
            }
            onLaunchSkill={launchSkill}
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
