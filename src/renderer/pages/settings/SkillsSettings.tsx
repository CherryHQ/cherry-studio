import { useNavigate, useSearch } from '@tanstack/react-router'
import { Filter, Info, Settings } from 'lucide-react'
import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'

import {
  Button,
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
  Popover,
  PopoverContent,
  PopoverTrigger,
  ScrollArea,
  Switch,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Tooltip
} from '@cherrystudio/ui'
import { usePersistCache } from '@data/hooks/useCache'
import { usePreference } from '@data/hooks/usePreference'
import { ResourceCatalogView } from '@renderer/components/resourceCatalog/catalog'
import {
  SettingDescription,
  SettingRow,
  SettingRowTitle,
  SettingsContentBody
} from '@renderer/components/SettingsPrimitives'
import { useSkillLauncher } from '@renderer/hooks/useSkillLauncher'
import { ipcApi } from '@renderer/ipc'
import { toast } from '@renderer/services/toast'
import type { ResourceItem } from '@renderer/types/resourceCatalog'
import { cn } from '@renderer/utils/style'

type SkillScopeTab = 'all' | 'system' | 'builtin'

export function SkillsSettings() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const launchSkill = useSkillLauncher()
  const [exportEnabled, setExportEnabled] = usePreference('agent.skills.external_export.enabled', { optimistic: false })
  const [saving, setSaving] = useState(false)
  const syncExports = async () => {
    setSaving(true)
    try {
      await ipcApi.request('skill.reconcile', { externalExportsOnly: true })
    } catch {
      toast.error({
        title: t('settings.skills.externalExportSyncFailed'),
        timeout: 0,
        action: { label: t('settings.skills.externalExportRetry'), onClick: syncExports }
      })
    } finally {
      setSaving(false)
    }
  }
  const changeExport = async (next: boolean) => {
    setSaving(true)
    try {
      await setExportEnabled(next)
    } catch {
      toast.error(t('settings.skills.toggleFailed', { name: t('settings.skills.externalExportLabel') }))
      setSaving(false)
      return
    }
    await syncExports()
  }
  const [enabledOnly, setEnabledOnly] = usePersistCache('settings.skills.enabled_only')
  // The scope lives in the route search so it survives the round-trip through the detail route.
  const search: { scope?: SkillScopeTab } = useSearch({ strict: false })
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
    <SettingsContentBody
      className="min-h-0 flex-1 overflow-hidden p-0 pt-4"
      innerClassName="flex min-h-0 max-w-none flex-1 flex-col">
      <Tabs value={scope} onValueChange={setScope} className="min-h-0 flex-1">
        <TabsContent value={scope} className="mt-0 flex min-h-0 flex-1 flex-col">
          <ResourceCatalogView
            resourceType="skill"
            variant="settings"
            title={t('settings.skills.title')}
            headerActions={
              <Dialog>
                <Tooltip title={t('settings.skills.settings.title')} asChild>
                  <DialogTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      className="text-muted-foreground"
                      aria-label={t('settings.skills.settings.title')}>
                      <Settings size={16} aria-hidden />
                    </Button>
                  </DialogTrigger>
                </Tooltip>
                <DialogContent
                  size="lg"
                  closeLabel={t('common.close')}
                  className="flex max-h-[80dvh] flex-col gap-0 p-0">
                  <DialogHeader className="shrink-0 border-b border-border-subtle px-6 py-4 text-start">
                    <DialogTitle>{t('settings.skills.settings.title')}</DialogTitle>
                    <DialogDescription className="sr-only">
                      {t('settings.skills.externalExportSummary')}
                    </DialogDescription>
                  </DialogHeader>
                  <ScrollArea className="min-h-0 flex-1" contentProps={{ className: 'p-6' }}>
                    <SettingRow className="flex-nowrap gap-4">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1">
                          <SettingRowTitle id="external-export-label" className="font-medium">
                            {t('settings.skills.externalExportLabel')}
                          </SettingRowTitle>
                          <Popover>
                            <PopoverTrigger asChild>
                              <Button
                                variant="ghost"
                                size="icon-sm"
                                className="text-muted-foreground"
                                aria-label={t('common.help')}>
                                <Info size={16} aria-hidden />
                              </Button>
                            </PopoverTrigger>
                            <PopoverContent
                              align="start"
                              collisionPadding={16}
                              className="max-h-(--radix-popover-content-available-height) w-80 max-w-[calc(100vw-2rem)] overflow-y-auto text-xs leading-relaxed">
                              {t('settings.skills.externalExportDescription')}
                            </PopoverContent>
                          </Popover>
                        </div>
                        <SettingDescription id="external-export-path" className="mt-1 font-mono">
                          ~/.agents/skills
                        </SettingDescription>
                      </div>
                      <Switch
                        checked={exportEnabled}
                        disabled={saving}
                        aria-labelledby="external-export-label"
                        aria-describedby="external-export-path"
                        onCheckedChange={(next) => void changeExport(next)}
                      />
                    </SettingRow>
                  </ScrollArea>
                  <DialogFooter className="shrink-0 border-t border-border-subtle px-6 py-4">
                    <DialogClose asChild>
                      <Button size="sm">{t('settings.skills.settings.done')}</Button>
                    </DialogClose>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            }
            toolbarLeading={
              <DropdownMenu>
                <Tooltip title={t('settings.skills.filterLabel')} asChild>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={t('settings.skills.filterLabel')}
                      className={cn('text-muted-foreground', enabledOnly && 'text-primary')}>
                      <Filter size={16} aria-hidden />
                    </Button>
                  </DropdownMenuTrigger>
                </Tooltip>
                <DropdownMenuContent align="start" className="min-w-44">
                  <DropdownMenuCheckboxItem checked={enabledOnly} onCheckedChange={setEnabledOnly}>
                    {enabledOnlyLabel}
                  </DropdownMenuCheckboxItem>
                </DropdownMenuContent>
              </DropdownMenu>
            }
            toolbarFooter={
              <TabsList className="shrink-0 [&_[data-slot=tabs-trigger]]:px-4" aria-label={t('settings.skills.title')}>
                <TabsTrigger value="all">{t('common.all')}</TabsTrigger>
                <TabsTrigger value="system">{t('settings.skills.tabs.system')}</TabsTrigger>
                <TabsTrigger value="builtin">{t('settings.skills.tabs.builtin')}</TabsTrigger>
              </TabsList>
            }
            className="min-h-0 flex-1"
            onOpenSkill={(skill) =>
              void navigate({ to: '/settings/skills/$skillId', params: { skillId: skill.id }, search: { scope } })
            }
            onLaunchSkill={launchSkill}
            filterResource={filterResource}
          />
        </TabsContent>
      </Tabs>
    </SettingsContentBody>
  )
}
