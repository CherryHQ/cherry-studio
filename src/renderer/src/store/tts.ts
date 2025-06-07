import { createSlice, PayloadAction } from '@reduxjs/toolkit'
import { INITIAL_TTS_PROVIDERS } from '@renderer/config/tts'
import { TTSProvider, TTSState } from '@renderer/types/tts'

console.log('[TTS Store] Initializing with providers:', INITIAL_TTS_PROVIDERS.length)

const initialState: TTSState = {
  providers: INITIAL_TTS_PROVIDERS,
  currentProvider: 'web-speech', // 默认使用 Web Speech API
  globalSettings: {
    enabled: true, // 默认启用 TTS
    autoPlay: false
  }
}

const ttsSlice = createSlice({
  name: 'tts',
  initialState,
  reducers: {
    // 更新 TTS 供应商
    updateTTSProvider: (state, action: PayloadAction<TTSProvider>) => {
      console.log('[TTS Store] updateTTSProvider:', action.payload.id)
      const index = state.providers.findIndex((p) => p.id === action.payload.id)
      if (index !== -1) {
        state.providers[index] = action.payload
      }
    },

    // 批量更新 TTS 供应商
    updateTTSProviders: (state, action: PayloadAction<TTSProvider[]>) => {
      state.providers = action.payload
    },

    // 设置当前 TTS 供应商
    setCurrentTTSProvider: (state, action: PayloadAction<string>) => {
      const provider = state.providers.find((p) => p.id === action.payload)
      if (provider) {
        state.currentProvider = action.payload
      }
    },

    // 启用/禁用 TTS 供应商
    setTTSProviderEnabled: (state, action: PayloadAction<{ id: string; enabled: boolean }>) => {
      console.log('[TTS Store] setTTSProviderEnabled:', action.payload)
      const provider = state.providers.find((p) => p.id === action.payload.id)
      if (provider) {
        if (action.payload.enabled) {
          // 启用新供应商时，先禁用所有其他供应商
          console.log('[TTS Store] Enabling provider, disabling others')
          state.providers.forEach((p) => {
            if (p.id !== action.payload.id) {
              p.enabled = false
            }
          })
          // 启用当前供应商
          provider.enabled = true
          // 设为当前供应商
          state.currentProvider = action.payload.id
          console.log('[TTS Store] Set current provider to:', action.payload.id)
        } else {
          // 禁用供应商
          provider.enabled = false
          console.log('[TTS Store] Disabled provider:', action.payload.id)

          // 如果禁用的是当前供应商，清除当前供应商
          if (state.currentProvider === action.payload.id) {
            // 查找其他启用的供应商
            const enabledProvider = state.providers.find((p) => p.id !== action.payload.id && p.enabled)
            if (enabledProvider) {
              state.currentProvider = enabledProvider.id
              console.log('[TTS Store] Switched to enabled provider:', enabledProvider.id)
            } else {
              // 如果没有其他启用的供应商，清除当前供应商
              state.currentProvider = null
              console.log('[TTS Store] No enabled providers, cleared current provider')
            }
          }
        }
      }
    },

    // 更新 TTS 供应商设置
    updateTTSProviderSettings: (
      state,
      action: PayloadAction<{ id: string; settings: Partial<TTSProvider['settings']> }>
    ) => {
      const provider = state.providers.find((p) => p.id === action.payload.id)
      if (provider) {
        provider.settings = { ...provider.settings, ...action.payload.settings }
      }
    },

    // 更新 TTS 供应商 API Key
    setTTSProviderApiKey: (state, action: PayloadAction<{ id: string; apiKey: string }>) => {
      const provider = state.providers.find((p) => p.id === action.payload.id)
      if (provider) {
        provider.apiKey = action.payload.apiKey
      }
    },

    // 更新 TTS 供应商 API Host
    setTTSProviderApiHost: (state, action: PayloadAction<{ id: string; apiHost: string }>) => {
      const provider = state.providers.find((p) => p.id === action.payload.id)
      if (provider) {
        provider.apiHost = action.payload.apiHost
      }
    },

    // 更新 TTS 供应商语音列表
    updateTTSProviderVoices: (state, action: PayloadAction<{ id: string; voices: TTSProvider['voices'] }>) => {
      const provider = state.providers.find((p) => p.id === action.payload.id)
      if (provider) {
        provider.voices = action.payload.voices
      }
    },

    // 设置全局 TTS 启用状态
    setTTSEnabled: (state, action: PayloadAction<boolean>) => {
      state.globalSettings.enabled = action.payload
    },

    // 设置全局自动播放
    setTTSAutoPlay: (state, action: PayloadAction<boolean>) => {
      state.globalSettings.autoPlay = action.payload
    },

    // 更新全局设置
    updateTTSGlobalSettings: (state, action: PayloadAction<Partial<TTSState['globalSettings']>>) => {
      state.globalSettings = { ...state.globalSettings, ...action.payload }
    },

    // 重置 TTS 设置到默认值
    resetTTSSettings: (state) => {
      state.providers = INITIAL_TTS_PROVIDERS
      state.currentProvider = 'web-speech'
      state.globalSettings = {
        enabled: true, // 修复：重置时也应该启用 TTS
        autoPlay: false
      }
    },

    // 添加新的 TTS 供应商（用于自定义供应商）
    addTTSProvider: (state, action: PayloadAction<TTSProvider>) => {
      const exists = state.providers.find((p) => p.id === action.payload.id)
      if (!exists) {
        state.providers.push(action.payload)
      }
    },

    // 删除 TTS 供应商（仅限非系统供应商）
    removeTTSProvider: (state, action: PayloadAction<string>) => {
      const provider = state.providers.find((p) => p.id === action.payload)
      if (provider && !provider.isSystem) {
        state.providers = state.providers.filter((p) => p.id !== action.payload)

        // 如果删除的是当前供应商，切换到第一个启用的供应商
        if (state.currentProvider === action.payload) {
          const enabledProvider = state.providers.find((p) => p.enabled)
          state.currentProvider = enabledProvider?.id || null
        }
      }
    }
  }
})

export const {
  updateTTSProvider,
  updateTTSProviders,
  setCurrentTTSProvider,
  setTTSProviderEnabled,
  updateTTSProviderSettings,
  setTTSProviderApiKey,
  setTTSProviderApiHost,
  updateTTSProviderVoices,
  setTTSEnabled,
  setTTSAutoPlay,
  updateTTSGlobalSettings,
  resetTTSSettings,
  addTTSProvider,
  removeTTSProvider
} = ttsSlice.actions

export default ttsSlice.reducer
