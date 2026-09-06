import { Switch, Tabs, TabsContent, TabsList, TabsTrigger } from '@cherrystudio/ui'
import { usePersistCache } from '@data/hooks/useCache'
import { ResourceCatalogView } from '@renderer/components/resourceCatalog/catalog'
import { SettingsContentBody } from '@renderer/components/SettingsPrimitives'
import type { ResourceItem } from '@renderer/types/resourceCatalog'
import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'

export function SkillsSettings() {
  const { t } = useTranslation()
  const [scope, setScope] = useState('all')
  const [enabledOnly, setEnabledOnly] = usePersistCache('settings.skills.enabled_only')
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
