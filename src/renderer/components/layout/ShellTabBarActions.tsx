import { Search, Settings, Stethoscope } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { Button, Tooltip } from '@cherrystudio/ui'
import { usePersistCache } from '@data/hooks/useCache'
import { CommandTooltip } from '@renderer/components/command'
import { DoctorPopup } from '@renderer/components/doctor'
import GlobalSearchPopup from '@renderer/components/GlobalSearch/GlobalSearchPopup'
import { getSidebarLayout, type SidebarVisibleLayout } from '@renderer/components/Sidebar'
import { openSettingsTab } from '@renderer/services/mainWindowNavigation'

import { WindowControls } from '../WindowControls'
import { AppUpdateButton } from './AppUpdateButton'
import { HelpMenu } from './HelpMenu'

export function ShellTabBarActions() {
  const { t } = useTranslation()
  const [sidebarWidth] = usePersistCache('ui.sidebar.width')
  const isSidebarHidden = getSidebarLayout(sidebarWidth) === 'hidden'

  const handleSearchClick = () => {
    void GlobalSearchPopup.show()
  }

  const handleSettingsClick = () => {
    openSettingsTab()
  }

  const handleDiagnosticsClick = () => {
    void DoctorPopup.show({ initialPanel: 'checks' })
  }

  return (
    <div className="flex h-full shrink-0 items-stretch">
      <div className="flex items-center gap-1 pr-2 [-webkit-app-region:no-drag]">
        <AppUpdateButton />
        {isSidebarHidden ? (
          <>
            <Tooltip content={t('settings.doctor.entry.title')} placement="bottom" delay={800}>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={t('settings.doctor.entry.title')}
                onClick={handleDiagnosticsClick}
                className="flex h-8 w-8 items-center justify-center rounded-[8px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground dark:text-muted-foreground">
                <Stethoscope size={16} strokeWidth={1.8} />
              </Button>
            </Tooltip>
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
          </>
        ) : null}
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
  onFeedbackClick,
  onSettingsClick,
  onOverlayOpenChange
}: {
  layout: SidebarVisibleLayout
  onFeedbackClick: () => void
  onSettingsClick: () => void
  onOverlayOpenChange?: (open: boolean) => void
}) {
  const { t } = useTranslation()

  if (layout === 'icon') {
    return (
      <>
        <HelpMenu layout={layout} onFeedbackClick={onFeedbackClick} onOverlayOpenChange={onOverlayOpenChange} />
        <CommandTooltip command="app.settings.open" label={t('settings.title')} placement="right" delay={800}>
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
      </>
    )
  }

  return (
    <>
      <HelpMenu layout={layout} onFeedbackClick={onFeedbackClick} onOverlayOpenChange={onOverlayOpenChange} />
      <Button
        type="button"
        variant="ghost"
        aria-label={t('settings.title')}
        onClick={onSettingsClick}
        className="flex w-full items-center justify-start gap-2.5 rounded-lg px-2.5 py-1.75 text-[13px] text-foreground transition-colors hover:bg-accent/60">
        <Settings size={16} strokeWidth={1.6} />
        <span>{t('settings.title')}</span>
      </Button>
    </>
  )
}
