import { Button } from '@cherrystudio/ui'
import { usePreference } from '@data/hooks/usePreference'
import { CommandTooltip } from '@renderer/components/command'
import GlobalSearchPopup from '@renderer/components/GlobalSearch/GlobalSearchPopup'
import type { SidebarVisibleLayout } from '@renderer/components/Sidebar'
import { isLinux, isWin } from '@renderer/utils/platform'
import { Search, Settings } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { WindowControls } from '../WindowControls'

export function useShellTabBarLayout() {
  const [useSystemTitleBar] = usePreference('app.use_system_title_bar')
  const hasWindowControls = isWin || (isLinux && !useSystemTitleBar)

  // Extra ~16px over the action cluster's own width leaves a draggable gap between the
  // last tab / "+" button and the right-side buttons, so the window stays easy to grab-move (Chrome-style).
  const rightPaddingClass = hasWindowControls ? 'pr-[200px]' : 'pr-[72px]'

  return {
    hasWindowControls,
    rightPaddingClass
  }
}

export function ShellTabBarActions() {
  const { t } = useTranslation()
  const { hasWindowControls } = useShellTabBarLayout()

  const handleSearchClick = () => {
    void GlobalSearchPopup.show()
  }

  return (
    <div className="absolute top-0 right-0 flex h-full items-stretch">
      <div className="mr-2 flex items-center [-webkit-app-region:no-drag]">
        <div className="flex items-center gap-1 rounded-[10px] px-1 py-1">
          <CommandTooltip command="app.search" label={t('globalSearch.open')} placement="bottom" delay={800}>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label={t('globalSearch.open')}
              onClick={handleSearchClick}
              className="mr-1 flex h-8 w-8 items-center justify-center rounded-[8px] text-foreground/80 transition-colors hover:bg-[rgba(107,114,128,0.12)] hover:text-foreground">
              <Search size={16} strokeWidth={1.8} />
            </Button>
          </CommandTooltip>
        </div>
      </div>

      {hasWindowControls && <WindowControls />}
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
      <CommandTooltip command="app.settings.open" label={t('settings.title')} placement="right" delay={800}>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label={t('settings.title')}
          onClick={onSettingsClick}
          className="flex h-9 w-9 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-accent/60 hover:text-foreground dark:text-muted-foreground dark:hover:text-foreground">
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
      className="flex w-full items-center justify-start gap-2.5 rounded-lg px-2.5 py-1.75 text-[13px] text-foreground transition-colors hover:bg-accent/60 dark:text-foreground">
      <Settings size={16} strokeWidth={1.6} />
      <span>{t('settings.title')}</span>
    </Button>
  )
}
