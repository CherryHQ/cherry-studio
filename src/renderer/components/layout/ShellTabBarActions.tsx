import { Tooltip } from '@cherrystudio/ui'
import { usePreference } from '@data/hooks/usePreference'
import { loggerService } from '@logger'
import SearchPopup from '@renderer/components/Popups/SearchPopup'
import { isLinux, isWin } from '@renderer/config/constant'
import { useTheme } from '@renderer/context/ThemeProvider'
import { CommandTooltip } from '@renderer/features/command'
import { getThemeModeLabelKey } from '@renderer/i18n/label'
import { openSettingsWindow } from '@renderer/services/SettingsWindowService'
import { formatErrorMessage } from '@renderer/utils/error'
import { Monitor, Moon, Search, Settings, Sun } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import WindowControls from '../WindowControls'

const logger = loggerService.withContext('ShellTabBarActions')

export function useShellTabBarLayout() {
  const [useSystemTitleBar] = usePreference('app.use_system_title_bar')
  const hasWindowControls = isWin || (isLinux && !useSystemTitleBar)

  const rightPaddingClass = hasWindowControls ? 'pr-[248px]' : 'pr-[120px]'

  return {
    hasWindowControls,
    rightPaddingClass
  }
}

export function ShellTabBarActions() {
  const { t } = useTranslation()
  const { settedTheme, toggleTheme } = useTheme()
  const { hasWindowControls } = useShellTabBarLayout()

  const ThemeIcon = settedTheme === 'dark' ? Moon : settedTheme === 'light' ? Sun : Monitor

  const handleSearchClick = () => {
    void SearchPopup.show()
  }

  const handleSettingsClick = async () => {
    const settingsPath = '/settings/provider'

    try {
      await openSettingsWindow(settingsPath)
    } catch (error) {
      logger.error('Failed to open settings', error as Error)
      window.toast.error({ title: t('common.error'), description: formatErrorMessage(error) })
    }
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
              className="flex h-8 w-8 items-center justify-center rounded-[8px] text-foreground/80 transition-colors hover:bg-[rgba(107,114,128,0.12)] hover:text-foreground">
              <Search size={16} strokeWidth={1.8} />
            </button>
          </CommandTooltip>
          <Tooltip placement="bottom" content={t(getThemeModeLabelKey(settedTheme))} delay={800}>
            <button
              type="button"
              aria-label={t(getThemeModeLabelKey(settedTheme))}
              onClick={toggleTheme}
              className="flex h-8 w-8 items-center justify-center rounded-[8px] text-foreground/80 transition-colors hover:bg-[rgba(107,114,128,0.12)] hover:text-foreground">
              <ThemeIcon size={16} strokeWidth={1.8} />
            </button>
          </Tooltip>
          <CommandTooltip command="app.settings.open" label={t('settings.title')} placement="bottom" delay={800}>
            <button
              type="button"
              aria-label={t('settings.title')}
              onClick={handleSettingsClick}
              className="flex h-8 w-8 items-center justify-center rounded-[8px] text-foreground/80 transition-colors hover:bg-[rgba(107,114,128,0.12)] hover:text-foreground">
              <Settings size={16} strokeWidth={1.8} />
            </button>
          </CommandTooltip>
        </div>
      </div>

      {hasWindowControls && <WindowControls />}
    </div>
  )
}
