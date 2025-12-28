/**
 * @deprecated Scheduled for removal in v2.0.0
 * --------------------------------------------------------------------------
 * ⚠️ NOTICE: V2 DATA&UI REFACTORING (by 0xfullex)
 * --------------------------------------------------------------------------
 * STOP: Feature PRs affecting this file are currently BLOCKED.
 * Only critical bug fixes are accepted during this migration phase.
 *
 * This file is being refactored to v2 standards.
 * Any non-critical changes will conflict with the ongoing work.
 *
 * 🔗 Context & Status:
 * - Contribution Hold: https://github.com/CherryHQ/cherry-studio/issues/10954
 * - v2 Refactor PR   : https://github.com/CherryHQ/cherry-studio/pull/10162
 * --------------------------------------------------------------------------
 */
import type { PayloadAction } from '@reduxjs/toolkit'
import { createSlice } from '@reduxjs/toolkit'
import { isLocalAi } from '@renderer/config/env'
import { SYSTEM_MODELS } from '@renderer/config/models'
import { SYSTEM_PROVIDERS } from '@renderer/config/providers'
import type { AwsBedrockAuthType, Model, Provider } from '@renderer/types'
import { uniqBy } from 'lodash'

type LlmSettings = {
  ollama: {
    keepAliveTime: number
  }
  lmstudio: {
    keepAliveTime: number
  }
  gpustack: {
    keepAliveTime: number
  }
  vertexai: {
    serviceAccount: {
      privateKey: string
      clientEmail: string
    }
    projectId: string
    location: string
  }
  awsBedrock: {
    authType: AwsBedrockAuthType
    accessKeyId: string
    secretAccessKey: string
    apiKey: string
    region: string
  }
}

export interface LlmState {
  providers: Provider[]
  defaultModel: Model
  /** @deprecated */
  topicNamingModel: Model
  quickModel: Model
  translateModel: Model
  quickAssistantId: string
  settings: LlmSettings
}

export const initialState: LlmState = {
  defaultModel: SYSTEM_MODELS.defaultModel[0],
  topicNamingModel: SYSTEM_MODELS.defaultModel[1],
  quickModel: SYSTEM_MODELS.defaultModel[1],
  translateModel: SYSTEM_MODELS.defaultModel[2],
  quickAssistantId: '',
  providers: SYSTEM_PROVIDERS,
  settings: {
    ollama: {
      keepAliveTime: 0
    },
    lmstudio: {
      keepAliveTime: 0
    },
    gpustack: {
      keepAliveTime: 0
    },
    vertexai: {
      serviceAccount: {
        privateKey: '',
        clientEmail: ''
      },
      projectId: '',
      location: ''
    },
    awsBedrock: {
      authType: 'iam',
      accessKeyId: '',
      secretAccessKey: '',
      apiKey: '',
      region: ''
    }
  }
}

// 由于 isLocalAi 目前总是为false，该函数暂未被使用
// 需要投入使用时，应当保证返回值类型满足 LlmState 要求，而不是使用类型断言
const getIntegratedInitialState = () => {
  const model = JSON.parse(import.meta.env.VITE_RENDERER_INTEGRATED_MODEL)

  return {
    defaultModel: model,
    quickModel: model,
    translateModel: model,
    providers: [
      {
        id: 'ollama',
        name: 'Ollama',
        apiKey: 'ollama',
        apiHost: 'http://localhost:15537/v1/',
        models: [model],
        isSystem: true,
        enabled: true
      }
    ],
    settings: {
      ollama: {
        keepAliveTime: 3600
      },
      lmstudio: {
        keepAliveTime: 3600
      },
      gpustack: {
        keepAliveTime: 3600
      }
    }
  } as LlmState
}

export const moveProvider = (providers: Provider[], id: string, position: number) => {
  const index = providers.findIndex((p) => p.id === id)
  if (index === -1) return providers

  const provider = providers[index]
  const newProviders = [...providers]
  newProviders.splice(index, 1)
  newProviders.splice(position - 1, 0, provider)
  return newProviders
}

const llmSlice = createSlice({
  name: 'llm',
  initialState: isLocalAi ? getIntegratedInitialState() : initialState,
  reducers: {
    updateProvider: (state, action: PayloadAction<Partial<Provider> & { id: string }>) => {
      const index = state.providers.findIndex((p) => p.id === action.payload.id)
      if (index !== -1) {
        Object.assign(state.providers[index], action.payload)
      }
    },
    updateProviders: (state, action: PayloadAction<Provider[]>) => {
      state.providers = action.payload
    },
    addProvider: (state, action: PayloadAction<Provider>) => {
      state.providers.unshift(action.payload)
    },
    removeProvider: (state, action: PayloadAction<Provider>) => {
      const providerIndex = state.providers.findIndex((p) => p.id === action.payload.id)
      if (providerIndex !== -1) {
        state.providers.splice(providerIndex, 1)
      }
    },
    addModel: (state, action: PayloadAction<{ providerId: string; model: Model }>) => {
      state.providers = state.providers.map((p) =>
        p.id === action.payload.providerId
          ? {
              ...p,
              models: uniqBy(p.models.concat(action.payload.model), 'id'),
              enabled: true
            }
          : p
      )
    },
    removeModel: (state, action: PayloadAction<{ providerId: string; model: Model }>) => {
      state.providers = state.providers.map((p) =>
        p.id === action.payload.providerId
          ? {
              ...p,
              models: p.models.filter((m) => m.id !== action.payload.model.id)
            }
          : p
      )
    },
    setDefaultModel: (state, action: PayloadAction<{ model: Model }>) => {
      state.defaultModel = action.payload.model
    },
    setQuickModel: (state, action: PayloadAction<{ model: Model }>) => {
      state.quickModel = action.payload.model
    },
    setTranslateModel: (state, action: PayloadAction<{ model: Model }>) => {
      state.translateModel = action.payload.model
    },

    setQuickAssistantId: (state, action: PayloadAction<string>) => {
      state.quickAssistantId = action.payload
    },
    setOllamaKeepAliveTime: (state, action: PayloadAction<number>) => {
      state.settings.ollama.keepAliveTime = action.payload
    },
    setLMStudioKeepAliveTime: (state, action: PayloadAction<number>) => {
      state.settings.lmstudio.keepAliveTime = action.payload
    },
    setGPUStackKeepAliveTime: (state, action: PayloadAction<number>) => {
      state.settings.gpustack.keepAliveTime = action.payload
    },
    setVertexAIProjectId: (state, action: PayloadAction<string>) => {
      state.settings.vertexai.projectId = action.payload
    },
    setVertexAILocation: (state, action: PayloadAction<string>) => {
      state.settings.vertexai.location = action.payload
    },
    setVertexAIServiceAccountPrivateKey: (state, action: PayloadAction<string>) => {
      state.settings.vertexai.serviceAccount.privateKey = action.payload
    },
    setVertexAIServiceAccountClientEmail: (state, action: PayloadAction<string>) => {
      state.settings.vertexai.serviceAccount.clientEmail = action.payload
    },
    setAwsBedrockAuthType: (state, action: PayloadAction<AwsBedrockAuthType>) => {
      state.settings.awsBedrock.authType = action.payload
    },
    setAwsBedrockAccessKeyId: (state, action: PayloadAction<string>) => {
      state.settings.awsBedrock.accessKeyId = action.payload
    },
    setAwsBedrockSecretAccessKey: (state, action: PayloadAction<string>) => {
      state.settings.awsBedrock.secretAccessKey = action.payload
    },
    setAwsBedrockApiKey: (state, action: PayloadAction<string>) => {
      state.settings.awsBedrock.apiKey = action.payload
    },
    setAwsBedrockRegion: (state, action: PayloadAction<string>) => {
      state.settings.awsBedrock.region = action.payload
    },
    updateModel: (
      state,
      action: PayloadAction<{
        providerId: string
        model: Model
      }>
    ) => {
      const provider = state.providers.find((p) => p.id === action.payload.providerId)
      if (provider) {
        const modelIndex = provider.models.findIndex((m) => m.id === action.payload.model.id)
        if (modelIndex !== -1) {
          provider.models[modelIndex] = action.payload.model
        }
      }
    }
  }
})

export const {
  updateProvider,
  updateProviders,
  addProvider,
  removeProvider,
  addModel,
  removeModel,
  setDefaultModel,
  setQuickModel,
  setTranslateModel,
  setQuickAssistantId,
  setOllamaKeepAliveTime,
  setLMStudioKeepAliveTime,
  setGPUStackKeepAliveTime,
  setVertexAIProjectId,
  setVertexAILocation,
  setVertexAIServiceAccountPrivateKey,
  setVertexAIServiceAccountClientEmail,
  setAwsBedrockAuthType,
  setAwsBedrockAccessKeyId,
  setAwsBedrockSecretAccessKey,
  setAwsBedrockApiKey,
  setAwsBedrockRegion,
  updateModel
} = llmSlice.actions

export default llmSlice.reducer
