import { cacheService } from '@data/CacheService'
import { usePreference } from '@data/hooks/usePreference'
import { setInlineFilePathHomePath } from '@renderer/components/chat/messages/utils/filePath'
import db from '@renderer/databases'
import { useAppUpdateHandler } from '@renderer/hooks/useAppUpdate'
import useMacTransparentWindow from '@renderer/hooks/useMacTransparentWindow'
import { useStorageMonitorNotification } from '@renderer/hooks/useStorageMonitorNotification'
import i18n, { setDayjsLocale } from '@renderer/i18n'
import { defaultLanguage } from '@shared/utils/languages'
import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect } from 'react'

import useFullScreenNotice from './useFullScreenNotice'
import useNavBackgroundColor from './useNavBackgroundColor'

export function useAppInit() {
  const [language] = usePreference('app.language')
  const [customCss] = usePreference('ui.custom_css')
  const [enableDataCollection] = usePreference('app.privacy.data_collection.enabled')

  const savedAvatar = useLiveQuery(() => db.settings.get('image://avatar'))
  const navBackgroundColor = useNavBackgroundColor()
  const isMacTransparentWindow = useMacTransparentWindow()

  useEffect(() => {
    document.getElementById('spinner')?.remove()
    // Paired with `console.time('init')` in index.html's bootstrap script.
    // Both run in the browser console for dev DX (DevTools timer); the
    // timing isn't useful for production logs, so loggerService is not
    // appropriate here.
    // eslint-disable-next-line no-restricted-syntax
    console.timeEnd('init')
  }, [])

  useEffect(() => {
    void window.api.getDataPathFromArgs().then((dataPath) => {
      if (dataPath) {
        void window.navigate({ to: '/settings/data', replace: true })
      }
    })
  }, [])

  // [v2] Removed: Redux persistor flush is no longer needed after v2 data refactoring
  // useEffect(() => {
  //   window.electron.ipcRenderer.on(IpcChannel.App_SaveData, async () => {
  //     await handleSaveData()
  //   })
  // }, [])

  useAppUpdateHandler()
  useFullScreenNotice()
  useStorageMonitorNotification()

  useEffect(() => {
    savedAvatar?.value && cacheService.set('app.user.avatar', savedAvatar.value)
  }, [savedAvatar])

  useEffect(() => {
    const currentLanguage = language || navigator.language || defaultLanguage
    void i18n.changeLanguage(currentLanguage)
    setDayjsLocale(currentLanguage)
  }, [language])

  useEffect(() => {
    // In mac transparent mode the shell owns the wash (sidebar tint while the
    // window is key, opaque sidebar when blurred — see AppShell); #root stays
    // transparent so the native vibrancy can show through the tint.
    window.root.style.background = isMacTransparentWindow ? 'transparent' : navBackgroundColor
  }, [isMacTransparentWindow, navBackgroundColor])

  useEffect(() => {
    // set app paths
    void window.api.getAppInfo().then((info) => {
      setInlineFilePathHomePath(info.homePath)
      cacheService.set('app.path.resources', info.resourcesPath)
    })
  }, [])

  useEffect(() => {
    let customCssElement = document.getElementById('user-defined-custom-css') as HTMLStyleElement
    if (customCssElement) {
      customCssElement.remove()
    }

    if (customCss) {
      customCssElement = document.createElement('style')
      customCssElement.id = 'user-defined-custom-css'
      customCssElement.textContent = customCss
      document.head.appendChild(customCssElement)
    }
  }, [customCss])

  useEffect(() => {
    // TODO: init data collection
  }, [enableDataCollection])
}
