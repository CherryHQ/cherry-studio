import AppLogo from '@renderer/assets/images/logo.png'
import { useMiniAppPopup } from '@renderer/hooks/useMiniAppPopup'
import { useTheme } from '@renderer/hooks/useTheme'
import { ipcApi } from '@renderer/ipc'
import { ThemeMode } from '@shared/data/preference/preferenceTypes'
import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'

export function useOpenReleaseNotes() {
  const { t } = useTranslation()
  const { theme } = useTheme()
  const { openSmartMiniApp } = useMiniAppPopup()

  return useCallback(async () => {
    const { appPath } = await ipcApi.request('app.get_info')
    openSmartMiniApp({
      appId: 'cherrystudio-releases',
      name: t('settings.about.releases.title'),
      url: `file://${appPath}/resources/cherry-studio/releases.html?theme=${theme === ThemeMode.dark ? 'dark' : 'light'}`,
      logo: AppLogo
    })
  }, [openSmartMiniApp, t, theme])
}
