import { Tooltip } from '@cherrystudio/ui'
import { usePreference } from '@data/hooks/usePreference'
import { isLinux, isWin } from '@renderer/config/constant'
import { useTheme } from '@renderer/context/ThemeProvider'
import { useTabs } from '@renderer/hooks/useTabs'
import { getThemeModeLabel } from '@renderer/i18n/label'
import { openSettingsWindow } from '@renderer/services/SettingsWindowService'
import { getDefaultRouteTitle } from '@renderer/utils/routeTitle'
import { Monitor, Moon, Settings, Sun } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import WindowControls from '../WindowControls'

export function useShellTabBarLayout(isDetached: boolean) {
  const [useSystemTitleBar] = usePreference('app.use_system_title_bar')
  const hasWindowControls = isWin || (isLinux && !useSystemTitleBar)

  const rightPaddingClass = isDetached
    ? hasWindowControls
      ? 'pr-36'
      : 'pr-4'
    : hasWindowControls
      ? 'pr-[212px]'
      : 'pr-[84px]'

  return {
    hasWindowControls,
    rightPaddingClass
  }
}

export function ShellTabBarActions({ isDetached = false }: { isDetached?: boolean }) {
  const { t } = useTranslation()
  const { settedTheme, toggleTheme } = useTheme()
  const { hasWindowControls } = useShellTabBarLayout(isDetached)
  const { openTab } = useTabs()
  const [settingsOpenTarget] = usePreference('app.settings.open_target')

  const ThemeIcon = settedTheme === 'dark' ? Moon : settedTheme === 'light' ? Sun : Monitor

  const handleSettingsClick = () => {
    if (settingsOpenTarget === 'app') {
      openTab('/settings/provider', { title: getDefaultRouteTitle('/settings/provider') })
      return
    }

    void openSettingsWindow('/settings/provider')
  }

  return (
    <div className="absolute top-0 right-0 flex h-full items-stretch">
      {!isDetached && (
        <div className="mr-2 flex items-center [-webkit-app-region:no-drag]">
          <div className="flex items-center gap-1 rounded-[10px] px-1 py-1">
            <Tooltip placement="bottom" content={getThemeModeLabel(settedTheme)} delay={800}>
              <button
                type="button"
                onClick={toggleTheme}
                className="flex h-8 w-8 items-center justify-center rounded-[8px] text-foreground/80 transition-colors hover:bg-[rgba(107,114,128,0.12)] hover:text-foreground">
                <ThemeIcon size={16} strokeWidth={1.8} />
              </button>
            </Tooltip>
            <Tooltip placement="bottom" content={t('settings.title')} delay={800}>
              <button
                type="button"
                onClick={handleSettingsClick}
                className="flex h-8 w-8 items-center justify-center rounded-[8px] text-foreground/80 transition-colors hover:bg-[rgba(107,114,128,0.12)] hover:text-foreground">
                <Settings size={16} strokeWidth={1.8} />
              </button>
            </Tooltip>
          </div>
        </div>
      )}

      {hasWindowControls && <WindowControls />}
    </div>
  )
}
