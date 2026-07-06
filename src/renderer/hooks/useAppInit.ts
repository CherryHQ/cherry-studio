import { cacheService } from '@data/CacheService'
import { usePreference } from '@data/hooks/usePreference'
import db from '@renderer/databases'
import { useAppUpdateHandler } from '@renderer/hooks/useAppUpdate'
import { useStorageMonitorNotification } from '@renderer/hooks/useStorageMonitorNotification'
import i18n, { setDayjsLocale } from '@renderer/i18n'
import { navigationService } from '@renderer/services/NavigationService'
import { setInlineFilePathHomePath } from '@renderer/utils/filePath'
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
        void navigationService.navigate?.({ to: '/settings/data', replace: true })
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
    window.root.style.background = navBackgroundColor
  }, [navBackgroundColor])

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
