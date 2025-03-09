import { isMac } from '@renderer/config/constant'
import { isLocalAi } from '@renderer/config/env'
import db from '@renderer/databases'
import i18n from '@renderer/i18n'
import { useAppDispatch } from '@renderer/store'
import { initializeMessagesState } from '@renderer/store/messages'
import { setAvatar, setFilesPath, setResourcesPath, setUpdateState } from '@renderer/store/runtime'
import { delay, runAsyncFunction } from '@renderer/utils'
import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect } from 'react'

import { useDefaultModel } from './useAssistant'
import useFullScreenNotice from './useFullScreenNotice'
import { useRuntime } from './useRuntime'
import { useSettings } from './useSettings'
import useUpdateHandler from './useUpdateHandler'

export function useAppInit() {
  const dispatch = useAppDispatch()
  const { proxyUrl, language, windowStyle, manualUpdateCheck, proxyMode, customCss } = useSettings()
  const { minappShow } = useRuntime()
  const { setDefaultModel, setTopicNamingModel, setTranslateModel } = useDefaultModel()
  const avatar = useLiveQuery(() => db.settings.get('image://avatar'))

  useUpdateHandler()

  useFullScreenNotice()

  // Initialize messages state
  useEffect(() => {
    dispatch(initializeMessagesState())
  }, [dispatch])

  useEffect(() => {
    avatar?.value && dispatch(setAvatar(avatar.value))
  }, [avatar, dispatch])

  useEffect(() => {
    document.getElementById('spinner')?.remove()
    runAsyncFunction(async () => {
      const { isPackaged } = await window.api.getAppInfo()
      if (isPackaged && !manualUpdateCheck) {
        await delay(2)
        const { updateInfo } = await window.api.checkForUpdate()
        dispatch(setUpdateState({ info: updateInfo }))
      }
    })
  }, [dispatch, manualUpdateCheck])

  useEffect(() => {
    if (proxyMode === 'system') {
      window.api.setProxy('system')
    } else if (proxyMode === 'custom') {
      proxyUrl && window.api.setProxy(proxyUrl)
    } else {
      window.api.setProxy('')
    }
  }, [proxyUrl, proxyMode])

  useEffect(() => {
    i18n.changeLanguage(language || navigator.language || 'en-US')
  }, [language])

  useEffect(() => {
    const transparentWindow = windowStyle === 'transparent' && isMac && !minappShow
    window.root.style.background = transparentWindow ? 'var(--navbar-background-mac)' : 'var(--navbar-background)'
  }, [windowStyle, minappShow])

  useEffect(() => {
    if (isLocalAi) {
      const model = JSON.parse(import.meta.env.VITE_RENDERER_INTEGRATED_MODEL)
      setDefaultModel(model)
      setTopicNamingModel(model)
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

  useEffect(() => {
    import('@renderer/queue/KnowledgeQueue')
  }, [])

  useEffect(() => {
    const oldCustomCss = document.getElementById('user-defined-custom-css')
    if (oldCustomCss) {
      oldCustomCss.remove()
    }

    if (customCss) {
      const style = document.createElement('style')
      style.id = 'user-defined-custom-css'
      style.textContent = customCss
      document.head.appendChild(style)
    }
  }, [customCss])
}
