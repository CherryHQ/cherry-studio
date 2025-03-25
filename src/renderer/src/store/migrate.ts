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
import { INITIAL_PROVIDERS, moveProvider } from './llm'
import { DEFAULT_SIDEBAR_ICONS } from './settings'

// remove logo base64 data to reduce the size of the state
function removeMiniAppIconsFromState(state: RootState) {
  if (state.minapps) {
    state.minapps.enabled = state.minapps.enabled.map((app) => ({ ...app, logo: undefined }))
    state.minapps.disabled = state.minapps.disabled.map((app) => ({ ...app, logo: undefined }))
    state.minapps.pinned = state.minapps.pinned.map((app) => ({ ...app, logo: undefined }))
  }
}

// add provider to state
function addProvider(state: RootState, id: string) {
  if (!state.llm.providers.find((p) => p.id === id)) {
    const _provider = INITIAL_PROVIDERS.find((p) => p.id === id)
    if (_provider) {
      state.llm.providers.push(_provider)
    }
  }
}

const migrateConfig = {
  '2': (state: RootState) => {
    addProvider(state, 'yi')
    return state
  },
  '3': (state: RootState) => {
    addProvider(state, 'zhipu')
    return state
  },
  '4': (state: RootState) => {
    addProvider(state, 'ollama')
    return state
  },
  '5': (state: RootState) => {
    addProvider(state, 'moonshot')
    return state
  },
  '6': (state: RootState) => {
    addProvider(state, 'openrouter')
    return state
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
    addProvider(state, 'baichuan')
    return state
  },
  '11': (state: RootState) => {
    addProvider(state, 'dashscope')
    addProvider(state, 'anthropic')
    return state
  },
  '12': (state: RootState) => {
    addProvider(state, 'aihubmix')
    return state
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
    addProvider(state, 'gemini')
    addProvider(state, 'stepfun')
    addProvider(state, 'doubao')
    return state
  },
  '22': (state: RootState) => {
    addProvider(state, 'minimax')
    return state
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
    addProvider(state, 'github')
    return state
  },
  '26': (state: RootState) => {
    addProvider(state, 'ocoolai')
    return state
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
    addProvider(state, 'together')
    addProvider(state, 'fireworks')
    addProvider(state, 'zhinao')
    addProvider(state, 'hunyuan')
    addProvider(state, 'nvidia')
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
    addProvider(state, 'azure-openai')
    return state
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
    addProvider(state, 'hunyuan')
    return state
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
    addProvider(state, 'grok')
    addProvider(state, 'hyperbolic')
    addProvider(state, 'mistral')
    return state
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
    addProvider(state, 'jina')
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
    addProvider(state, 'baidu-cloud')
    return state
  },
  '65': (state: RootState) => {
    state.settings.targetLanguage = 'english'
    return state
  },
  '66': (state: RootState) => {
    addProvider(state, 'gitee-ai')
    addProvider(state, 'ppio')

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

    addProvider(state, 'modelscope')
    addProvider(state, 'lmstudio')
    addProvider(state, 'perplexity')
    addProvider(state, 'infini')
    addProvider(state, 'dmxapi')

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

    addProvider(state, 'modelscope')
    addProvider(state, 'lmstudio')

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

    addProvider(state, 'lmstudio')
    addProvider(state, 'o3')
    moveProvider(state.llm.providers, 'o3', 2)

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
    addProvider(state, 'xirang')
    return state
  },
  '75': (state: RootState) => {
    if (state.minapps) {
      const you = DEFAULT_MIN_APPS.find((app) => app.id === 'you')
      const cici = DEFAULT_MIN_APPS.find((app) => app.id === 'cici')
      const zhihu = DEFAULT_MIN_APPS.find((app) => app.id === 'zhihu')
      you && state.minapps.enabled.push(you)
      cici && state.minapps.enabled.push(cici)
      zhihu && state.minapps.enabled.push(zhihu)
    }
    return state
  },
  '76': (state: RootState) => {
    addProvider(state, 'tencent-cloud-ti')
    return state
  },
  '77': (state: RootState) => {
    if (state.websearch) {
      if (!state.websearch.providers.find((p) => p.id === 'searxng')) {
        state.websearch.providers.push(
          {
            id: 'searxng',
            name: 'Searxng',
            apiHost: ''
          },
          {
            id: 'exa',
            name: 'Exa',
            apiKey: ''
          }
        )
      }
      state.websearch.providers.forEach((p) => {
        // @ts-ignore eslint-disable-next-line
        delete p.enabled
      })
    }
    return state
  },
  '78': (state: RootState) => {
    state.llm.providers = moveProvider(state.llm.providers, 'ppio', 9)
    state.llm.providers = moveProvider(state.llm.providers, 'infini', 10)
    removeMiniAppIconsFromState(state)
    return state
  },
  '79': (state: RootState) => {
    addProvider(state, 'gpustack')
    return state
  },
  '80': (state: RootState) => {
    addProvider(state, 'alayanew')
    state.llm.providers = moveProvider(state.llm.providers, 'alayanew', 10)
    return state
  },
  '81': (state: RootState) => {
    addProvider(state, 'copilot')
    return state
  },
  '82': (state: RootState) => {
    const runtimeState = state.runtime as any
    if (runtimeState?.webdavSync) {
      state.backup = state.backup || {}
      state.backup = {
        ...state.backup,
        webdavSync: {
          lastSyncTime: runtimeState.webdavSync.lastSyncTime || null,
          syncing: runtimeState.webdavSync.syncing || false,
          lastSyncError: runtimeState.webdavSync.lastSyncError || null
        }
      }
      delete runtimeState.webdavSync
    }
    return state
  },
  '83': (state: RootState) => {
    state.settings.messageNavigation = 'buttons'
    state.settings.launchOnBoot = false
    state.settings.launchToTray = false
    state.settings.trayOnClose = true
    return state
  },
  '84': (state: RootState) => {
    addProvider(state, 'voyageai')
    return state
  },
  '85': (state: RootState) => {
    // @ts-ignore eslint-disable-next-line
    state.settings.autoCheckUpdate = !state.settings.manualUpdateCheck
    // @ts-ignore eslint-disable-next-line
    delete state.settings.manualUpdateCheck
    return state
  }
}

const migrate = createMigrate(migrateConfig as any)

export default migrate
