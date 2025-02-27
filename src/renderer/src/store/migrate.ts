import { isMac } from '@renderer/config/constant'
import { DEFAULT_MIN_APPS } from '@renderer/config/minapps'
import { SYSTEM_MODELS } from '@renderer/config/models'
import { TRANSLATE_PROMPT } from '@renderer/config/prompts'
import db from '@renderer/databases'
import i18n from '@renderer/i18n'
import { Assistant } from '@renderer/types'
import { getDefaultGroupName, getLeadingEmoji, runAsyncFunction, uuid } from '@renderer/utils'
import { isEmpty } from 'lodash'
import { createMigrate } from 'redux-persist'

import { RootState } from '.'
import { DEFAULT_SIDEBAR_ICONS } from './settings'

// remove logo base64 data to reduce the size of the state
function removeMiniAppIconsFromState(state: RootState) {
  if (state.minapps) {
    state.minapps.enabled = state.minapps.enabled.map((app) => ({ ...app, logo: undefined }))
    state.minapps.disabled = state.minapps.disabled.map((app) => ({ ...app, logo: undefined }))
    state.minapps.pinned = state.minapps.pinned.map((app) => ({ ...app, logo: undefined }))
  }
}

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
            apiHost: 'http://localhost:11434',
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
            models: SYSTEM_MODELS.bailian,
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
            models: SYSTEM_MODELS.together,
            isSystem: true,
            enabled: false
          },
          {
            id: 'fireworks',
            name: 'Fireworks',
            apiKey: '',
            apiHost: 'https://api.fireworks.ai/inference',
            models: SYSTEM_MODELS.fireworks,
            isSystem: true,
            enabled: false
          },
          {
            id: 'zhinao',
            name: 'zhinao',
            apiKey: '',
            apiHost: 'https://api.360.cn',
            models: SYSTEM_MODELS.zhinao,
            isSystem: true,
            enabled: false
          },
          {
            id: 'hunyuan',
            name: 'hunyuan',
            apiKey: '',
            apiHost: 'https://api.hunyuan.cloud.tencent.com',
            models: SYSTEM_MODELS.hunyuan,
            isSystem: true,
            enabled: false
          },
          {
            id: 'nvidia',
            name: 'Nvidia',
            apiKey: '',
            apiHost: 'https://integrate.api.nvidia.com',
            models: SYSTEM_MODELS.nvidia,
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
      assistants: {
        ...state.assistants,
        assistants: state.assistants.assistants.map((assistant) => {
          assistant.topics = assistant.topics.map((topic) => ({
            ...topic,
            assistantId: assistant.id
          }))
          return assistant
        })
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
            id: 'azure-openai',
            name: 'Azure OpenAI',
            apiKey: '',
            apiHost: '',
            apiVersion: '',
            models: SYSTEM_MODELS['azure-openai'],
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
        providers: state.llm.providers.map((provider) => {
          if (provider.id === 'azure-openai') {
            provider.models = provider.models.map((model) => ({ ...model, provider: 'azure-openai' }))
          }
          return provider
        })
      }
    }
  },
  '32': (state: RootState) => {
    return {
      ...state,
      llm: {
        ...state.llm,
        providers: [
          ...state.llm.providers,
          {
            id: 'hunyuan',
            name: 'Hunyuan',
            apiKey: '',
            apiHost: 'https://api.hunyuan.cloud.tencent.com',
            models: SYSTEM_MODELS.hunyuan,
            isSystem: true,
            enabled: false
          }
        ]
      }
    }
  },
  '33': (state: RootState) => {
    state.assistants.defaultAssistant.type = 'assistant'

    state.agents.agents.forEach((agent) => {
      agent.type = 'agent'
      // @ts-ignore eslint-disable-next-line
      delete agent.group
    })

    return {
      ...state,
      assistants: {
        ...state.assistants,
        assistants: [...state.assistants.assistants].map((assistant) => {
          // @ts-ignore eslint-disable-next-line
          delete assistant.group
          return {
            ...assistant,
            id: assistant.id.length === 36 ? assistant.id : uuid(),
            type: assistant.type === 'system' ? assistant.type : 'assistant'
          }
        })
      }
    }
  },
  '34': (state: RootState) => {
    state.assistants.assistants.forEach((assistant) => {
      assistant.topics.forEach((topic) => {
        topic.assistantId = assistant.id
        runAsyncFunction(async () => {
          const _topic = await db.topics.get(topic.id)
          if (_topic) {
            const messages = (_topic?.messages || []).map((message) => ({ ...message, assistantId: assistant.id }))
            db.topics.put({ ..._topic, messages }, topic.id)
          }
        })
      })
    })
    return state
  },
  '35': (state: RootState) => {
    state.settings.mathEngine = 'KaTeX'
    return state
  },
  '36': (state: RootState) => {
    state.settings.topicPosition = 'left'
    return state
  },
  '37': (state: RootState) => {
    state.settings.messageStyle = 'plain'
    return state
  },
  '38': (state: RootState) => {
    return {
      ...state,
      llm: {
        ...state.llm,
        providers: [
          ...state.llm.providers,
          {
            id: 'grok',
            name: 'Grok',
            apiKey: '',
            apiHost: 'https://api.x.ai',
            models: SYSTEM_MODELS.grok,
            isSystem: true,
            enabled: false
          },
          {
            id: 'hyperbolic',
            name: 'Hyperbolic',
            apiKey: '',
            apiHost: 'https://api.hyperbolic.xyz',
            models: SYSTEM_MODELS.hyperbolic,
            isSystem: true,
            enabled: false
          },
          {
            id: 'mistral',
            name: 'Mistral',
            apiKey: '',
            apiHost: 'https://api.mistral.ai',
            models: SYSTEM_MODELS.mistral,
            isSystem: true,
            enabled: false
          }
        ]
      }
    }
  },
  '39': (state: RootState) => {
    state.settings.codeStyle = 'auto'
    return state
  },
  '40': (state: RootState) => {
    state.settings.tray = true
    return state
  },
  '41': (state: RootState) => {
    state.llm.providers.forEach((provider) => {
      if (provider.id === 'gemini') {
        provider.type = 'gemini'
      } else if (provider.id === 'anthropic') {
        provider.type = 'anthropic'
      } else {
        provider.type = 'openai'
      }
    })
    return state
  },
  '42': (state: RootState) => {
    state.settings.proxyMode = state.settings.proxyUrl ? 'custom' : 'none'
    return state
  },
  '43': (state: RootState) => {
    if (state.settings.proxyMode === 'none') {
      state.settings.proxyMode = 'system'
    }
    return state
  },
  '44': (state: RootState) => {
    state.settings.translateModelPrompt = TRANSLATE_PROMPT
    return state
  },
  '45': (state: RootState) => {
    state.settings.enableTopicNaming = true
    return state
  },
  '46': (state: RootState) => {
    if (
      state.settings?.translateModelPrompt?.includes(
        'If the target language is the same as the source language, do not translate'
      )
    ) {
      state.settings.translateModelPrompt = TRANSLATE_PROMPT
    }
    return state
  },
  '47': (state: RootState) => {
    state.llm.providers.forEach((provider) => {
      provider.models.forEach((model) => {
        model.group = getDefaultGroupName(model.id)
      })
    })
    return state
  },
  '48': (state: RootState) => {
    if (state.shortcuts) {
      state.shortcuts.shortcuts.forEach((shortcut) => {
        shortcut.system = shortcut.key !== 'new_topic'
      })
      state.shortcuts.shortcuts.push({
        key: 'toggle_show_assistants',
        shortcut: [isMac ? 'Command' : 'Ctrl', '['],
        editable: true,
        enabled: true,
        system: false
      })
      state.shortcuts.shortcuts.push({
        key: 'toggle_show_topics',
        shortcut: [isMac ? 'Command' : 'Ctrl', ']'],
        editable: true,
        enabled: true,
        system: false
      })
    }
    return state
  },
  '49': (state: RootState) => {
    state.settings.pasteLongTextThreshold = 1500
    if (state.shortcuts) {
      state.shortcuts.shortcuts = [
        ...state.shortcuts.shortcuts,
        {
          key: 'copy_last_message',
          shortcut: [isMac ? 'Command' : 'Ctrl', 'Shift', 'C'],
          editable: true,
          enabled: false,
          system: false
        }
      ]
    }
    return state
  },
  '50': (state: RootState) => {
    state.llm.providers.push({
      id: 'jina',
      name: 'Jina',
      type: 'openai',
      apiKey: '',
      apiHost: 'https://api.jina.ai',
      models: SYSTEM_MODELS.jina,
      isSystem: true,
      enabled: false
    })
    return state
  },
  '51': (state: RootState) => {
    state.settings.topicNamingPrompt = ''
    return state
  },
  '54': (state: RootState) => {
    if (state.shortcuts) {
      state.shortcuts.shortcuts.push({
        key: 'search_message',
        shortcut: [isMac ? 'Command' : 'Ctrl', 'F'],
        editable: true,
        enabled: true,
        system: false
      })
    }
    state.settings.sidebarIcons = {
      visible: DEFAULT_SIDEBAR_ICONS,
      disabled: []
    }
    return state
  },
  '55': (state: RootState) => {
    if (!state.settings.sidebarIcons) {
      state.settings.sidebarIcons = {
        visible: DEFAULT_SIDEBAR_ICONS,
        disabled: []
      }
    }
    return state
  },
  '56': (state: RootState) => {
    state.llm.providers.push({
      id: 'qwenlm',
      name: 'QwenLM',
      type: 'qwenlm',
      apiKey: '',
      apiHost: 'https://chat.qwenlm.ai/api/',
      models: SYSTEM_MODELS.qwenlm,
      isSystem: true,
      enabled: false
    })
    return state
  },
  '57': (state: RootState) => {
    if (state.shortcuts) {
      state.shortcuts.shortcuts.push({
        key: 'mini_window',
        shortcut: [isMac ? 'Command' : 'Ctrl', 'E'],
        editable: true,
        enabled: false,
        system: true
      })
    }

    removeMiniAppIconsFromState(state)

    state.llm.providers.forEach((provider) => {
      if (provider.id === 'qwenlm') {
        provider.type = 'qwenlm'
      }
    })

    state.settings.enableQuickAssistant = false
    state.settings.clickTrayToShowQuickAssistant = true

    return state
  },
  '58': (state: RootState) => {
    if (state.shortcuts) {
      state.shortcuts.shortcuts.push(
        {
          key: 'clear_topic',
          shortcut: [isMac ? 'Command' : 'Ctrl', 'L'],
          editable: true,
          enabled: true,
          system: false
        },
        {
          key: 'toggle_new_context',
          shortcut: [isMac ? 'Command' : 'Ctrl', 'R'],
          editable: true,
          enabled: true,
          system: false
        }
      )
    }
    return state
  },
  '59': (state: RootState) => {
    if (state.minapps) {
      const flowith = DEFAULT_MIN_APPS.find((app) => app.id === 'flowith')
      if (flowith) {
        state.minapps.enabled.push(flowith)
      }
    }
    removeMiniAppIconsFromState(state)
    return state
  },
  '60': (state: RootState) => {
    state.settings.multiModelMessageStyle = 'fold'
    return state
  },
  '61': (state: RootState) => {
    state.llm.providers.forEach((provider) => {
      if (provider.id === 'qwenlm') {
        provider.type = 'qwenlm'
      }
    })
    return state
  },
  '62': (state: RootState) => {
    state.llm.providers.forEach((provider) => {
      if (provider.id === 'azure-openai') {
        provider.type = 'azure-openai'
      }
    })
    state.settings.translateModelPrompt = TRANSLATE_PROMPT
    return state
  },
  '63': (state: RootState) => {
    if (state.minapps) {
      const mintop = DEFAULT_MIN_APPS.find((app) => app.id === '3mintop')
      if (mintop) {
        state.minapps.enabled.push(mintop)
      }
    }
    return state
  },
  '64': (state: RootState) => {
    state.llm.providers = state.llm.providers.filter((provider) => provider.id !== 'qwenlm')
    state.llm.providers.push({
      id: 'baidu-cloud',
      name: 'Baidu Cloud',
      type: 'openai',
      apiKey: '',
      apiHost: 'https://qianfan.baidubce.com/v2/',
      models: SYSTEM_MODELS['baidu-cloud'],
      isSystem: true,
      enabled: false
    })
    return state
  },
  '65': (state: RootState) => {
    state.settings.targetLanguage = 'english'
    return state
  },
  '66': (state: RootState) => {
    state.llm.providers.push(
      {
        id: 'gitee-ai',
        name: 'gitee ai',
        type: 'openai',
        apiKey: '',
        apiHost: 'https://ai.gitee.com',
        models: SYSTEM_MODELS['gitee-ai'],
        isSystem: true,
        enabled: false
      },
      {
        id: 'ppio',
        name: 'PPIO',
        type: 'openai',
        apiKey: '',
        apiHost: 'https://api.ppinfra.com/v3/openai',
        models: SYSTEM_MODELS.ppio,
        isSystem: true,
        enabled: false
      }
    )

    state.llm.providers = state.llm.providers.filter((provider) => provider.id !== 'graphrag-kylin-mountain')

    if (state.minapps) {
      const aistudio = DEFAULT_MIN_APPS.find((app) => app.id === 'aistudio')
      if (aistudio) {
        state.minapps.enabled.push(aistudio)
      }
    }

    return state
  },
  '67': (state: RootState) => {
    if (state.minapps) {
      const xiaoyi = DEFAULT_MIN_APPS.find((app) => app.id === 'xiaoyi')
      if (xiaoyi) {
        state.minapps.enabled.push(xiaoyi)
      }
    }

    state.llm.providers.push(
      {
        id: 'modelscope',
        name: 'ModelScope',
        type: 'openai',
        apiKey: '',
        apiHost: 'https://api-inference.modelscope.cn/v1/',
        models: SYSTEM_MODELS.modelscope,
        isSystem: true,
        enabled: false
      },
      {
        id: 'lmstudio',
        name: 'LM Studio',
        type: 'openai',
        apiKey: '',
        apiHost: 'http://localhost:1234',
        models: SYSTEM_MODELS.lmstudio,
        isSystem: true,
        enabled: false
      },
      {
        id: 'perplexity',
        name: 'Perplexity',
        type: 'openai',
        apiKey: '',
        apiHost: 'https://api.perplexity.ai/',
        models: SYSTEM_MODELS.perplexity,
        isSystem: true,
        enabled: false
      },
      {
        id: 'infini',
        name: 'Infini',
        type: 'openai',
        apiKey: '',
        apiHost: 'https://cloud.infini-ai.com/maas',
        models: SYSTEM_MODELS.infini,
        isSystem: true,
        enabled: false
      },
      {
        id: 'dmxapi',
        name: 'DMXAPI',
        type: 'openai',
        apiKey: '',
        apiHost: 'https://api.dmxapi.com',
        models: SYSTEM_MODELS.dmxapi,
        isSystem: true,
        enabled: false
      }
    )

    state.llm.settings.lmstudio = {
      keepAliveTime: 5
    }

    return state
  },
  '68': (state: RootState) => {
    if (state.minapps) {
      const notebooklm = DEFAULT_MIN_APPS.find((app) => app.id === 'notebooklm')
      if (notebooklm) {
        state.minapps.enabled.push(notebooklm)
      }
    }

    if (!state.llm.providers.find((provider) => provider.id === 'modelscope')) {
      state.llm.providers.push({
        id: 'modelscope',
        name: 'ModelScope',
        type: 'openai',
        apiKey: '',
        apiHost: 'https://api-inference.modelscope.cn/v1/',
        models: SYSTEM_MODELS.modelscope,
        isSystem: true,
        enabled: false
      })
    }

    if (!state.llm.providers.find((provider) => provider.id === 'lmstudio')) {
      state.llm.providers.push({
        id: 'lmstudio',
        name: 'LM Studio',
        type: 'openai',
        apiKey: '',
        apiHost: 'http://localhost:1234',
        models: SYSTEM_MODELS.lmstudio,
        isSystem: true,
        enabled: false
      })
    }

    return state
  },
  '69': (state: RootState) => {
    if (state.minapps) {
      const coze = DEFAULT_MIN_APPS.find((app) => app.id === 'coze')
      if (coze) {
        state.minapps.enabled.push(coze)
      }
    }
    state.settings.gridColumns = 2
    state.settings.gridPopoverTrigger = 'hover'
    return state
  },
  '70': (state: RootState) => {
    state.llm.providers.forEach((provider) => {
      if (provider.id === 'dmxapi') {
        provider.apiHost = 'https://www.dmxapi.cn'
      }
    })
    return state
  },
  '71': (state: RootState) => {
    const appIds = ['dify', 'wpslingxi', 'lechat', 'abacus', 'lambdachat', 'baidu-ai-search']

    if (state.minapps) {
      appIds.forEach((id) => {
        const app = DEFAULT_MIN_APPS.find((app) => app.id === id)
        if (app) {
          state.minapps.enabled.push(app)
        }
      })
      // remove zhihu-zhiada
      state.minapps.enabled = state.minapps.enabled.filter((app) => app.id !== 'zhihu-zhiada')
      state.minapps.disabled = state.minapps.disabled.filter((app) => app.id !== 'zhihu-zhiada')
    }

    state.settings.thoughtAutoCollapse = true

    return state
  },
  '72': (state: RootState) => {
    if (state.minapps) {
      const monica = DEFAULT_MIN_APPS.find((app) => app.id === 'monica')
      if (monica) {
        state.minapps.enabled.push(monica)
      }
    }

    // remove duplicate lmstudio providers
    const emptyLmStudioProviderIndex = state.llm.providers.findLastIndex(
      (provider) => provider.id === 'lmstudio' && provider.models.length === 0
    )

    if (emptyLmStudioProviderIndex !== -1) {
      state.llm.providers.splice(emptyLmStudioProviderIndex, 1)
    }

    return state
  },
  '73': (state: RootState) => {
    if (state.websearch) {
      state.websearch.searchWithTime = true
      state.websearch.maxResults = 5
      state.websearch.excludeDomains = []
    }

    if (!state.llm.providers.find((provider) => provider.id === 'lmstudio')) {
      state.llm.providers.push({
        id: 'lmstudio',
        name: 'LM Studio',
        type: 'openai',
        apiKey: '',
        apiHost: 'http://localhost:1234',
        models: SYSTEM_MODELS.lmstudio,
        isSystem: true,
        enabled: false
      })
    }

    state.llm.providers.splice(1, 0, {
      id: 'o3',
      name: 'O3',
      apiKey: '',
      apiHost: 'https://api.o3.fan',
      models: SYSTEM_MODELS.o3,
      isSystem: true,
      type: 'openai',
      enabled: false
    })

    state.assistants.assistants.forEach((assistant) => {
      const leadingEmoji = getLeadingEmoji(assistant.name)
      if (leadingEmoji) {
        assistant.emoji = leadingEmoji
        assistant.name = assistant.name.replace(leadingEmoji, '').trim()
      }
    })

    state.agents.agents.forEach((agent) => {
      const leadingEmoji = getLeadingEmoji(agent.name)
      if (leadingEmoji) {
        agent.emoji = leadingEmoji
        agent.name = agent.name.replace(leadingEmoji, '').trim()
      }
    })

    const defaultAssistantEmoji = getLeadingEmoji(state.assistants.defaultAssistant.name)

    if (defaultAssistantEmoji) {
      state.assistants.defaultAssistant.emoji = defaultAssistantEmoji
      state.assistants.defaultAssistant.name = state.assistants.defaultAssistant.name
        .replace(defaultAssistantEmoji, '')
        .trim()
    }

    return state
  },
  '74': (state: RootState) => {
    return {
      ...state,
      llm: {
        ...state.llm,
        providers: [
          ...state.llm.providers,
          {
            id: 'copilot',
            name: 'Github Copilot',
            type: 'openai',
            apiKey: '',
            apiHost: 'https://api.githubcopilot.com/',
            models: SYSTEM_MODELS.copilot,
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
