import { cacheService } from '@data/CacheService'
import { usePreference } from '@data/hooks/usePreference'
import { loggerService } from '@logger'
import { isMac } from '@renderer/config/constant'
import { isLocalAi } from '@renderer/config/env'
import { useTheme } from '@renderer/context/ThemeProvider'
import db from '@renderer/databases'
import { useAppUpdateHandler, useAppUpdateState } from '@renderer/hooks/useAppUpdate'
import i18n from '@renderer/i18n'
import KnowledgeQueue from '@renderer/queue/KnowledgeQueue'
import MemoryService from '@renderer/services/MemoryService'
import { useAppDispatch } from '@renderer/store'
import { useAppSelector } from '@renderer/store'
import { handleSaveData } from '@renderer/store'
import { selectMemoryConfig } from '@renderer/store/memory'
import { delay, runAsyncFunction } from '@renderer/utils'
import { checkDataLimit } from '@renderer/utils'
import { defaultLanguage } from '@shared/config/constant'
import { IpcChannel } from '@shared/IpcChannel'
import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect } from 'react'

import { useDefaultModel } from './useAssistant'
import useFullScreenNotice from './useFullScreenNotice'
import { useMinapps } from './useMinapps'
import { useNavbarPosition } from './useNavbar'
const logger = loggerService.withContext('useAppInit')

export function useAppInit() {
  const dispatch = useAppDispatch()
  const [language] = usePreference('app.language')
  const [windowStyle] = usePreference('ui.window_style')
  const [customCss] = usePreference('ui.custom_css')
  const [proxyUrl] = usePreference('app.proxy.url')
  const [proxyBypassRules] = usePreference('app.proxy.bypass_rules')
  const [autoCheckUpdate] = usePreference('app.dist.auto_update.enabled')
  const [proxyMode] = usePreference('app.proxy.mode')
  const [enableDataCollection] = usePreference('app.privacy.data_collection.enabled')

  const { isLeftNavbar } = useNavbarPosition()
  const { minappShow } = useMinapps()
  const { updateAppUpdateState } = useAppUpdateState()
  const { setDefaultModel, setQuickModel, setTranslateModel } = useDefaultModel()
  const savedAvatar = useLiveQuery(() => db.settings.get('image://avatar'))
  const { theme } = useTheme()
  const memoryConfig = useAppSelector(selectMemoryConfig)

  useEffect(() => {
    document.getElementById('spinner')?.remove()
    // eslint-disable-next-line no-restricted-syntax
    console.timeEnd('init')

    // Initialize MemoryService after app is ready
    MemoryService.getInstance()
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

  useAppUpdateHandler()
  useFullScreenNotice()

  useEffect(() => {
    savedAvatar?.value && cacheService.set('avatar', savedAvatar.value)
  }, [savedAvatar, dispatch])

  useEffect(() => {
    runAsyncFunction(async () => {
      const { isPackaged } = await window.api.getAppInfo()
      if (isPackaged && autoCheckUpdate) {
        await delay(2)
        const { updateInfo } = await window.api.checkForUpdate()
        updateAppUpdateState({ info: updateInfo })
      }
    })
  }, [autoCheckUpdate, updateAppUpdateState])

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
    i18n.changeLanguage(language || navigator.language || defaultLanguage)
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
      cacheService.set('filesPath', info.filesPath)
      cacheService.set('resourcesPath', info.resourcesPath)
    })
  }, [dispatch])

  useEffect(() => {
    KnowledgeQueue.checkAllBases()
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

  // Update memory service configuration when it changes
  useEffect(() => {
    const memoryService = MemoryService.getInstance()
    memoryService.updateConfig().catch((error) => {
      logger.error('Failed to update memory config:', error)
    })
  }, [memoryConfig])

  useEffect(() => {
    checkDataLimit()
  }, [])
}
