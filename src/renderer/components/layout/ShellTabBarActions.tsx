import { Button, Tooltip } from '@cherrystudio/ui'
import { usePersistCache } from '@data/hooks/useCache'
import { loggerService } from '@logger'
import { CommandTooltip } from '@renderer/components/command'
import GlobalSearchPopup from '@renderer/components/GlobalSearch/GlobalSearchPopup'
import { getSidebarLayout, type SidebarVisibleLayout } from '@renderer/components/Sidebar'
import { useAppUpdateState } from '@renderer/hooks/useAppUpdateState'
import { openSettingsTab } from '@renderer/services/mainWindowNavigation'
import { CircleArrowUp, Search, Settings } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { WindowControls } from '../WindowControls'

const logger = loggerService.withContext('ShellTabBarActions')

export function ShellTabBarActions() {
  const { t } = useTranslation()
  const [sidebarWidth] = usePersistCache('ui.sidebar.width')
  const { appUpdateState } = useAppUpdateState()
  const isSidebarHidden = getSidebarLayout(sidebarWidth) === 'hidden'
  const hasUpdateAction = Boolean(appUpdateState.available && appUpdateState.downloaded && appUpdateState.info)

  const handleSearchClick = () => {
    void GlobalSearchPopup.show()
  }

  const handleSettingsClick = () => {
    openSettingsTab('/settings/provider')
  }

  const handleUpdateClick = () => {
    const releaseInfo = appUpdateState.info
    if (!releaseInfo) return

    void import('@renderer/components/UpdateDialogPopup')
      .then(({ default: UpdateDialogPopup }) => UpdateDialogPopup.show({ releaseInfo }))
      .catch((error) => logger.error('Failed to open update dialog', error as Error))
  }

  const updateLabel = appUpdateState.info
    ? t('settings.about.updateAvailable', { version: appUpdateState.info.version })
    : t('button.update_available')

  return (
    <div className="flex h-full shrink-0 items-stretch">
      <div className="flex items-center gap-1 pr-2 [-webkit-app-region:no-drag]">
        {hasUpdateAction && (
          <Tooltip content={updateLabel} placement="bottom" delay={800}>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label={updateLabel}
              onClick={handleUpdateClick}
              className="flex h-8 w-8 items-center justify-center rounded-[8px] transition-colors hover:bg-accent">
              <CircleArrowUp className="lucide-custom size-[18px] text-success" strokeWidth={1.8} />
            </Button>
          </Tooltip>
        )}
        {isSidebarHidden && (
          <CommandTooltip command="app.settings.open" label={t('settings.title')} placement="bottom" delay={800}>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label={t('settings.title')}
              onClick={handleSettingsClick}
              className="flex h-8 w-8 items-center justify-center rounded-[8px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground dark:text-muted-foreground">
              <Settings size={16} strokeWidth={1.8} />
            </Button>
          </CommandTooltip>
        )}
        <CommandTooltip command="app.search" label={t('globalSearch.open')} placement="bottom" delay={800}>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={t('globalSearch.open')}
            onClick={handleSearchClick}
            className="flex h-8 w-8 items-center justify-center rounded-[8px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground dark:text-muted-foreground">
            <Search size={16} strokeWidth={1.8} />
          </Button>
        </CommandTooltip>
      </div>

      <WindowControls />
    </div>
  )
}

export function SidebarShellActions({
  layout,
  onSettingsClick
}: {
  layout: SidebarVisibleLayout
  onSettingsClick: () => void
}) {
  const { t } = useTranslation()

  if (layout === 'icon') {
    return (
      <CommandTooltip command="app.settings.open" label={t('settings.title')} placement="end" delay={800}>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label={t('settings.title')}
          onClick={onSettingsClick}
          className="flex h-9 w-9 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-accent/60 hover:text-foreground dark:text-muted-foreground">
          <Settings size={18} strokeWidth={1.6} />
        </Button>
      </CommandTooltip>
    )
  }

  return (
    <Button
      type="button"
      variant="ghost"
      aria-label={t('settings.title')}
      onClick={onSettingsClick}
      className="flex w-full items-center justify-start gap-2.5 rounded-lg px-2.5 py-1.75 text-[13px] text-foreground transition-colors hover:bg-accent/60">
      <Settings size={16} strokeWidth={1.6} />
      <span>{t('settings.title')}</span>
    </Button>
  )
}
