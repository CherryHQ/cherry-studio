import { isMac } from '@renderer/config/constant'
import { isLocalAi } from '@renderer/config/env'
import { useTheme } from '@renderer/context/ThemeProvider'
import db from '@renderer/databases'
import i18n, { setDayjsLocale } from '@renderer/i18n'
import { handleSaveData, useAppDispatch } from '@renderer/store'
import { setAvatar, setFilesPath, setResourcesPath, setUpdateState } from '@renderer/store/runtime'
import { delay, runAsyncFunction } from '@renderer/utils'
import { checkDataLimit } from '@renderer/utils'
import { defaultLanguage } from '@shared/config/constant'
import { IpcChannel } from '@shared/IpcChannel'
import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect } from 'react'

import { useDefaultModel } from './useAssistant'
import useFullScreenNotice from './useFullScreenNotice'
import { useRuntime } from './useRuntime'
import { useNavbarPosition, useSettings } from './useSettings'
import useUpdateHandler from './useUpdateHandler'

export function useAppInit() {
  const dispatch = useAppDispatch()
  const {
    proxyUrl,
    proxyBypassRules,
    language,
    windowStyle,
    autoCheckUpdate,
    proxyMode,
    customCss,
    enableDataCollection
  } = useSettings()
  const { isLeftNavbar } = useNavbarPosition()
  const { minappShow } = useRuntime()
  const { setDefaultModel, setQuickModel, setTranslateModel } = useDefaultModel()
  const avatar = useLiveQuery(() => db.settings.get('image://avatar'))
  const { theme } = useTheme()

  useEffect(() => {
    document.getElementById('spinner')?.remove()
    // eslint-disable-next-line no-restricted-syntax
    console.timeEnd('init')
  }, [])

  useEffect(() => {
    window.api.getDataPathFromArgs().then((dataPath) => {
      if (dataPath) {
        window.navigate('/settings/data', { replace: true })
      }
    })
  }, [])

  useEffect(() => {
    window.electron.ipcRenderer.on(IpcChannel.App_SaveData, async () => {
      await handleSaveData()
    })
  }, [])

  useUpdateHandler()
  useFullScreenNotice()

  useEffect(() => {
    avatar?.value && dispatch(setAvatar(avatar.value))
  }, [avatar, dispatch])

  useEffect(() => {
    const checkForUpdates = async () => {
      const { isPackaged } = await window.api.getAppInfo()

      if (!isPackaged || !autoCheckUpdate) {
        return
      }

      const { updateInfo } = await window.api.checkForUpdate()
      dispatch(setUpdateState({ info: updateInfo }))
    }

    // Initial check with delay
    runAsyncFunction(async () => {
      const { isPackaged } = await window.api.getAppInfo()
      if (isPackaged && autoCheckUpdate) {
        await delay(2)
        await checkForUpdates()
      }
    })

    // Set up 4-hour interval check
    const FOUR_HOURS = 4 * 60 * 60 * 1000
    const intervalId = setInterval(checkForUpdates, FOUR_HOURS)

    return () => clearInterval(intervalId)
  }, [dispatch, autoCheckUpdate])

  useEffect(() => {
    if (proxyMode === 'system') {
      window.api.setProxy('system', undefined)
    } else if (proxyMode === 'custom') {
      proxyUrl && window.api.setProxy(proxyUrl, proxyBypassRules)
    } else {
      // set proxy to none for direct mode
      window.api.setProxy('', undefined)
    }
  }, [proxyUrl, proxyMode, proxyBypassRules])

  useEffect(() => {
    const currentLanguage = language || navigator.language || defaultLanguage
    i18n.changeLanguage(currentLanguage)
    setDayjsLocale(currentLanguage)
  }, [language])

  useEffect(() => {
    const isMacTransparentWindow = windowStyle === 'transparent' && isMac

    if (minappShow && isLeftNavbar) {
      window.root.style.background = isMacTransparentWindow ? 'var(--color-background)' : 'var(--navbar-background)'
      return
    }

    window.root.style.background = isMacTransparentWindow ? 'var(--navbar-background-mac)' : 'var(--navbar-background)'
  }, [windowStyle, minappShow, theme, isLeftNavbar])

  useEffect(() => {
    if (isLocalAi) {
      const model = JSON.parse(import.meta.env.VITE_RENDERER_INTEGRATED_MODEL)
      setDefaultModel(model)
      setQuickModel(model)
      setTranslateModel(model)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    // set files path
    window.api.getAppInfo().then((info) => {
      dispatch(setFilesPath(info.filesPath))
      dispatch(setResourcesPath(info.resourcesPath))
    })
  }, [dispatch])

  useEffect(() => {}, [])

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

  useEffect(() => {
    checkDataLimit()
  }, [])
}
