import i18n from '@renderer/i18n'
import { TTSService } from '@renderer/services/TTSService'
import { useAppDispatch, useAppSelector } from '@renderer/store'
import {
  addTTSProvider,
  removeTTSProvider,
  resetTTSSettings,
  setCurrentTTSProvider,
  setTTSAutoPlay,
  setTTSEnabled,
  setTTSProviderApiHost,
  setTTSProviderApiKey,
  setTTSProviderEnabled,
  updateTTSGlobalSettings,
  updateTTSProvider,
  updateTTSProviders,
  updateTTSProviderSettings,
  updateTTSProviderVoices
} from '@renderer/store/tts'
import { TTSProvider, TTSSpeakOptions } from '@renderer/types/tts'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

export const useTTS = () => {
  const dispatch = useAppDispatch()
  const ttsState = useAppSelector((state) => state.tts)
  const [ttsService] = useState(() => TTSService.getInstance())
  const lastProvidersRef = useRef<TTSProvider[]>([])
  const lastCurrentProviderRef = useRef<string | null>(null)

  // 获取当前供应商
  const currentProvider = useMemo(() => {
    return ttsState.providers.find((p) => p.id === ttsState.currentProvider)
  }, [ttsState.providers, ttsState.currentProvider])

  // 获取启用的供应商
  const enabledProviders = useMemo(() => {
    return ttsState.providers.filter((p) => p.enabled)
  }, [ttsState.providers])

  // 检查是否有可用的供应商
  const hasAvailableProvider = useMemo(() => {
    return enabledProviders.length > 0
  }, [enabledProviders])

  // 检查 TTS 是否可用
  const isTTSAvailable = useMemo(() => {
    const globalEnabled = ttsState.globalSettings.enabled
    const hasProvider = hasAvailableProvider
    const providerEnabled = currentProvider?.enabled

    return globalEnabled && hasProvider && providerEnabled
  }, [ttsState.globalSettings.enabled, hasAvailableProvider, currentProvider?.enabled])

  // 同步 Redux 状态到 TTS 服务
  useEffect(() => {
    console.log('[useTTS] useEffect triggered. Checking for provider changes.')
    const providersChanged = JSON.stringify(lastProvidersRef.current) !== JSON.stringify(ttsState.providers)

    if (providersChanged) {
      console.log('[useTTS] Provider config changed. Reloading TTSService.', {
        from: lastProvidersRef.current,
        to: ttsState.providers
      })
      ttsService.reloadProviders(ttsState.providers)
      lastProvidersRef.current = JSON.parse(JSON.stringify(ttsState.providers))
    } else {
      console.log('[useTTS] No provider config changes detected.')
    }
  }, [ttsService, ttsState.providers])

  // 单独处理当前供应商变化
  useEffect(() => {
    if (ttsState.currentProvider !== lastCurrentProviderRef.current) {
      if (ttsState.currentProvider) {
        ttsService.setCurrentProvider(ttsState.currentProvider)
      } else {
        ttsService.setCurrentProvider('')
      }
      lastCurrentProviderRef.current = ttsState.currentProvider
    }
  }, [ttsService, ttsState.currentProvider])

  // Actions
  const actions = {
    updateProvider: useCallback(
      (provider: TTSProvider) => {
        dispatch(updateTTSProvider(provider))
      },
      [dispatch]
    ),
    updateProviders: useCallback(
      (providers: TTSProvider[]) => {
        dispatch(updateTTSProviders(providers))
      },
      [dispatch]
    ),
    setCurrentProvider: useCallback(
      (providerId: string) => {
        dispatch(setCurrentTTSProvider(providerId))
      },
      [dispatch]
    ),
    setProviderEnabled: useCallback(
      (id: string, enabled: boolean) => {
        dispatch(setTTSProviderEnabled({ id, enabled }))
      },
      [dispatch]
    ),
    updateProviderSettings: useCallback(
      (id: string, settings: Partial<TTSProvider['settings']>) => {
        dispatch(updateTTSProviderSettings({ id, settings }))
      },
      [dispatch]
    ),
    setProviderApiKey: useCallback(
      (id: string, apiKey: string) => {
        dispatch(setTTSProviderApiKey({ id, apiKey }))
      },
      [dispatch]
    ),
    setProviderApiHost: useCallback(
      (id: string, apiHost: string) => {
        dispatch(setTTSProviderApiHost({ id, apiHost }))
      },
      [dispatch]
    ),
    updateProviderVoices: useCallback(
      (id: string, voices: TTSProvider['voices']) => {
        dispatch(updateTTSProviderVoices({ id, voices }))
      },
      [dispatch]
    ),
    setEnabled: useCallback(
      (enabled: boolean) => {
        dispatch(setTTSEnabled(enabled))
      },
      [dispatch]
    ),
    setAutoPlay: useCallback(
      (autoPlay: boolean) => {
        dispatch(setTTSAutoPlay(autoPlay))
      },
      [dispatch]
    ),
    updateGlobalSettings: useCallback(
      (settings: Partial<typeof ttsState.globalSettings>) => {
        dispatch(updateTTSGlobalSettings(settings))
      },
      [dispatch, ttsState]
    ),
    resetSettings: useCallback(() => {
      dispatch(resetTTSSettings())
    }, [dispatch]),
    addProvider: useCallback(
      (provider: TTSProvider) => {
        dispatch(addTTSProvider(provider))
      },
      [dispatch]
    ),
    removeProvider: useCallback(
      (id: string) => {
        dispatch(removeTTSProvider(id))
      },
      [dispatch]
    )
  }

  // TTS 操作
  const ttsOperations = {
    speak: useCallback(
      async (text: string, options?: Partial<TTSSpeakOptions>) => {
        if (!isTTSAvailable) {
          throw new Error('TTS is not available')
        }
        // 从 store 中获取最新的 provider 配置
        const currentProviderConfig = ttsState.providers.find((p) => p.id === ttsState.currentProvider)
        // 将最新的配置作为覆盖参数传递
        return ttsService.speak(text, options, currentProviderConfig)
      },
      [ttsService, isTTSAvailable, ttsState.providers, ttsState.currentProvider]
    ),
    pause: useCallback(() => {
      ttsService.pause()
    }, [ttsService]),
    resume: useCallback(() => {
      ttsService.resume()
    }, [ttsService]),
    stop: useCallback(() => {
      ttsService.stop()
    }, [ttsService]),
    stopAll: useCallback(() => {
      ttsService.stopAll()
    }, [ttsService]),
    isPlaying: useCallback(() => {
      return ttsService.isPlaying()
    }, [ttsService]),
    isPaused: useCallback(() => {
      return ttsService.isPaused()
    }, [ttsService]),
    getVoices: useCallback(
      async (providerId?: string) => {
        return ttsService.getVoices(providerId)
      },
      [ttsService]
    ),
    checkProvider: useCallback(
      async (providerId: string) => {
        return ttsService.checkProvider(providerId)
      },
      [ttsService]
    ),
    selectBestProvider: useCallback(async () => {
      return ttsService.selectBestProvider()
    }, [ttsService])
  }

  // 获取国际化的提供商名称
  const getTTSProviderName = useCallback((provider: TTSProvider) => {
    if (provider.isSystem) {
      return i18n.t(`settings.tts.providers.${provider.type}`, { defaultValue: provider.name })
    }
    return provider.name
  }, [])

  return {
    ...ttsState,
    currentProvider,
    enabledProviders,
    hasAvailableProvider,
    isTTSAvailable,
    ...actions,
    ...ttsOperations,
    ttsService,
    getTTSProviderName
  }
}

export default useTTS
