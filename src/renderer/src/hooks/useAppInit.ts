import { cacheService } from '@data/CacheService'
import { usePreference } from '@data/hooks/usePreference'
import { loggerService } from '@logger'
import { isMac } from '@renderer/config/constant'
import { isLocalAi } from '@renderer/config/env'
import { useTheme } from '@renderer/context/ThemeProvider'
import db from '@renderer/databases'
import { useAppUpdateHandler, useAppUpdateState } from '@renderer/hooks/useAppUpdate'
import i18n, { setDayjsLocale } from '@renderer/i18n'
import { knowledgeQueue } from '@renderer/queue/KnowledgeQueue'
import { memoryService } from '@renderer/services/MemoryService'
import type {
  ToolPermissionRequestPayload,
  ToolPermissionResultPayload
} from '@renderer/services/ToolPermissionsCacheService'
import { handleSaveData, useAppSelector } from '@renderer/store'
import { selectMemoryConfig } from '@renderer/store/memory'
import { delay, runAsyncFunction } from '@renderer/utils'
import { checkDataLimit } from '@renderer/utils'
import { sendToolApprovalNotification } from '@renderer/utils/userConfirmation'
import { defaultLanguage } from '@shared/config/constant'
import { IpcChannel } from '@shared/IpcChannel'
import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'

import { useDefaultModel } from './useAssistant'
import useFullScreenNotice from './useFullScreenNotice'
import { useMinapps } from './useMinapps'
import { useNavbarPosition } from './useNavbar'
const logger = loggerService.withContext('useAppInit')

export function useAppInit() {
  const { t } = useTranslation()
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

    // MemoryService is initialized at module level via export const
  }, [])

  useEffect(() => {
    void window.api.getDataPathFromArgs().then((dataPath) => {
      if (dataPath) {
        void window.navigate({ to: '/settings/data', replace: true })
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
    savedAvatar?.value && cacheService.set('app.user.avatar', savedAvatar.value)
  }, [savedAvatar])

  useEffect(() => {
    const checkForUpdates = async () => {
      const { isPackaged } = await window.api.getAppInfo()

      if (!isPackaged || !autoCheckUpdate) {
        return
      }

      const { updateInfo } = await window.api.checkForUpdate()
      updateAppUpdateState({ info: updateInfo })
    }

    // Initial check with delay
    void runAsyncFunction(async () => {
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
  }, [autoCheckUpdate, updateAppUpdateState])

  useEffect(() => {
    if (proxyMode === 'system') {
      void window.api.setProxy('system', undefined)
    } else if (proxyMode === 'custom') {
      void (proxyUrl && window.api.setProxy(proxyUrl, proxyBypassRules))
    } else {
      // set proxy to none for direct mode
      void window.api.setProxy('', undefined)
    }
  }, [proxyUrl, proxyMode, proxyBypassRules])

  useEffect(() => {
    const currentLanguage = language || navigator.language || defaultLanguage
    void i18n.changeLanguage(currentLanguage)
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
    void window.api.getAppInfo().then((info) => {
      cacheService.set('app.path.files', info.filesPath)
      cacheService.set('app.path.resources', info.resourcesPath)
    })
  }, [])

  useEffect(() => {
    void knowledgeQueue.checkAllBases()
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

  // Tool permission IPC listeners:
  // - Request: Main writes to SharedCache directly; renderer only handles system notification
  // - Result: Main updates SharedCache directly; renderer only handles toast UI
  useEffect(() => {
    if (!window.electron?.ipcRenderer) return

    const requestListener = (_event: Electron.IpcRendererEvent, payload: ToolPermissionRequestPayload) => {
      // Main process writes state to SharedCache; renderer only triggers system notification
      sendToolApprovalNotification(payload.toolName)
    }

    const resultListener = (_event: Electron.IpcRendererEvent, payload: ToolPermissionResultPayload) => {
      // Main process updates SharedCache; renderer only shows toast notifications
      if (payload.behavior === 'deny') {
        const message =
          payload.reason === 'timeout'
            ? (payload.message ?? t('agent.toolPermission.toast.timeout'))
            : (payload.message ?? t('agent.toolPermission.toast.denied'))

        if (payload.reason === 'no-window') {
          window.toast?.error?.(message)
        } else if (payload.reason === 'timeout') {
          window.toast?.warning?.(message)
        } else {
          window.toast?.info?.(message)
        }
      }
    }

    const removeListeners = [
      window.electron.ipcRenderer.on(IpcChannel.AgentToolPermission_Request, requestListener),
      window.electron.ipcRenderer.on(IpcChannel.AgentToolPermission_Result, resultListener)
    ]

    return () => removeListeners.forEach((removeListener) => removeListener())
  }, [t])

  useEffect(() => {
    // TODO: init data collection
  }, [enableDataCollection])

  // Update memory service configuration when it changes
  useEffect(() => {
    memoryService.updateConfig().catch((error) => logger.error('Failed to update memory config:', error))
  }, [memoryConfig])

  useEffect(() => {
    void checkDataLimit()
  }, [])
}
