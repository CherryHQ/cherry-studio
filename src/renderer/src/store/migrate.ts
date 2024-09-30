import { SYSTEM_MODELS } from '@renderer/config/models'
import i18n from '@renderer/i18n'
import { Assistant } from '@renderer/types'
import { isEmpty } from 'lodash'
import { createMigrate } from 'redux-persist'

import { RootState } from '.'

const migrateConfig = {
  '2': (state: RootState) => {
    return {
      ...state,
      llm: {
        ...state.llm,
        providers: [
          ...state.llm.providers,
          {
            id: 'yi',
            name: 'Yi',
            apiKey: '',
            apiHost: 'https://api.lingyiwanwu.com',
            isSystem: true,
            models: SYSTEM_MODELS.yi
          }
        ]
      }
    }
  },
  '3': (state: RootState) => {
    return {
      ...state,
      llm: {
        ...state.llm,
        providers: [
          ...state.llm.providers,
          {
            id: 'zhipu',
            name: 'ZhiPu',
            apiKey: '',
            apiHost: 'https://open.bigmodel.cn/api/paas/v4/',
            isSystem: true,
            models: SYSTEM_MODELS.zhipu
          }
        ]
      }
    }
  },
  '4': (state: RootState) => {
    return {
      ...state,
      llm: {
        ...state.llm,
        providers: [
          ...state.llm.providers,
          {
            id: 'ollama',
            name: 'Ollama',
            apiKey: '',
            apiHost: 'http://localhost:11434/v1/',
            isSystem: true,
            models: []
          }
        ]
      }
    }
  },
  '5': (state: RootState) => {
    return {
      ...state,
      llm: {
        ...state.llm,
        providers: [
          ...state.llm.providers,
          {
            id: 'moonshot',
            name: 'Moonshot',
            apiKey: '',
            apiHost: 'https://api.moonshot.cn',
            isSystem: true,
            models: SYSTEM_MODELS.moonshot
          }
        ]
      }
    }
  },
  '6': (state: RootState) => {
    return {
      ...state,
      llm: {
        ...state.llm,
        providers: [
          ...state.llm.providers,
          {
            id: 'openrouter',
            name: 'OpenRouter',
            apiKey: '',
            apiHost: 'https://openrouter.ai/api/v1/',
            models: SYSTEM_MODELS.openrouter,
            isSystem: true
          }
        ]
      }
    }
  },
  '7': (state: RootState) => {
    return {
      ...state,
      settings: {
        ...state.settings,
        language: navigator.language
      }
    }
  },
  '8': (state: RootState) => {
    const fixAssistantName = (assistant: Assistant) => {
      if (isEmpty(assistant.name)) {
        assistant.name = i18n.t(`assistant.${assistant.id}.name`)
      }

      assistant.topics = assistant.topics.map((topic) => {
        if (isEmpty(topic.name)) {
          topic.name = i18n.t(`assistant.${assistant.id}.topic.name`)
        }
        return topic
      })

      return assistant
    }

    return {
      ...state,
      assistants: {
        ...state.assistants,
        defaultAssistant: fixAssistantName(state.assistants.defaultAssistant),
        assistants: state.assistants.assistants.map((assistant) => fixAssistantName(assistant))
      }
    }
  },
  '9': (state: RootState) => {
    return {
      ...state,
      llm: {
        ...state.llm,
        providers: state.llm.providers.map((provider) => {
          if (provider.id === 'zhipu' && provider.models[0] && provider.models[0].id === 'llama3-70b-8192') {
            provider.models = SYSTEM_MODELS.zhipu
          }
          return provider
        })
      }
    }
  },
  '10': (state: RootState) => {
    return {
      ...state,
      llm: {
        ...state.llm,
        providers: [
          ...state.llm.providers,
          {
            id: 'baichuan',
            name: 'BAICHUAN AI',
            apiKey: '',
            apiHost: 'https://api.baichuan-ai.com',
            models: SYSTEM_MODELS.baichuan,
            isSystem: true,
            enabled: false
          }
        ]
      }
    }
  },
  '11': (state: RootState) => {
    return {
      ...state,
      llm: {
        ...state.llm,
        providers: [
          ...state.llm.providers,
          {
            id: 'dashscope',
            name: 'DashScope',
            apiKey: '',
            apiHost: 'https://dashscope.aliyuncs.com/compatible-mode/v1/',
            models: SYSTEM_MODELS.dashscope,
            isSystem: true,
            enabled: false
          },
          {
            id: 'anthropic',
            name: 'Anthropic',
            apiKey: '',
            apiHost: 'https://api.anthropic.com/',
            models: SYSTEM_MODELS.anthropic,
            isSystem: true,
            enabled: false
          }
        ]
      }
    }
  },
  '12': (state: RootState) => {
    return {
      ...state,
      llm: {
        ...state.llm,
        providers: [
          ...state.llm.providers,
          {
            id: 'aihubmix',
            name: 'AiHubMix',
            apiKey: '',
            apiHost: 'https://aihubmix.com',
            models: SYSTEM_MODELS.aihubmix,
            isSystem: true,
            enabled: false
          }
        ]
      }
    }
  },
  '13': (state: RootState) => {
    return {
      ...state,
      assistants: {
        ...state.assistants,
        defaultAssistant: {
          ...state.assistants.defaultAssistant,
          name: ['Default Assistant', '默认助手'].includes(state.assistants.defaultAssistant.name)
            ? i18n.t(`assistant.default.name`)
            : state.assistants.defaultAssistant.name
        }
      }
    }
  },
  '14': (state: RootState) => {
    return {
      ...state,
      settings: {
        ...state.settings,
        showAssistants: true,
        proxyUrl: undefined
      }
    }
  },
  '15': (state: RootState) => {
    return {
      ...state,
      settings: {
        ...state.settings,
        userName: '',
        showMessageDivider: true
      }
    }
  },
  '16': (state: RootState) => {
    return {
      ...state,
      settings: {
        ...state.settings,
        messageFont: 'system',
        showInputEstimatedTokens: false
      }
    }
  },
  '17': (state: RootState) => {
    return {
      ...state,
      settings: {
        ...state.settings,
        theme: 'auto'
      }
    }
  },
  '19': (state: RootState) => {
    return {
      ...state,
      agents: {
        agents: []
      },
      llm: {
        ...state.llm,
        settings: {
          ollama: {
            keepAliveTime: 5
          }
        }
      }
    }
  },
  '20': (state: RootState) => {
    return {
      ...state,
      settings: {
        ...state.settings,
        fontSize: 14
      }
    }
  },
  '21': (state: RootState) => {
    return {
      ...state,
      llm: {
        ...state.llm,
        providers: [
          ...state.llm.providers,
          {
            id: 'gemini',
            name: 'Gemini',
            apiKey: '',
            apiHost: 'https://generativelanguage.googleapis.com',
            models: SYSTEM_MODELS.gemini,
            isSystem: true,
            enabled: false
          },
          {
            id: 'stepfun',
            name: 'StepFun',
            apiKey: '',
            apiHost: 'https://api.stepfun.com',
            models: SYSTEM_MODELS.stepfun,
            isSystem: true,
            enabled: false
          },
          {
            id: 'doubao',
            name: 'doubao',
            apiKey: '',
            apiHost: 'https://ark.cn-beijing.volces.com/api/v3/',
            models: SYSTEM_MODELS.doubao,
            isSystem: true,
            enabled: false
          },
          {
            id: 'graphrag-kylin-mountain',
            name: 'GraphRAG',
            apiKey: '',
            apiHost: '',
            models: [],
            isSystem: true,
            enabled: false
          }
        ]
      }
    }
  },
  '22': (state: RootState) => {
    return {
      ...state,
      llm: {
        ...state.llm,
        providers: [
          ...state.llm.providers,
          {
            id: 'minimax',
            name: 'MiniMax',
            apiKey: '',
            apiHost: 'https://api.minimax.chat/v1/',
            models: SYSTEM_MODELS.minimax,
            isSystem: true,
            enabled: false
          }
        ]
      }
    }
  },
  '23': (state: RootState) => {
    return {
      ...state,
      settings: {
        ...state.settings,
        showTopics: true,
        windowStyle: 'transparent'
      }
    }
  },
  '24': (state: RootState) => {
    return {
      ...state,
      assistants: {
        ...state.assistants,
        assistants: state.assistants.assistants.map((assistant) => ({
          ...assistant,
          topics: assistant.topics.map((topic) => ({
            ...topic,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
          }))
        }))
      },
      settings: {
        ...state.settings,
        topicPosition: 'right'
      }
    }
  },
  '25': (state: RootState) => {
    return {
      ...state,
      llm: {
        ...state.llm,
        providers: [
          ...state.llm.providers,
          {
            id: 'github',
            name: 'Github Models',
            apiKey: '',
            apiHost: 'https://models.inference.ai.azure.com/',
            models: SYSTEM_MODELS.github,
            isSystem: true,
            enabled: false
          }
        ]
      }
    }
  },
  '26': (state: RootState) => {
    return {
      ...state,
      llm: {
        ...state.llm,
        providers: [
          ...state.llm.providers,
          {
            id: 'ocoolai',
            name: 'ocoolAI',
            apiKey: '',
            apiHost: 'https://one.ooo.cool',
            models: [],
            isSystem: true,
            enabled: false
          }
        ]
      }
    }
  },
  '27': (state: RootState) => {
    return {
      ...state,
      settings: {
        ...state.settings,
        renderInputMessageAsMarkdown: true
      }
    }
  },
  '28': (state: RootState) => {
    return {
      ...state,
      llm: {
        ...state.llm,
        providers: [
          ...state.llm.providers,
          {
            id: 'together',
            name: 'Together',
            apiKey: '',
            apiHost: 'https://api.together.xyz',
            models: [],
            isSystem: true,
            enabled: false
          }
        ]
      }
    }
  },
  '29': (state: RootState) => {
    return {
      ...state,
      llm: {
        ...state.llm,
        providers: [
          ...state.llm.providers,
          {
            id: 'fireworks',
            name: 'Fireworks',
            apiKey: '',
            apiHost: 'https://api.fireworks.ai/inference',
            models: [],
            isSystem: true,
            enabled: false
          }
        ]
      }
    }
  },
  '30': (state: RootState) => {
    return {
      ...state,
      llm: {
        ...state.llm,
        providers: [
          ...state.llm.providers,
          {
            id: 'zhinao',
            name: 'zhinao',
            apiKey: '',
            apiHost: 'https://api.360.cn',
            models: [],
            isSystem: true,
            enabled: false
          }
        ]
      }
    }
  },
  '31': (state: RootState) => {
    return {
      ...state,
      llm: {
        ...state.llm,
        providers: [
          ...state.llm.providers,
          {
            id: 'nvidia',
            name: 'nvidia',
            apiKey: '',
            apiHost: 'https://integrate.api.nvidia.com',
            models: [],
            isSystem: true,
            enabled: false
          }
        ]
      }
    }
  }
}

const migrate = createMigrate(migrateConfig as any)

export default migrate
