import { Tooltip } from '@cherrystudio/ui'
import { usePreference } from '@data/hooks/usePreference'
import { CommandTooltip } from '@renderer/components/command'
import SearchPopup from '@renderer/components/Popups/SearchPopup'
import type { SidebarVisibleLayout } from '@renderer/components/Sidebar/types'
import { useTheme } from '@renderer/hooks/useTheme'
import { getThemeModeLabelKey } from '@renderer/i18n/label'
import { isLinux, isWin } from '@renderer/utils/platform'
import { Monitor, Moon, Search, Settings, Sun } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import WindowControls from '../WindowControls'

const logger = loggerService.withContext('ShellTabBarActions')

export function useShellTabBarLayout(isDetached: boolean) {
  const [useSystemTitleBar] = usePreference('app.use_system_title_bar')
  const hasWindowControls = isWin || (isLinux && !useSystemTitleBar)

  const rightPaddingClass = isDetached
    ? hasWindowControls
      ? 'pe-36'
      : 'pe-4'
    : hasWindowControls
      ? 'pe-[212px]'
      : 'pe-[84px]'

  return {
    hasWindowControls,
    rightPaddingClass
  }
}

export function ShellTabBarActions({ isDetached = false }: { isDetached?: boolean }) {
  const { t } = useTranslation()
  const { settedTheme, toggleTheme } = useTheme()
  const { hasWindowControls } = useShellTabBarLayout(isDetached)

  const ThemeIcon = settedTheme === 'dark' ? Moon : settedTheme === 'light' ? Sun : Monitor

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
    <div className="absolute end-0 top-0 flex h-full items-stretch">
      {!isDetached && (
        <div className="me-2 flex items-center [-webkit-app-region:no-drag]">
          <div className="flex items-center gap-1 rounded-[10px] px-1 py-1">
            <Tooltip placement="bottom" content={t(getThemeModeLabelKey(settedTheme))} delay={800}>
              <button
                type="button"
                aria-label={t(getThemeModeLabelKey(settedTheme))}
                onClick={toggleTheme}
                className="flex h-8 w-8 items-center justify-center rounded-[8px] text-foreground/80 transition-colors hover:bg-[rgba(107,114,128,0.12)] hover:text-foreground">
                <ThemeIcon size={16} strokeWidth={1.8} />
              </button>
            </Tooltip>
            <button
              type="button"
              aria-label={t('settings.title')}
              onClick={handleSettingsClick}
              className="flex h-8 w-8 items-center justify-center rounded-[8px] text-foreground/80 transition-colors hover:bg-[rgba(107,114,128,0.12)] hover:text-foreground">
              <Settings size={16} strokeWidth={1.8} />
            </button>
          </div>
        </div>
      )}

      {hasWindowControls && <WindowControls />}
    </div>
  )
}
