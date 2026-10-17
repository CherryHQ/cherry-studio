import { useNavigate, useSearch } from '@tanstack/react-router'
import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'

import { Switch, Tabs, TabsContent, TabsList, TabsTrigger } from '@cherrystudio/ui'
import { usePersistCache } from '@data/hooks/useCache'
import { ResourceCatalogView } from '@renderer/components/resourceCatalog/catalog'
import { SettingsContentBody } from '@renderer/components/SettingsPrimitives'
import { useSkillLauncher } from '@renderer/hooks/useSkillLauncher'
import type { ResourceItem } from '@renderer/types/resourceCatalog'

type SkillScopeTab = 'all' | 'system' | 'builtin'

export function SkillsSettings() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const launchSkill = useSkillLauncher()
  const [enabledOnly, setEnabledOnly] = usePersistCache('settings.skills.enabled_only')
  // The tab lives in the route search so it survives the round-trip through the detail route.
  const search = useSearch({ strict: false }) as { scope?: SkillScopeTab }
  const scope = search.scope ?? 'all'
  const setScope = (next: string) => void navigate({ to: '/settings/skills', search: { scope: next as SkillScopeTab } })
  const filterResource = useCallback(
    (resource: ResourceItem) =>
      resource.type === 'skill' &&
      (!enabledOnly || resource.raw.isGlobalEnabled) &&
      (scope === 'all' || resource.raw.scope === scope),
    [enabledOnly, scope]
  )
  const enabledOnlyLabel = t('settings.skills.enabledOnly')

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
            toolbarLeading={
              <label className="flex cursor-pointer items-center gap-2 text-muted-foreground text-sm">
                <Switch
                  size="sm"
                  checked={enabledOnly}
                  aria-label={enabledOnlyLabel}
                  onCheckedChange={setEnabledOnly}
                />
                <span>{enabledOnlyLabel}</span>
              </label>
            }
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
