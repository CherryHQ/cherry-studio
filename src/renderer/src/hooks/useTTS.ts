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

// TTS Hook
//
// A hook to manage TTS state and operations.
// @returns TTS state and actions
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
    const providersChanged = JSON.stringify(lastProvidersRef.current) !== JSON.stringify(ttsState.providers)

    if (providersChanged) {
      ttsService.reloadProviders(ttsState.providers)
      lastProvidersRef.current = JSON.parse(JSON.stringify(ttsState.providers))
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
    // 更新供应商
    updateProvider: useCallback(
      (provider: TTSProvider) => {
        dispatch(updateTTSProvider(provider))
      },
      [dispatch]
    ),
    // 批量更新供应商
    updateProviders: useCallback(
      (providers: TTSProvider[]) => {
        dispatch(updateTTSProviders(providers))
      },
      [dispatch]
    ),
    // 设置当前供应商
    setCurrentProvider: useCallback(
      (providerId: string) => {
        dispatch(setCurrentTTSProvider(providerId))
      },
      [dispatch]
    ),
    // 启用/禁用供应商
    setProviderEnabled: useCallback(
      (id: string, enabled: boolean) => {
        dispatch(setTTSProviderEnabled({ id, enabled }))
      },
      [dispatch]
    ),
    // 更新供应商设置
    updateProviderSettings: useCallback(
      (id: string, settings: Partial<TTSProvider['settings']>) => {
        dispatch(updateTTSProviderSettings({ id, settings }))
      },
      [dispatch]
    ),
    // 设置 API Key
    setProviderApiKey: useCallback(
      (id: string, apiKey: string) => {
        dispatch(setTTSProviderApiKey({ id, apiKey }))
      },
      [dispatch]
    ),
    // 设置 API Host
    setProviderApiHost: useCallback(
      (id: string, apiHost: string) => {
        dispatch(setTTSProviderApiHost({ id, apiHost }))
      },
      [dispatch]
    ),
    // 更新语音列表
    updateProviderVoices: useCallback(
      (id: string, voices: TTSProvider['voices']) => {
        dispatch(updateTTSProviderVoices({ id, voices }))
      },
      [dispatch]
    ),
    // 设置全局启用状态
    setEnabled: useCallback(
      (enabled: boolean) => {
        dispatch(setTTSEnabled(enabled))
      },
      [dispatch]
    ),
    // 设置自动播放
    setAutoPlay: useCallback(
      (autoPlay: boolean) => {
        dispatch(setTTSAutoPlay(autoPlay))
      },
      [dispatch]
    ),
    // 更新全局设置
    updateGlobalSettings: useCallback(
      (settings: Partial<typeof ttsState.globalSettings>) => {
        dispatch(updateTTSGlobalSettings(settings))
      },
      [dispatch, ttsState]
    ),
    // 重置设置
    resetSettings: useCallback(() => {
      dispatch(resetTTSSettings())
    }, [dispatch]),
    // 添加供应商
    addProvider: useCallback(
      (provider: TTSProvider) => {
        dispatch(addTTSProvider(provider))
      },
      [dispatch]
    ),
    // 删除供应商
    removeProvider: useCallback(
      (id: string) => {
        dispatch(removeTTSProvider(id))
      },
      [dispatch]
    )
  }

  // TTS 操作
  const ttsOperations = {
    // 语音合成
    speak: useCallback(
      async (options: TTSSpeakOptions) => {
        // 检查是否有 providerOverride，或者全局 TTS 是否可用
        if (!options.providerOverride && !isTTSAvailable) {
          throw new Error('TTS is not available')
        }

        // 优先使用 options 中直接传递的 providerOverride
        if (options.providerOverride) {
          return ttsService.speak(options.text, options, options.providerOverride)
        }

        // 降级到使用全局当前的 provider
        const currentProviderConfig = ttsState.providers.find((p) => p.id === ttsState.currentProvider)
        return ttsService.speak(options.text, options, currentProviderConfig)
      },
      [ttsService, isTTSAvailable, ttsState.providers, ttsState.currentProvider]
    ),

    // 暂停播放
    pause: useCallback(() => {
      ttsService.pause()
    }, [ttsService]),
    // 恢复播放
    resume: useCallback(() => {
      ttsService.resume()
    }, [ttsService]),
    // 停止播放
    stop: useCallback(() => {
      ttsService.stop()
    }, [ttsService]),
    // 停止所有正在播放的 TTS
    stopAll: useCallback(() => {
      ttsService.stopAll()
    }, [ttsService]),
    // 检查是否正在播放
    isPlaying: useCallback(() => {
      return ttsService.isPlaying()
    }, [ttsService]),
    // 检查是否已暂停
    isPaused: useCallback(() => {
      return ttsService.isPaused()
    }, [ttsService]),
    // 获取指定供应商的语音列表
    getVoices: useCallback(
      async (providerId?: string) => {
        return ttsService.getVoices(providerId)
      },
      [ttsService]
    ),
    // 检查供应商配置
    checkProvider: useCallback(
      async (providerId: string) => {
        return ttsService.checkProvider(providerId)
      },
      [ttsService]
    ),
    // 自动选择最佳供应商
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
