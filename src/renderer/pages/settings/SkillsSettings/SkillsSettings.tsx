import { Badge, Button, Divider, Tooltip } from '@cherrystudio/ui'
import {
  SettingGroup,
  SettingRow,
  SettingRowTitle,
  SettingsContentColumn,
  SettingTitle
} from '@renderer/components/SettingsPrimitives'
import { useInstalledSkills, useSkillInstall } from '@renderer/hooks/useSkills'
import { useTheme } from '@renderer/hooks/useTheme'
import { ipcApi } from '@renderer/ipc'
import { toast } from '@renderer/services/toast'
import { FolderOpen, Globe, Package, Puzzle, Trash2, Wand } from 'lucide-react'
import type { FC } from 'react'
import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'

const SkillsSettings: FC = () => {
  const { t } = useTranslation()
  const { theme } = useTheme()
  const { skills, loading, refresh, uninstall } = useInstalledSkills()
  const { isInstalling, installFromDirectory } = useSkillInstall()
  const [installingDir, setInstallingDir] = useState(false)

  const handleInstallFromDirectory = useCallback(async () => {
    setInstallingDir(true)
    try {
      const selected = await window.api.file.select({ properties: ['openDirectory'] })
      if (!selected || selected.length === 0) return

      const result = await installFromDirectory(selected[0].path)
      if (result) {
        toast.success(t('skills.installSuccess', { name: result.name }))
        void refresh()
      }
    } catch (error) {
      toast.error(t('skills.installFailed', { name: '' }))
    } finally {
      setInstallingDir(false)
    }
  }, [installFromDirectory, refresh, t])

  const handleUninstall = useCallback(
    async (skillId: string, name: string) => {
      try {
        await uninstall(skillId)
        toast.success(t('skills.uninstallSuccess', { name }))
      } catch {
        // Error already handled by the hook
      }
    },
    [uninstall, t]
  )

  const handleOpenUrl = useCallback((url: string) => {
    void ipcApi.request('system.shell.open_website', url)
  }, [])

  const sourceLabel = (source: string): string => {
    switch (source) {
      case 'builtin':
        return t('skills.builtin')
      case 'marketplace':
        return t('skills.sourceMarketplace')
      case 'local':
        return t('skills.sourceLocal')
      case 'system':
        return t('skills.sourceSystem')
      default:
        return source
    }
  }

  return (
    <SettingsContentColumn theme={theme}>
      <SettingGroup theme={theme}>
        <SettingTitle className="gap-2">
          <Wand className="size-5" />
          <span className="font-semibold text-[15px]">{t('skills.title')}</span>
          <Badge variant="outline" className="ml-1 rounded-md px-1.5 text-[11px]">
            {skills.length}
          </Badge>
        </SettingTitle>

        <Divider className="my-2" />

        <div className="flex items-center justify-between gap-3 py-1">
          <span className="text-muted-foreground text-sm">{t('skills.description')}</span>
          <div className="flex shrink-0 items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={handleInstallFromDirectory}
              loading={installingDir || isInstalling('directory')}>
              <FolderOpen className="mr-1 size-3.5" />
              {t('skills.installFromDirectory')}
            </Button>
            <Tooltip content={t('skills.browseMarketplace')}>
              <Button size="sm" variant="outline" onClick={() => handleOpenUrl('https://skills.sh/')}>
                <Globe className="mr-1 size-3.5" />
                {t('skills.marketplace')}
              </Button>
            </Tooltip>
          </div>
        </div>
      </SettingGroup>

      {loading && (
        <SettingGroup theme={theme}>
          <div className="flex items-center justify-center py-8 text-muted-foreground text-sm">
            {t('common.loading')}
          </div>
        </SettingGroup>
      )}

      {!loading && skills.length === 0 && (
        <SettingGroup theme={theme}>
          <div className="flex flex-col items-center justify-center gap-3 py-8 text-muted-foreground">
            <Puzzle className="size-10 opacity-30" />
            <span className="text-sm">{t('skills.noInstalled')}</span>
            <Button size="sm" variant="outline" onClick={handleInstallFromDirectory}>
              <FolderOpen className="mr-1 size-3.5" />
              {t('skills.installFromDirectory')}
            </Button>
          </div>
        </SettingGroup>
      )}

      {!loading &&
        skills.map((skill, index) => (
          <SettingGroup key={skill.id} theme={theme}>
            <SettingRow className="items-start gap-3">
              <div className="flex min-w-0 flex-1 flex-col">
                <SettingRowTitle className="gap-2">
                  <Package className="size-4 shrink-0 text-muted-foreground" />
                  <span className="truncate font-medium">{skill.name}</span>
                  <Badge variant="secondary" className="shrink-0 rounded-md px-1.5 text-[10px]">
                    {sourceLabel(skill.source)}
                  </Badge>
                </SettingRowTitle>
                {skill.description && (
                  <p className="mt-1 line-clamp-2 text-muted-foreground text-xs">{skill.description}</p>
                )}
                <div className="mt-1.5 flex flex-wrap items-center gap-2 text-muted-foreground text-[11px]">
                  {skill.author && <span>{skill.author}</span>}
                  {skill.sourceUrl && (
                    <button
                      type="button"
                      className="inline-flex items-center gap-1 text-primary/70 hover:text-primary hover:underline"
                      onClick={() => handleOpenUrl(skill.sourceUrl!)}>
                      <Globe className="size-3" />
                      {t('skills.viewSource')}
                    </button>
                  )}
                </div>
              </div>

              <Button
                size="icon-sm"
                variant="ghost"
                className="shrink-0 text-muted-foreground hover:text-destructive"
                onClick={() => handleUninstall(skill.id, skill.name)}>
                <Trash2 className="size-4" />
              </Button>
            </SettingRow>
            {index < skills.length - 1 && <Divider className="my-2" />}
          </SettingGroup>
        ))}
    </SettingsContentColumn>
  )
}

export default SkillsSettings
