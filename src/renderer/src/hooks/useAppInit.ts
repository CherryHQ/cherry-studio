import { loggerService } from '@logger'
import { isMac } from '@renderer/config/constant'
import { isLocalAi } from '@renderer/config/env'
import { useTheme } from '@renderer/context/ThemeProvider'
import db from '@renderer/databases'
import i18n, { setDayjsLocale } from '@renderer/i18n'
import KnowledgeQueue from '@renderer/queue/KnowledgeQueue'
import MemoryService from '@renderer/services/MemoryService'
import { handleSaveData, useAppDispatch, useAppSelector } from '@renderer/store'
import { selectMemoryConfig } from '@renderer/store/memory'
import { setAvatar, setFilesPath, setResourcesPath, setUpdateState } from '@renderer/store/runtime'
import {
  type ToolPermissionRequestPayload,
  type ToolPermissionResultPayload,
  toolPermissionsActions
} from '@renderer/store/toolPermissions'
import { delay, runAsyncFunction } from '@renderer/utils'
import { checkDataLimit } from '@renderer/utils'
import { defaultLanguage } from '@shared/config/constant'
import { IpcChannel } from '@shared/IpcChannel'
import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect } from 'react'
import React from 'react'
import { useTranslation } from 'react-i18next'

import { useDefaultModel } from './useAssistant'
import useFullScreenNotice from './useFullScreenNotice'
import { useRuntime } from './useRuntime'
import { useNavbarPosition, useSettings } from './useSettings'
import useUpdateHandler from './useUpdateHandler'

const logger = loggerService.withContext('useAppInit')

export function useAppInit() {
  const { t } = useTranslation()
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
    if (!window.electron?.ipcRenderer) return

    const requestListener = async (_event: Electron.IpcRendererEvent, payload: ToolPermissionRequestPayload) => {
      logger.debug('Renderer received tool permission request', {
        requestId: payload.requestId,
        toolName: payload.toolName,
        expiresAt: payload.expiresAt,
        suggestionCount: payload.suggestions.length,
        autoApprove: payload.autoApprove
      })

      if (payload.autoApprove) {
        logger.debug('Auto-approving tool permission request', {
          requestId: payload.requestId,
          toolName: payload.toolName
        })

        try {
          const response = await window.api.agentTools.respondToPermission({
            requestId: payload.requestId,
            behavior: 'allow',
            updatedInput: payload.input,
            updatedPermissions: payload.suggestions
          })

          if (!response?.success) {
            throw new Error('Auto-approval response rejected by main process')
          }

          logger.debug('Auto-approval acknowledged by main process', {
            requestId: payload.requestId,
            toolName: payload.toolName
          })
        } catch (error) {
          logger.error('Failed to send auto-approval response', error as Error)
          // Fall through to add to store for manual approval
          dispatch(toolPermissionsActions.requestReceived(payload))
        }
        return
      }

      dispatch(toolPermissionsActions.requestReceived(payload))
    }

    const resultListener = (_event: Electron.IpcRendererEvent, payload: ToolPermissionResultPayload) => {
      logger.debug('Renderer received tool permission result', {
        requestId: payload.requestId,
        behavior: payload.behavior,
        reason: payload.reason
      })
      dispatch(toolPermissionsActions.requestResolved(payload))

      if (payload.behavior === 'deny') {
        const message =
          payload.reason === 'timeout'
            ? (payload.message ?? t('agent.toolPermission.toast.timeout'))
            : (payload.message ?? t('agent.toolPermission.toast.denied'))

        if (payload.reason === 'no-window') {
          logger.debug('Displaying deny toast for tool permission', {
            requestId: payload.requestId,
            behavior: payload.behavior,
            reason: payload.reason
          })
          window.toast?.error?.(message)
        } else if (payload.reason === 'timeout') {
          logger.debug('Displaying timeout toast for tool permission', {
            requestId: payload.requestId
          })
          window.toast?.warning?.(message)
        } else {
          logger.debug('Displaying info toast for tool permission deny', {
            requestId: payload.requestId,
            reason: payload.reason
          })
          window.toast?.info?.(message)
        }
      }
    }

    // Define type for ExitPlanMode approval payload
    interface ExitPlanModeApprovalRequestPayload {
      requestId: string
      plan: string
      currentPermissionMode: string
      toolCallId: string
      createdAt: number
      expiresAt: number
    }

    // Listener for ExitPlanMode approval requests
    const exitPlanModeApprovalListener = async (
      _event: Electron.IpcRendererEvent,
      payload: ExitPlanModeApprovalRequestPayload
    ) => {
      logger.debug('Renderer received ExitPlanMode approval request', {
        requestId: payload.requestId,
        currentPermissionMode: payload.currentPermissionMode
      })

      // Use antd Modal directly to show the approval dialog
      const { Button } = await import('antd') // Dynamically import Button to avoid top-level import issues

      window.modal?.confirm?.({
        title: 'Approve Plan and Continue',
        width: 800,
        closable: true,
        maskClosable: false,
        content: React.createElement(
          'div',
          {},
          React.createElement(
            'p',
            {},
            'Current permission mode: ',
            React.createElement('strong', {}, payload.currentPermissionMode)
          ),
          React.createElement('p', { style: { fontWeight: 'bold' } }, 'Plan Details:'),
          React.createElement(
            'div',
            {
              style: {
                backgroundColor: '#f6f8fa',
                padding: '12px',
                borderRadius: '4px',
                maxHeight: '200px',
                overflowY: 'auto',
                marginBottom: '16px'
              }
            },
            React.createElement('pre', { style: { margin: 0, fontSize: '12px' } }, payload.plan)
          ),
          React.createElement('p', { style: { fontWeight: 'bold' } }, 'How would you like to proceed?')
        ),
        footer: [
          React.createElement(
            Button,
            {
              key: 'reject',
              onClick: async () => {
                try {
                  const response = await window.api.agentTools.respondToExitPlanModeApproval({
                    requestId: payload.requestId,
                    behavior: 'deny',
                    message: 'User rejected ExitPlanMode'
                  })

                  if (!response?.success) {
                    logger.error('ExitPlanMode rejection response rejected by main process')
                  }
                } catch (error) {
                  logger.error('Failed to send ExitPlanMode rejection response', error as Error)
                }
              }
            },
            '❌ No, enter something else'
          ),

          React.createElement(
            Button,
            {
              key: 'accept-default',
              onClick: async () => {
                try {
                  const response = await window.api.agentTools.respondToExitPlanModeApproval({
                    requestId: payload.requestId,
                    behavior: 'allow',
                    updatedInput: { targetMode: 'default' }
                  })

                  if (!response?.success) {
                    logger.error('ExitPlanMode approval response rejected by main process')
                  }
                } catch (error) {
                  logger.error('Failed to send ExitPlanMode approval response', error as Error)
                }
              }
            },
            '✅ Yes, manually approve'
          ),

          React.createElement(
            Button,
            {
              key: 'accept-edits',
              type: 'primary',
              onClick: async () => {
                try {
                  const response = await window.api.agentTools.respondToExitPlanModeApproval({
                    requestId: payload.requestId,
                    behavior: 'allow',
                    updatedInput: { targetMode: 'acceptEdits' }
                  })

                  if (!response?.success) {
                    logger.error('ExitPlanMode approval response rejected by main process')
                  }
                } catch (error) {
                  logger.error('Failed to send ExitPlanMode approval response', error as Error)
                }
              }
            },
            '✅ Yes, allow edits'
          )
        ]
      })
    }

    const removeListeners = [
      window.electron.ipcRenderer.on(IpcChannel.AgentToolPermission_Request, requestListener),
      window.electron.ipcRenderer.on(IpcChannel.AgentToolPermission_Result, resultListener),
      window.electron.ipcRenderer.on(IpcChannel.AgentExitPlanModeApproval_Request, exitPlanModeApprovalListener)
    ]

    // Return cleanup function that properly removes all listeners
    return () => {
      logger.debug('Cleaning up ExitPlanMode approval listeners', {
        listenerCount: removeListeners.length
      })
      removeListeners.forEach((removeListener) => removeListener())
    }
  }, [dispatch, t])

  useEffect(() => {
    // TODO: init data collection
  }, [enableDataCollection])

  // Update memory service configuration when it changes
  useEffect(() => {
    const memoryService = MemoryService.getInstance()
    memoryService.updateConfig().catch((error) => logger.error('Failed to update memory config:', error))
  }, [memoryConfig])

  useEffect(() => {
    checkDataLimit()
  }, [])
}
