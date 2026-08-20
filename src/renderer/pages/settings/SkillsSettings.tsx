import { Switch } from '@cherrystudio/ui'
import { usePersistCache } from '@data/hooks/useCache'
import { ResourceCatalogView } from '@renderer/components/resourceCatalog/catalog'
import { SettingsContentBody } from '@renderer/components/SettingsPrimitives'
import type { ResourceItem } from '@renderer/types/resourceCatalog'
import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'

export function SkillsSettings() {
  const { t } = useTranslation()
  const [enabledOnly, setEnabledOnly] = usePersistCache('settings.skills.enabled_only')
  const filterSkills = useCallback(
    (resource: ResourceItem) => !enabledOnly || (resource.type === 'skill' && resource.raw.isGlobalEnabled),
    [enabledOnly]
  )
  const enabledOnlyLabel = t('settings.skills.enabledOnly')

  return (
    <SettingsContentBody className="min-h-0 flex-1 overflow-hidden pt-4" innerClassName="flex min-h-0 flex-1 flex-col">
      <ResourceCatalogView
        resourceType="skill"
        variant="settings"
        title={t('settings.skills.title')}
        className="min-h-0 flex-1"
        resourceFilter={filterSkills}
        toolbarLeading={
          <label className="flex cursor-pointer items-center gap-2 text-muted-foreground text-sm">
            <Switch size="sm" checked={enabledOnly} aria-label={enabledOnlyLabel} onCheckedChange={setEnabledOnly} />
            <span>{enabledOnlyLabel}</span>
          </label>
        }
      />
    </SettingsContentBody>
  )
}
