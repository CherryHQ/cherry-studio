import { Tooltip } from '@cherrystudio/ui'
import { usePreference } from '@data/hooks/usePreference'
import { CommandTooltip } from '@renderer/components/command'
import SearchPopup from '@renderer/components/Popups/SearchPopup'
import type { SidebarVisibleLayout } from '@renderer/components/Sidebar/types'
import { isLinux, isWin } from '@renderer/config/constant'
import { useTheme } from '@renderer/context/ThemeProvider'
import { getThemeModeLabelKey } from '@renderer/i18n/label'
import { Monitor, Moon, Search, Settings, Sun } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import WindowControls from '../WindowControls'

export function useShellTabBarLayout() {
  const [useSystemTitleBar] = usePreference('app.use_system_title_bar')
  const hasWindowControls = isWin || (isLinux && !useSystemTitleBar)

  const rightPaddingClass = hasWindowControls ? 'pr-[184px]' : 'pr-[56px]'

  return {
    hasWindowControls,
    rightPaddingClass
  }
}

function useShellActionHandlers(onSettingsClick: () => void) {
  const { t } = useTranslation()
  const { settedTheme, toggleTheme } = useTheme()
  const ThemeIcon = settedTheme === 'dark' ? Moon : settedTheme === 'light' ? Sun : Monitor

  return { t, settedTheme, toggleTheme, ThemeIcon, handleSettingsClick: onSettingsClick }
}

export function ShellTabBarActions() {
  const { t } = useTranslation()
  const { hasWindowControls } = useShellTabBarLayout()

  const handleSearchClick = () => {
    void SearchPopup.show()
  }

  return (
    <div className="absolute top-0 right-0 flex h-full items-stretch">
      <div className="mr-2 flex items-center [-webkit-app-region:no-drag]">
        <div className="flex items-center gap-1 rounded-[10px] px-1 py-1">
          <CommandTooltip command="app.search" label={t('globalSearch.open')} placement="bottom" delay={800}>
            <button
              type="button"
              aria-label={t('globalSearch.open')}
              onClick={handleSearchClick}
              className="mr-1 flex h-8 w-8 items-center justify-center rounded-[8px] text-foreground/80 transition-colors hover:bg-[rgba(107,114,128,0.12)] hover:text-foreground">
              <Search size={16} strokeWidth={1.8} />
            </button>
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
  const { t, settedTheme, toggleTheme, ThemeIcon, handleSettingsClick } = useShellActionHandlers(onSettingsClick)

  if (layout === 'icon') {
    return (
      <>
        <Tooltip placement="right" content={t(getThemeModeLabelKey(settedTheme))} delay={800}>
          <button
            type="button"
            aria-label={t(getThemeModeLabelKey(settedTheme))}
            onClick={toggleTheme}
            className="flex h-9 w-9 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-accent/60 hover:text-foreground">
            <ThemeIcon size={18} strokeWidth={1.6} />
          </button>
        </Tooltip>
        <CommandTooltip command="app.settings.open" label={t('settings.title')} placement="right" delay={800}>
          <button
            type="button"
            aria-label={t('settings.title')}
            onClick={handleSettingsClick}
            className="flex h-9 w-9 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-accent/60 hover:text-foreground">
            <Settings size={18} strokeWidth={1.6} />
          </button>
        </CommandTooltip>
      </>
    )
  }

  return (
    <>
      <button
        type="button"
        aria-label={t(getThemeModeLabelKey(settedTheme))}
        onClick={toggleTheme}
        className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.75 text-[13px] text-muted-foreground transition-colors hover:bg-accent/60 hover:text-foreground">
        <ThemeIcon size={16} strokeWidth={1.6} />
        <span>{t(getThemeModeLabelKey(settedTheme))}</span>
      </button>
      <button
        type="button"
        aria-label={t('settings.title')}
        onClick={handleSettingsClick}
        className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.75 text-[13px] text-muted-foreground transition-colors hover:bg-accent/60 hover:text-foreground">
        <Settings size={16} strokeWidth={1.6} />
        <span>{t('settings.title')}</span>
      </button>
    </>
  )
}
