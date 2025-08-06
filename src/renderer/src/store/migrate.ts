import { loggerService } from '@logger'
import { nanoid } from '@reduxjs/toolkit'
import { DEFAULT_CONTEXTCOUNT, DEFAULT_TEMPERATURE, isMac } from '@renderer/config/constant'
import { DEFAULT_MIN_APPS } from '@renderer/config/minapps'
import { isFunctionCallingModel, isNotSupportedTextDelta, SYSTEM_MODELS } from '@renderer/config/models'
import { TRANSLATE_PROMPT } from '@renderer/config/prompts'
import {
  isSupportArrayContentProvider,
  isSupportDeveloperRoleProvider,
  isSupportStreamOptionsProvider,
  isSystemProvider
} from '@renderer/config/providers'
import db from '@renderer/databases'
import i18n from '@renderer/i18n'
import { Assistant, LanguageCode, Model, Provider, WebSearchProvider } from '@renderer/types'
import { getDefaultGroupName, getLeadingEmoji, runAsyncFunction, uuid } from '@renderer/utils'
import { defaultByPassRules, UpgradeChannel } from '@shared/config/constant'
import { isEmpty } from 'lodash'
import { createMigrate } from 'redux-persist'

import { RootState } from '.'
import { DEFAULT_TOOL_ORDER } from './inputTools'
import { initialState as llmInitialState, moveProvider, SYSTEM_PROVIDERS } from './llm'
import { mcpSlice } from './mcp'
import { defaultActionItems } from './selectionStore'
import { DEFAULT_SIDEBAR_ICONS, initialState as settingsInitialState } from './settings'
import { initialState as shortcutsInitialState } from './shortcuts'
import { defaultWebSearchProviders } from './websearch'

const logger = loggerService.withContext('Migrate')

// remove logo base64 data to reduce the size of the state
function removeMiniAppIconsFromState(state: RootState) {
  if (state.minapps) {
    state.minapps.enabled = state.minapps.enabled.map((app) => ({ ...app, logo: undefined }))
    state.minapps.disabled = state.minapps.disabled.map((app) => ({ ...app, logo: undefined }))
    state.minapps.pinned = state.minapps.pinned.map((app) => ({ ...app, logo: undefined }))
  }
}

function removeMiniAppFromState(state: RootState, id: string) {
  if (state.minapps) {
    state.minapps.enabled = state.minapps.enabled.filter((app) => app.id !== id)
    state.minapps.disabled = state.minapps.disabled.filter((app) => app.id !== id)
  }
}

function addMiniApp(state: RootState, id: string) {
  if (state.minapps) {
    const app = DEFAULT_MIN_APPS.find((app) => app.id === id)
    if (app) {
      if (!state.minapps.enabled.find((app) => app.id === id)) {
        state.minapps.enabled.push(app)
      }
    }
  }
}

// add provider to state
function addProvider(state: RootState, id: string) {
  if (!state.llm.providers.find((p) => p.id === id)) {
    const _provider = SYSTEM_PROVIDERS.find((p) => p.id === id)
    if (_provider) {
      state.llm.providers.push(_provider)
    }
  }
}

function updateProvider(state: RootState, id: string, provider: Partial<Provider>) {
  if (state.llm.providers) {
    const index = state.llm.providers.findIndex((p) => p.id === id)
    if (index !== -1) {
      state.llm.providers[index] = { ...state.llm.providers[index], ...provider }
    }
  }
}

function addWebSearchProvider(state: RootState, id: string) {
  if (state.websearch && state.websearch.providers) {
    if (!state.websearch.providers.find((p) => p.id === id)) {
      const provider = defaultWebSearchProviders.find((p) => p.id === id)
      if (provider) {
        state.websearch.providers.push(provider)
      }
    }
  }
}

function updateWebSearchProvider(state: RootState, provider: Partial<WebSearchProvider>) {
  if (state.websearch && state.websearch.providers) {
    const index = state.websearch.providers.findIndex((p) => p.id === provider.id)
    if (index !== -1) {
      state.websearch.providers[index] = {
        ...state.websearch.providers[index],
        ...provider
      }
    }
  }
}

function addSelectionAction(state: RootState, id: string) {
  if (state.selectionStore && state.selectionStore.actionItems) {
    if (!state.selectionStore.actionItems.some((item) => item.id === id)) {
      const action = defaultActionItems.find((item) => item.id === id)
      if (action) {
        state.selectionStore.actionItems.push(action)
      }
    }
  }
}

/**
 * Add shortcuts(ids from shortcutsInitialState) after the shortcut(afterId)
 * if afterId is 'first', add to the first
 * if afterId is 'last', add to the last
 */
function addShortcuts(state: RootState, ids: string[], afterId: string) {
  const defaultShortcuts = shortcutsInitialState.shortcuts

  // 确保 state.shortcuts 存在
  if (!state.shortcuts) {
    return
  }

  // 从 defaultShortcuts 中找到要添加的快捷键
  const shortcutsToAdd = defaultShortcuts.filter((shortcut) => ids.includes(shortcut.key))

  // 过滤掉已经存在的快捷键
  const existingKeys = state.shortcuts.shortcuts.map((s) => s.key)
  const newShortcuts = shortcutsToAdd.filter((shortcut) => !existingKeys.includes(shortcut.key))

  if (newShortcuts.length === 0) {
    return
  }

  if (afterId === 'first') {
    // 添加到最前面
    state.shortcuts.shortcuts.unshift(...newShortcuts)
  } else if (afterId === 'last') {
    // 添加到最后面
    state.shortcuts.shortcuts.push(...newShortcuts)
  } else {
    // 添加到指定快捷键后面
    const afterIndex = state.shortcuts.shortcuts.findIndex((shortcut) => shortcut.key === afterId)
    if (afterIndex !== -1) {
      state.shortcuts.shortcuts.splice(afterIndex + 1, 0, ...newShortcuts)
    } else {
      // 如果找不到指定的快捷键，则添加到最后
      state.shortcuts.shortcuts.push(...newShortcuts)
    }
  }
}

const migrateConfig = {
  '2': (state: RootState) => {
    try {
      addProvider(state, 'yi')
      return state
    } catch (error) {
      return state
    }
  },
  '3': (state: RootState) => {
    try {
      addProvider(state, 'zhipu')
      return state
    } catch (error) {
      return state
    }
  },
  '4': (state: RootState) => {
    try {
      addProvider(state, 'ollama')
      return state
    } catch (error) {
      return state
    }
  },
  '5': (state: RootState) => {
    try {
      addProvider(state, 'moonshot')
      return state
    } catch (error) {
      return state
    }
  },
  '6': (state: RootState) => {
    try {
      addProvider(state, 'openrouter')
      return state
    } catch (error) {
      return state
    }
  },
  '7': (state: RootState) => {
    try {
      return {
        ...state,
        settings: {
          ...state.settings,
          language: navigator.language
        }
      }
    } catch (error) {
      return state
    }
  },
  '8': (state: RootState) => {
    try {
      const fixAssistantName = (assistant: Assistant) => {
        // 2025/07/25 这俩键早没了，从远古版本迁移包出错的
        if (isEmpty(assistant.name)) {
          assistant.name = i18n.t('chat.default.name')
        }

        assistant.topics = assistant.topics.map((topic) => {
          if (isEmpty(topic.name)) {
            topic.name = i18n.t('chat.default.topic.name')
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
    } catch (error) {
      return state
    }
  },
  '9': (state: RootState) => {
    try {
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
    } catch (error) {
      return state
    }
  },
  '10': (state: RootState) => {
    try {
      addProvider(state, 'baichuan')
      return state
    } catch (error) {
      return state
    }
  },
  '11': (state: RootState) => {
    try {
      addProvider(state, 'dashscope')
      addProvider(state, 'anthropic')
      return state
    } catch (error) {
      return state
    }
  },
  '12': (state: RootState) => {
    try {
      addProvider(state, 'aihubmix')
      return state
    } catch (error) {
      return state
    }
  },
  '13': (state: RootState) => {
    try {
      return {
        ...state,
        assistants: {
          ...state.assistants,
          defaultAssistant: {
            ...state.assistants.defaultAssistant,
            name: ['Default Assistant', '默认助手'].includes(state.assistants.defaultAssistant.name)
              ? i18n.t('settings.assistant.label')
              : state.assistants.defaultAssistant.name
          }
        }
      }
    } catch (error) {
      return state
    }
  },
  '14': (state: RootState) => {
    try {
      return {
        ...state,
        settings: {
          ...state.settings,
          showAssistants: true,
          proxyUrl: undefined
        }
      }
    } catch (error) {
      return state
    }
  },
  '15': (state: RootState) => {
    try {
      return {
        ...state,
        settings: {
          ...state.settings,
          userName: '',
          showMessageDivider: true
        }
      }
    } catch (error) {
      return state
    }
  },
  '16': (state: RootState) => {
    try {
      return {
        ...state,
        settings: {
          ...state.settings,
          messageFont: 'system',
          showInputEstimatedTokens: false
        }
      }
    } catch (error) {
      return state
    }
  },
  '17': (state: RootState) => {
    try {
      return {
        ...state,
        settings: {
          ...state.settings,
          theme: 'auto'
        }
      }
    } catch (error) {
      return state
    }
  },
  '19': (state: RootState) => {
    try {
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
    } catch (error) {
      return state
    }
  },
  '20': (state: RootState) => {
    try {
      return {
        ...state,
        settings: {
          ...state.settings,
          fontSize: 14
        }
      }
    } catch (error) {
      return state
    }
  },
  '21': (state: RootState) => {
    try {
      addProvider(state, 'gemini')
      addProvider(state, 'stepfun')
      addProvider(state, 'doubao')
      return state
    } catch (error) {
      return state
    }
  },
  '22': (state: RootState) => {
    try {
      addProvider(state, 'minimax')
      return state
    } catch (error) {
      return state
    }
  },
  '23': (state: RootState) => {
    try {
      return {
        ...state,
        settings: {
          ...state.settings,
          showTopics: true,
          windowStyle: 'transparent'
        }
      }
    } catch (error) {
      return state
    }
  },
  '24': (state: RootState) => {
    try {
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
    } catch (error) {
      return state
    }
  },
  '25': (state: RootState) => {
    try {
      addProvider(state, 'github')
      return state
    } catch (error) {
      return state
    }
  },
  '26': (state: RootState) => {
    try {
      addProvider(state, 'ocoolai')
      return state
    } catch (error) {
      return state
    }
  },
  '27': (state: RootState) => {
    try {
      return {
        ...state,
        settings: {
          ...state.settings,
          renderInputMessageAsMarkdown: true
        }
      }
    } catch (error) {
      return state
    }
  },
  '28': (state: RootState) => {
    try {
      addProvider(state, 'together')
      addProvider(state, 'fireworks')
      addProvider(state, 'zhinao')
      addProvider(state, 'hunyuan')
      addProvider(state, 'nvidia')
      return state
    } catch (error) {
      return state
    }
  },
  '29': (state: RootState) => {
    try {
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
    } catch (error) {
      return state
    }
  },
  '30': (state: RootState) => {
    try {
      addProvider(state, 'azure-openai')
      return state
    } catch (error) {
      return state
    }
  },
  '31': (state: RootState) => {
    try {
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
    } catch (error) {
      return state
    }
  },
  '32': (state: RootState) => {
    try {
      addProvider(state, 'hunyuan')
      return state
    } catch (error) {
      return state
    }
  },
  '33': (state: RootState) => {
    try {
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
    } catch (error) {
      return state
    }
  },
  '34': (state: RootState) => {
    try {
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
    } catch (error) {
      return state
    }
  },
  '35': (state: RootState) => {
    try {
      state.settings.mathEngine = 'KaTeX'
      return state
    } catch (error) {
      return state
    }
  },
  '36': (state: RootState) => {
    try {
      state.settings.topicPosition = 'left'
      return state
    } catch (error) {
      return state
    }
  },
  '37': (state: RootState) => {
    try {
      state.settings.messageStyle = 'plain'
      return state
    } catch (error) {
      return state
    }
  },
  '38': (state: RootState) => {
    try {
      addProvider(state, 'grok')
      addProvider(state, 'hyperbolic')
      addProvider(state, 'mistral')
      return state
    } catch (error) {
      return state
    }
  },
  '39': (state: RootState) => {
    try {
      // @ts-ignore eslint-disable-next-line
      state.settings.codeStyle = 'auto'
      return state
    } catch (error) {
      return state
    }
  },
  '40': (state: RootState) => {
    try {
      state.settings.tray = true
      return state
    } catch (error) {
      return state
    }
  },
  '41': (state: RootState) => {
    try {
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
    } catch (error) {
      return state
    }
  },
  '42': (state: RootState) => {
    try {
      state.settings.proxyMode = state.settings.proxyUrl ? 'custom' : 'none'
      return state
    } catch (error) {
      return state
    }
  },
  '43': (state: RootState) => {
    try {
      if (state.settings.proxyMode === 'none') {
        state.settings.proxyMode = 'system'
      }
      return state
    } catch (error) {
      return state
    }
  },
  '44': (state: RootState) => {
    try {
      state.settings.translateModelPrompt = TRANSLATE_PROMPT
      return state
    } catch (error) {
      return state
    }
  },
  '45': (state: RootState) => {
    state.settings.enableTopicNaming = true
    return state
  },
  '46': (state: RootState) => {
    try {
      if (
        state.settings?.translateModelPrompt?.includes(
          'If the target language is the same as the source language, do not translate'
        )
      ) {
        state.settings.translateModelPrompt = TRANSLATE_PROMPT
      }
      return state
    } catch (error) {
      return state
    }
  },
  '47': (state: RootState) => {
    try {
      state.llm.providers.forEach((provider) => {
        provider.models.forEach((model) => {
          model.group = getDefaultGroupName(model.id)
        })
      })
      return state
    } catch (error) {
      return state
    }
  },
  '48': (state: RootState) => {
    try {
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
    } catch (error) {
      return state
    }
  },
  '49': (state: RootState) => {
    try {
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
    } catch (error) {
      return state
    }
  },
  '50': (state: RootState) => {
    try {
      addProvider(state, 'jina')
      return state
    } catch (error) {
      return state
    }
  },
  '51': (state: RootState) => {
    state.settings.topicNamingPrompt = ''
    return state
  },
  '54': (state: RootState) => {
    try {
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
    } catch (error) {
      return state
    }
  },
  '55': (state: RootState) => {
    try {
      if (!state.settings.sidebarIcons) {
        state.settings.sidebarIcons = {
          visible: DEFAULT_SIDEBAR_ICONS,
          disabled: []
        }
      }
      return state
    } catch (error) {
      return state
    }
  },
  '57': (state: RootState) => {
    try {
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
    } catch (error) {
      return state
    }
  },
  '58': (state: RootState) => {
    try {
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
    } catch (error) {
      return state
    }
  },
  '59': (state: RootState) => {
    try {
      addMiniApp(state, 'flowith')
      return state
    } catch (error) {
      return state
    }
  },
  '60': (state: RootState) => {
    try {
      state.settings.multiModelMessageStyle = 'fold'
      return state
    } catch (error) {
      return state
    }
  },
  '61': (state: RootState) => {
    try {
      state.llm.providers.forEach((provider) => {
        if (provider.id === 'qwenlm') {
          provider.type = 'qwenlm'
        }
      })
      return state
    } catch (error) {
      return state
    }
  },
  '62': (state: RootState) => {
    try {
      state.llm.providers.forEach((provider) => {
        if (provider.id === 'azure-openai') {
          provider.type = 'azure-openai'
        }
      })
      state.settings.translateModelPrompt = TRANSLATE_PROMPT
      return state
    } catch (error) {
      return state
    }
  },
  '63': (state: RootState) => {
    try {
      addMiniApp(state, '3mintop')
      return state
    } catch (error) {
      return state
    }
  },
  '64': (state: RootState) => {
    try {
      state.llm.providers = state.llm.providers.filter((provider) => provider.id !== 'qwenlm')
      addProvider(state, 'baidu-cloud')
      return state
    } catch (error) {
      return state
    }
  },
  '65': (state: RootState) => {
    try {
      // @ts-ignore expect error
      state.settings.targetLanguage = 'english'
      return state
    } catch (error) {
      return state
    }
  },
  '66': (state: RootState) => {
    try {
      addProvider(state, 'gitee-ai')
      addProvider(state, 'ppio')
      addMiniApp(state, 'aistudio')
      state.llm.providers = state.llm.providers.filter((provider) => provider.id !== 'graphrag-kylin-mountain')

      return state
    } catch (error) {
      return state
    }
  },
  '67': (state: RootState) => {
    try {
      addMiniApp(state, 'xiaoyi')
      addProvider(state, 'modelscope')
      addProvider(state, 'lmstudio')
      addProvider(state, 'perplexity')
      addProvider(state, 'infini')
      addProvider(state, 'dmxapi')

      state.llm.settings.lmstudio = {
        keepAliveTime: 5
      }

      return state
    } catch (error) {
      return state
    }
  },
  '68': (state: RootState) => {
    try {
      addMiniApp(state, 'notebooklm')
      addProvider(state, 'modelscope')
      addProvider(state, 'lmstudio')
      return state
    } catch (error) {
      return state
    }
  },
  '69': (state: RootState) => {
    try {
      addMiniApp(state, 'coze')
      state.settings.gridColumns = 2
      state.settings.gridPopoverTrigger = 'hover'
      return state
    } catch (error) {
      return state
    }
  },
  '70': (state: RootState) => {
    try {
      state.llm.providers.forEach((provider) => {
        if (provider.id === 'dmxapi') {
          provider.apiHost = 'https://www.dmxapi.cn'
        }
      })
      return state
    } catch (error) {
      return state
    }
  },
  '71': (state: RootState) => {
    try {
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
    } catch (error) {
      return state
    }
  },
  '72': (state: RootState) => {
    try {
      addMiniApp(state, 'monica')

      // remove duplicate lmstudio providers
      const emptyLmStudioProviderIndex = state.llm.providers.findLastIndex(
        (provider) => provider.id === 'lmstudio' && provider.models.length === 0
      )

      if (emptyLmStudioProviderIndex !== -1) {
        state.llm.providers.splice(emptyLmStudioProviderIndex, 1)
      }

      return state
    } catch (error) {
      return state
    }
  },
  '73': (state: RootState) => {
    try {
      if (state.websearch) {
        state.websearch.searchWithTime = true
        state.websearch.maxResults = 5
        state.websearch.excludeDomains = []
      }

      addProvider(state, 'lmstudio')
      addProvider(state, 'o3')
      state.llm.providers = moveProvider(state.llm.providers, 'o3', 2)

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
    } catch (error) {
      return state
    }
  },
  '74': (state: RootState) => {
    try {
      addProvider(state, 'xirang')
      return state
    } catch (error) {
      return state
    }
  },
  '75': (state: RootState) => {
    try {
      addMiniApp(state, 'you')
      addMiniApp(state, 'cici')
      addMiniApp(state, 'zhihu')
      return state
    } catch (error) {
      return state
    }
  },
  '76': (state: RootState) => {
    try {
      addProvider(state, 'tencent-cloud-ti')
      return state
    } catch (error) {
      return state
    }
  },
  '77': (state: RootState) => {
    try {
      addWebSearchProvider(state, 'searxng')
      addWebSearchProvider(state, 'exa')
      if (state.websearch) {
        state.websearch.providers.forEach((p) => {
          // @ts-ignore eslint-disable-next-line
          delete p.enabled
        })
      }
      return state
    } catch (error) {
      return state
    }
  },
  '78': (state: RootState) => {
    try {
      state.llm.providers = moveProvider(state.llm.providers, 'ppio', 9)
      state.llm.providers = moveProvider(state.llm.providers, 'infini', 10)
      removeMiniAppIconsFromState(state)
      return state
    } catch (error) {
      return state
    }
  },
  '79': (state: RootState) => {
    try {
      addProvider(state, 'gpustack')
      return state
    } catch (error) {
      return state
    }
  },
  '80': (state: RootState) => {
    try {
      addProvider(state, 'alayanew')
      state.llm.providers = moveProvider(state.llm.providers, 'alayanew', 10)
      return state
    } catch (error) {
      return state
    }
  },
  '81': (state: RootState) => {
    try {
      addProvider(state, 'copilot')
      return state
    } catch (error) {
      return state
    }
  },
  '82': (state: RootState) => {
    try {
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
    } catch (error) {
      return state
    }
  },
  '83': (state: RootState) => {
    try {
      state.settings.messageNavigation = 'buttons'
      state.settings.launchOnBoot = false
      state.settings.launchToTray = false
      state.settings.trayOnClose = true
      return state
    } catch (error) {
      logger.error('migrate 83 error', error as Error)
      return state
    }
  },
  '84': (state: RootState) => {
    try {
      addProvider(state, 'voyageai')
      return state
    } catch (error) {
      logger.error('migrate 84 error', error as Error)
      return state
    }
  },
  '85': (state: RootState) => {
    try {
      // @ts-ignore eslint-disable-next-line
      state.settings.autoCheckUpdate = !state.settings.manualUpdateCheck
      // @ts-ignore eslint-disable-next-line
      delete state.settings.manualUpdateCheck
      state.settings.gridPopoverTrigger = 'click'
      return state
    } catch (error) {
      return state
    }
  },
  '86': (state: RootState) => {
    try {
      if (state?.mcp?.servers) {
        state.mcp.servers = state.mcp.servers.map((server) => ({
          ...server,
          id: nanoid()
        }))
      }
    } catch (error) {
      return state
    }
    return state
  },
  '87': (state: RootState) => {
    try {
      state.settings.maxKeepAliveMinapps = 3
      state.settings.showOpenedMinappsInSidebar = true
      return state
    } catch (error) {
      return state
    }
  },
  '88': (state: RootState) => {
    try {
      if (state?.mcp?.servers) {
        const hasAutoInstall = state.mcp.servers.some((server) => server.name === '@cherry/mcp-auto-install')
        if (!hasAutoInstall) {
          const defaultServer = mcpSlice.getInitialState().servers[0]
          state.mcp.servers = [{ ...defaultServer, id: nanoid() }, ...state.mcp.servers]
        }
      }
      return state
    } catch (error) {
      return state
    }
  },
  '89': (state: RootState) => {
    try {
      removeMiniAppFromState(state, 'aistudio')
      return state
    } catch (error) {
      return state
    }
  },
  '90': (state: RootState) => {
    try {
      state.settings.enableDataCollection = true
      return state
    } catch (error) {
      return state
    }
  },
  '91': (state: RootState) => {
    try {
      // @ts-ignore eslint-disable-next-line
      state.settings.codeCacheable = false
      // @ts-ignore eslint-disable-next-line
      state.settings.codeCacheMaxSize = 1000
      // @ts-ignore eslint-disable-next-line
      state.settings.codeCacheTTL = 15
      // @ts-ignore eslint-disable-next-line
      state.settings.codeCacheThreshold = 2
      addProvider(state, 'qiniu')
      return state
    } catch (error) {
      return state
    }
  },
  '92': (state: RootState) => {
    try {
      addMiniApp(state, 'dangbei')
      state.llm.providers = moveProvider(state.llm.providers, 'qiniu', 12)
      return state
    } catch (error) {
      return state
    }
  },
  '93': (state: RootState) => {
    try {
      if (!state?.settings?.exportMenuOptions) {
        state.settings.exportMenuOptions = settingsInitialState.exportMenuOptions
        return state
      }
      return state
    } catch (error) {
      return state
    }
  },
  '94': (state: RootState) => {
    try {
      state.settings.enableQuickPanelTriggers = false
      return state
    } catch (error) {
      return state
    }
  },
  '95': (state: RootState) => {
    try {
      addWebSearchProvider(state, 'local-google')
      addWebSearchProvider(state, 'local-bing')
      addWebSearchProvider(state, 'local-baidu')

      if (state.websearch) {
        if (isEmpty(state.websearch.subscribeSources)) {
          state.websearch.subscribeSources = []
        }
      }

      const qiniuProvider = state.llm.providers.find((provider) => provider.id === 'qiniu')
      if (qiniuProvider && isEmpty(qiniuProvider.models)) {
        qiniuProvider.models = SYSTEM_MODELS.qiniu
      }
      return state
    } catch (error) {
      return state
    }
  },
  '96': (state: RootState) => {
    try {
      // @ts-ignore eslint-disable-next-line
      state.settings.assistantIconType = state.settings?.showAssistantIcon ? 'model' : 'emoji'
      // @ts-ignore eslint-disable-next-line
      delete state.settings.showAssistantIcon
      state.settings.enableBackspaceDeleteModel = true
      return state
    } catch (error) {
      return state
    }
  },
  '97': (state: RootState) => {
    try {
      addMiniApp(state, 'zai')
      state.settings.webdavMaxBackups = 0
      if (state.websearch && state.websearch.providers) {
        state.websearch.providers.forEach((provider) => {
          provider.basicAuthUsername = ''
          provider.basicAuthPassword = ''
        })
      }
      return state
    } catch (error) {
      return state
    }
  },
  '98': (state: RootState) => {
    try {
      state.llm.providers.forEach((provider) => {
        if (provider.type === 'openai' && provider.id !== 'openai') {
          // @ts-ignore eslint-disable-next-line
          provider.type = 'openai-compatible'
        }
      })
      return state
    } catch (error) {
      return state
    }
  },
  '99': (state: RootState) => {
    try {
      state.settings.showPrompt = true

      addWebSearchProvider(state, 'bocha')

      updateWebSearchProvider(state, {
        id: 'exa',
        apiHost: 'https://api.exa.ai'
      })

      updateWebSearchProvider(state, {
        id: 'tavily',
        apiHost: 'https://api.tavily.com'
      })

      // Remove basic auth fields from exa and tavily
      if (state.websearch?.providers) {
        state.websearch.providers = state.websearch.providers.map((provider) => {
          if (provider.id === 'exa' || provider.id === 'tavily') {
            // eslint-disable-next-line @typescript-eslint/no-unused-vars
            const { basicAuthUsername, basicAuthPassword, ...rest } = provider
            return rest
          }
          return provider
        })
      }
      return state
    } catch (error) {
      return state
    }
  },
  '100': (state: RootState) => {
    try {
      state.llm.providers.forEach((provider) => {
        // @ts-ignore eslint-disable-next-line
        if (['openai-compatible', 'openai'].includes(provider.type)) {
          provider.type = 'openai'
        }
        if (provider.id === 'openai') {
          provider.type = 'openai-response'
        }
      })
      state.assistants.assistants.forEach((assistant) => {
        assistant.knowledgeRecognition = 'off'
      })
      return state
    } catch (error) {
      logger.error('migrate 100 error', error as Error)
      return state
    }
  },
  '101': (state: RootState) => {
    try {
      state.assistants.assistants.forEach((assistant) => {
        if (assistant.settings) {
          // @ts-ignore eslint-disable-next-line
          if (assistant.settings.enableToolUse) {
            // @ts-ignore eslint-disable-next-line
            assistant.settings.toolUseMode = assistant.settings.enableToolUse ? 'function' : 'prompt'
            // @ts-ignore eslint-disable-next-line
            delete assistant.settings.enableToolUse
          }
        }
      })
      if (state.shortcuts) {
        state.shortcuts.shortcuts.push({
          key: 'exit_fullscreen',
          shortcut: ['Escape'],
          editable: false,
          enabled: true,
          system: true
        })
      }
      return state
    } catch (error) {
      logger.error('migrate 101 error', error as Error)
      return state
    }
  },
  '102': (state: RootState) => {
    try {
      state.settings.openAI = {
        summaryText: 'off',
        serviceTier: 'auto'
      }

      state.settings.codeExecution = settingsInitialState.codeExecution
      state.settings.codeEditor = settingsInitialState.codeEditor
      state.settings.codePreview = settingsInitialState.codePreview

      // @ts-ignore eslint-disable-next-line
      if (state.settings.codeStyle) {
        // @ts-ignore eslint-disable-next-line
        state.settings.codePreview.themeLight = state.settings.codeStyle
        // @ts-ignore eslint-disable-next-line
        state.settings.codePreview.themeDark = state.settings.codeStyle
      }

      // @ts-ignore eslint-disable-next-line
      delete state.settings.codeStyle
      // @ts-ignore eslint-disable-next-line
      delete state.settings.codeCacheable
      // @ts-ignore eslint-disable-next-line
      delete state.settings.codeCacheMaxSize
      // @ts-ignore eslint-disable-next-line
      delete state.settings.codeCacheTTL
      // @ts-ignore eslint-disable-next-line
      delete state.settings.codeCacheThreshold
      return state
    } catch (error) {
      logger.error('migrate 102 error', error as Error)
      return state
    }
  },
  '103': (state: RootState) => {
    try {
      if (state.shortcuts) {
        if (!state.shortcuts.shortcuts.find((shortcut) => shortcut.key === 'search_message_in_chat')) {
          state.shortcuts.shortcuts.push({
            key: 'search_message_in_chat',
            shortcut: [isMac ? 'Command' : 'Ctrl', 'F'],
            editable: true,
            enabled: true,
            system: false
          })
        }
        const searchMessageShortcut = state.shortcuts.shortcuts.find((shortcut) => shortcut.key === 'search_message')
        const targetShortcut = [isMac ? 'Command' : 'Ctrl', 'F']
        if (
          searchMessageShortcut &&
          Array.isArray(searchMessageShortcut.shortcut) &&
          searchMessageShortcut.shortcut.length === targetShortcut.length &&
          searchMessageShortcut.shortcut.every((v, i) => v === targetShortcut[i])
        ) {
          searchMessageShortcut.shortcut = [isMac ? 'Command' : 'Ctrl', 'Shift', 'F']
        }
      }
      return state
    } catch (error) {
      logger.error('migrate 103 error', error as Error)
      return state
    }
  },
  '104': (state: RootState) => {
    try {
      addProvider(state, 'burncloud')
      state.llm.providers = moveProvider(state.llm.providers, 'burncloud', 10)
      return state
    } catch (error) {
      logger.error('migrate 104 error', error as Error)
      return state
    }
  },
  '105': (state: RootState) => {
    try {
      state.settings.notification = settingsInitialState.notification
      addMiniApp(state, 'google')
      if (!state.settings.openAI) {
        state.settings.openAI = {
          summaryText: 'off',
          serviceTier: 'auto'
        }
      }
      return state
    } catch (error) {
      logger.error('migrate 105 error', error as Error)
      return state
    }
  },
  '106': (state: RootState) => {
    try {
      addProvider(state, 'tokenflux')
      state.llm.providers = moveProvider(state.llm.providers, 'tokenflux', 15)
      return state
    } catch (error) {
      logger.error('migrate 106 error', error as Error)
      return state
    }
  },
  '107': (state: RootState) => {
    try {
      if (state.paintings && !state.paintings.DMXAPIPaintings) {
        state.paintings.DMXAPIPaintings = []
      }
      return state
    } catch (error) {
      logger.error('migrate 107 error', error as Error)
      return state
    }
  },
  '108': (state: RootState) => {
    try {
      state.inputTools.toolOrder = DEFAULT_TOOL_ORDER
      state.inputTools.isCollapsed = false
      return state
    } catch (error) {
      logger.error('migrate 108 error', error as Error)
      return state
    }
  },
  '109': (state: RootState) => {
    try {
      state.settings.userTheme = settingsInitialState.userTheme
      return state
    } catch (error) {
      logger.error('migrate 109 error', error as Error)
      return state
    }
  },
  '110': (state: RootState) => {
    try {
      if (state.paintings && !state.paintings.tokenFluxPaintings) {
        state.paintings.tokenFluxPaintings = []
      }
      state.settings.showTokens = true
      state.settings.testPlan = false
      return state
    } catch (error) {
      logger.error('migrate 110 error', error as Error)
      return state
    }
  },
  '111': (state: RootState) => {
    try {
      addSelectionAction(state, 'quote')
      if (
        state.llm.translateModel.provider === 'silicon' &&
        state.llm.translateModel.id === 'meta-llama/Llama-3.3-70B-Instruct'
      ) {
        state.llm.translateModel = SYSTEM_MODELS.defaultModel[2]
      }

      // add selection_assistant_toggle and selection_assistant_select_text shortcuts after mini_window
      addShortcuts(state, ['selection_assistant_toggle', 'selection_assistant_select_text'], 'mini_window')

      return state
    } catch (error) {
      logger.error('migrate 111 error', error as Error)
      return state
    }
  },
  '112': (state: RootState) => {
    try {
      addProvider(state, 'cephalon')
      addProvider(state, '302ai')
      addProvider(state, 'lanyun')
      state.llm.providers = moveProvider(state.llm.providers, 'cephalon', 13)
      state.llm.providers = moveProvider(state.llm.providers, '302ai', 14)
      state.llm.providers = moveProvider(state.llm.providers, 'lanyun', 15)
      return state
    } catch (error) {
      logger.error('migrate 112 error', error as Error)
      return state
    }
  },
  '113': (state: RootState) => {
    try {
      addProvider(state, 'vertexai')
      if (!state.llm.settings.vertexai) {
        state.llm.settings.vertexai = llmInitialState.settings.vertexai
      }
      updateProvider(state, 'gemini', {
        isVertex: false
      })
      updateProvider(state, 'vertexai', {
        isVertex: true
      })
      return state
    } catch (error) {
      logger.error('migrate 113 error', error as Error)
      return state
    }
  },
  '114': (state: RootState) => {
    try {
      if (state.settings && state.settings.exportMenuOptions) {
        if (typeof state.settings.exportMenuOptions.plain_text === 'undefined') {
          state.settings.exportMenuOptions.plain_text = true
        }
      }
      if (state.settings) {
        state.settings.enableSpellCheck = false
        state.settings.spellCheckLanguages = []
      }
      return state
    } catch (error) {
      logger.error('migrate 114 error', error as Error)
      return state
    }
  },
  '115': (state: RootState) => {
    try {
      state.assistants.assistants.forEach((assistant) => {
        if (!assistant.settings) {
          assistant.settings = {
            temperature: DEFAULT_TEMPERATURE,
            contextCount: DEFAULT_CONTEXTCOUNT,
            topP: 1,
            toolUseMode: 'prompt',
            customParameters: [],
            streamOutput: true,
            enableMaxTokens: false
          }
        }
      })
      return state
    } catch (error) {
      logger.error('migrate 115 error', error as Error)
      return state
    }
  },
  '116': (state: RootState) => {
    try {
      if (state.websearch) {
        // migrate contentLimit to cutoffLimit
        // @ts-ignore eslint-disable-next-line
        if (state.websearch.contentLimit) {
          state.websearch.compressionConfig = {
            method: 'cutoff',
            cutoffUnit: 'char',
            // @ts-ignore eslint-disable-next-line
            cutoffLimit: state.websearch.contentLimit
          }
        } else {
          state.websearch.compressionConfig = { method: 'none', cutoffUnit: 'char' }
        }

        // @ts-ignore eslint-disable-next-line
        delete state.websearch.contentLimit
      }
      if (state.settings) {
        state.settings.testChannel = UpgradeChannel.LATEST
      }

      return state
    } catch (error) {
      logger.error('migrate 116 error', error as Error)
      return state
    }
  },
  '117': (state: RootState) => {
    try {
      const ppioProvider = state.llm.providers.find((provider) => provider.id === 'ppio')
      const modelsToRemove = [
        'qwen/qwen-2.5-72b-instruct',
        'qwen/qwen2.5-32b-instruct',
        'meta-llama/llama-3.1-70b-instruct',
        'meta-llama/llama-3.1-8b-instruct',
        '01-ai/yi-1.5-34b-chat',
        '01-ai/yi-1.5-9b-chat',
        'thudm/glm-z1-32b-0414',
        'thudm/glm-z1-9b-0414'
      ]
      if (ppioProvider) {
        updateProvider(state, 'ppio', {
          models: [
            ...ppioProvider.models.filter((model) => !modelsToRemove.includes(model.id)),
            ...SYSTEM_MODELS.ppio.filter(
              (systemModel) => !ppioProvider.models.some((existingModel) => existingModel.id === systemModel.id)
            )
          ],
          apiHost: 'https://api.ppinfra.com/v3/openai/'
        })
      }
      state.assistants.assistants.forEach((assistant) => {
        if (assistant.settings && assistant.settings.streamOutput === undefined) {
          assistant.settings = {
            ...assistant.settings,
            streamOutput: true
          }
        }
      })
      return state
    } catch (error) {
      logger.error('migrate 117 error', error as Error)
      return state
    }
  },
  '118': (state: RootState) => {
    try {
      addProvider(state, 'ph8')
      state.llm.providers = moveProvider(state.llm.providers, 'ph8', 14)

      if (!state.settings.userId) {
        state.settings.userId = uuid()
      }

      state.llm.providers.forEach((provider) => {
        if (provider.id === 'mistral') {
          provider.type = 'mistral'
        }
      })

      return state
    } catch (error) {
      logger.error('migrate 118 error', error as Error)
      return state
    }
  },
  '119': (state: RootState) => {
    try {
      addProvider(state, 'new-api')
      state.llm.providers = moveProvider(state.llm.providers, 'new-api', 16)
      state.settings.disableHardwareAcceleration = false
      // migrate to enable memory feature on sidebar
      if (state.settings && state.settings.sidebarIcons) {
        // Check if 'memory' is not already in visible icons
        if (!state.settings.sidebarIcons.visible.includes('memory' as any)) {
          state.settings.sidebarIcons.visible = [...state.settings.sidebarIcons.visible, 'memory' as any]
        }
      }
      return state
    } catch (error) {
      logger.error('migrate 119 error', error as Error)
      return state
    }
  },
  '120': (state: RootState) => {
    try {
      // migrate to remove memory feature from sidebar (moved to settings)
      if (state.settings && state.settings.sidebarIcons) {
        // Remove 'memory' from visible icons if present
        state.settings.sidebarIcons.visible = state.settings.sidebarIcons.visible.filter(
          (icon) => icon !== ('memory' as any)
        )
        // Remove 'memory' from disabled icons if present
        state.settings.sidebarIcons.disabled = state.settings.sidebarIcons.disabled.filter(
          (icon) => icon !== ('memory' as any)
        )
      }

      if (!state.settings.s3) {
        state.settings.s3 = settingsInitialState.s3
      }

      const langMap: Record<string, LanguageCode> = {
        english: 'en-us',
        chinese: 'zh-cn',
        'chinese-traditional': 'zh-tw',
        japanese: 'ja-jp',
        russian: 'ru-ru'
      }

      const origin = state.settings.targetLanguage
      const newLang = langMap[origin]
      if (newLang) state.settings.targetLanguage = newLang
      else state.settings.targetLanguage = 'en-us'

      state.llm.providers.forEach((provider) => {
        if (provider.id === 'azure-openai') {
          provider.type = 'azure-openai'
        }
      })

      state.settings.localBackupMaxBackups = 0
      state.settings.localBackupSkipBackupFile = false
      state.settings.localBackupDir = ''
      state.settings.localBackupAutoSync = false
      state.settings.localBackupSyncInterval = 0
      return state
    } catch (error) {
      logger.error('migrate 120 error', error as Error)
      return state
    }
  },
  '121': (state: RootState) => {
    try {
      const { toolOrder } = state.inputTools
      const urlContextKey = 'url_context'
      if (!toolOrder.visible.includes(urlContextKey)) {
        const webSearchIndex = toolOrder.visible.indexOf('web_search')
        const knowledgeBaseIndex = toolOrder.visible.indexOf('knowledge_base')
        if (webSearchIndex !== -1) {
          toolOrder.visible.splice(webSearchIndex, 0, urlContextKey)
        } else if (knowledgeBaseIndex !== -1) {
          toolOrder.visible.splice(knowledgeBaseIndex, 0, urlContextKey)
        } else {
          toolOrder.visible.push(urlContextKey)
        }
      }

      for (const assistant of state.assistants.assistants) {
        if (assistant.settings?.toolUseMode === 'prompt' && isFunctionCallingModel(assistant.model)) {
          assistant.settings.toolUseMode = 'function'
        }
      }

      if (state.settings && typeof state.settings.webdavDisableStream === 'undefined') {
        state.settings.webdavDisableStream = false
      }

      return state
    } catch (error) {
      logger.error('migrate 121 error', error as Error)
      return state
    }
  },
  '122': (state: RootState) => {
    try {
      state.settings.navbarPosition = 'left'
      return state
    } catch (error) {
      logger.error('migrate 122 error', error as Error)
      return state
    }
  },
  '123': (state: RootState) => {
    try {
      state.llm.providers.forEach((provider) => {
        provider.models.forEach((model) => {
          if (model.type && Array.isArray(model.type)) {
            model.capabilities = model.type.map((t) => ({
              type: t,
              isUserSelected: true
            }))
            delete model.type
          }
        })
      })

      const lanyunProvider = state.llm.providers.find((provider) => provider.id === 'lanyun')
      if (lanyunProvider && lanyunProvider.models.length === 0) {
        updateProvider(state, 'lanyun', { models: SYSTEM_MODELS.lanyun })
      }

      return state
    } catch (error) {
      logger.error('migrate 123 error', error as Error)
      return state
    }
  }, // 1.5.4
  '124': (state: RootState) => {
    try {
      state.assistants.assistants.forEach((assistant) => {
        if (assistant.settings && !assistant.settings.toolUseMode) {
          assistant.settings.toolUseMode = 'prompt'
        }
      })

      const updateModelTextDelta = (model?: Model) => {
        if (model) {
          model.supported_text_delta = true
          if (isNotSupportedTextDelta(model)) {
            model.supported_text_delta = false
          }
        }
      }

      state.llm.providers.forEach((provider) => {
        provider.models.forEach((model) => {
          updateModelTextDelta(model)
        })
      })
      state.assistants.assistants.forEach((assistant) => {
        updateModelTextDelta(assistant.defaultModel)
        updateModelTextDelta(assistant.model)
      })

      updateModelTextDelta(state.llm.defaultModel)
      updateModelTextDelta(state.llm.topicNamingModel)
      updateModelTextDelta(state.llm.translateModel)

      if (state.assistants.defaultAssistant.model) {
        updateModelTextDelta(state.assistants.defaultAssistant.model)
        updateModelTextDelta(state.assistants.defaultAssistant.defaultModel)
      }

      addProvider(state, 'aws-bedrock')

      // 初始化 awsBedrock 设置
      if (!state.llm.settings.awsBedrock) {
        state.llm.settings.awsBedrock = llmInitialState.settings.awsBedrock
      }

      return state
    } catch (error) {
      logger.error('migrate 124 error', error as Error)
      return state
    }
  },
  '125': (state: RootState) => {
    try {
      // Initialize API server configuration if not present
      if (!state.settings.apiServer) {
        state.settings.apiServer = {
          enabled: false,
          host: 'localhost',
          port: 23333,
          apiKey: `cs-sk-${uuid()}`
        }
      }
      return state
    } catch (error) {
      logger.error('migrate 125 error', error as Error)
      return state
    }
  },
  '126': (state: RootState) => {
    try {
      state.knowledge.bases.forEach((base) => {
        // @ts-ignore eslint-disable-next-line
        if (base.preprocessOrOcrProvider) {
          // @ts-ignore eslint-disable-next-line
          base.preprocessProvider = base.preprocessOrOcrProvider
          // @ts-ignore eslint-disable-next-line
          delete base.preprocessOrOcrProvider
          // @ts-ignore eslint-disable-next-line
          if (base.preprocessProvider.type === 'ocr') {
            // @ts-ignore eslint-disable-next-line
            delete base.preprocessProvider
          }
        }
      })
      return state
    } catch (error) {
      logger.error('migrate 126 error', error as Error)
      return state
    }
  },
  '127': (state: RootState) => {
    try {
      addProvider(state, 'poe')

      if (!state.settings.proxyBypassRules) {
        state.settings.proxyBypassRules = defaultByPassRules
      }

      // 迁移api选项设置
      state.llm.providers.forEach((provider) => {
        // 新字段默认支持
        const changes = {
          isNotSupportArrayContent: false,
          isNotSupportDeveloperRole: false,
          isNotSupportStreamOptions: false
        }
        if (!isSupportArrayContentProvider(provider) || provider.isNotSupportArrayContent) {
          // 原本开启了兼容模式的provider不受影响
          changes.isNotSupportArrayContent = true
        }
        if (!isSupportDeveloperRoleProvider(provider)) {
          changes.isNotSupportDeveloperRole = true
        }
        if (!isSupportStreamOptionsProvider(provider)) {
          changes.isNotSupportStreamOptions = true
        }
        updateProvider(state, provider.id, changes)
      })

      // 迁移以前删除掉的内置提供商
      for (const provider of state.llm.providers) {
        if (provider.isSystem && !isSystemProvider(provider)) {
          updateProvider(state, provider.id, { isSystem: false })
        }
      }

      return state
    } catch (error) {
      logger.error('migrate 127 error', error as Error)
      return state
    }
  },
  '128': (state: RootState) => {
    if (state.settings && state.settings.sidebarIcons) {
      // Check if 'notes' is not already in visible icons
      if (!state.settings.sidebarIcons.visible.includes('notes' as any)) {
        state.settings.sidebarIcons.visible = [...state.settings.sidebarIcons.visible, 'notes' as any]
      }
    }

    if (state.settings && state.settings.showWorkspace === undefined) {
      state.settings.showWorkspace = true
    }

    if (state.settings && state.settings.exportMenuOptions.notes === undefined) {
      state.settings.exportMenuOptions.notes = true
    }
    return state
  }
}

const migrate = createMigrate(migrateConfig as any)

export default migrate
