import { computed, createApp, defineComponent, h, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { createPinia, storeToRefs } from 'pinia'

import 'highlight.js/styles/github.css'

import { createWebUiHttpClient } from './service/httpClient'
import { createWebUiSseClient } from './service/sseClient'
import { useWebUiChatStore } from './stores/chatStore'
import type {
  WebUiAuthStatusResponse,
  WebUiContextUsage,
  WebUiContextUsageResponse,
  WebUiSlashCommand,
  WebUiSlashCommandsResponse,
  WebUiAgentSessionMessageEntity,
  WebUiAgentSessionEntity,
  WebUiAgentEntity,
  WebUiModel,
  WebUiConversationSummary,
  WebUiChunkPayload,
  WebUiCursorResponse,
  WebUiHealthResponse,
  WebUiMessageSnapshot,
  WebUiOffsetResponse,
  WebUiMessagePart,
  WebUiRole,
  WebUiToolCallSnapshot,
  WebUiToolCallState
} from './types/api'
import { renderMarkdown } from './utils/renderMarkdown'

type WebuiStatus = {
  readonly label: string
  readonly value: string
}

const fallbackLanguage = 'en-US'
const webUiLogoPath = './icon.png'

const normalizeLanguage = (language?: string | null) => {
  if (!language) return fallbackLanguage
  const lower = language.toLowerCase()

  return (
    {
      'de-de': 'de-DE',
      'el-gr': 'el-GR',
      'en-us': 'en-US',
      'es-es': 'es-ES',
      'fr-fr': 'fr-FR',
      'ja-jp': 'ja-JP',
      'pt-pt': 'pt-PT',
      'ro-ro': 'ro-RO',
      'ru-ru': 'ru-RU',
      'vi-vn': 'vi-VN',
      'zh-cn': 'zh-CN',
      'zh-tw': 'zh-TW'
    } as Record<string, string>
  )[lower] ?? fallbackLanguage
}

const textPacks = {
  'en-US': {
    agent: 'Agent',
    authDescription: 'Enter the WebUI access key configured in Cherry Studio.',
    authKey: 'Access key',
    authTitle: 'WebUI verification',
    bridgeStatus: 'Bridge status',
    cancel: 'Cancel',
    checkingBridge: 'Checking desktop bridge',
    close: 'Close',
    connected: 'Win11 desktop bridge connected',
    context: 'Context',
    copy: 'Copy',
    create: 'Create',
    creating: 'Creating...',
    desktopSession: 'Desktop session',
    disconnected: 'Desktop bridge unavailable',
    emptyConversation: 'This desktop conversation has no messages yet.',
    generating: 'Generating',
    invalidKey: 'Invalid access key',
    loadingConversations: 'Loading conversations',
    loadingMessages: 'Loading desktop messages',
    newConversation: 'New conversation',
    noAgents: 'No configured desktop Agents are available.',
    noContext: 'No context usage available',
    noSessions: 'No desktop sessions yet',
    reasoning: 'Reasoning',
    runtime: 'Runtime',
    selectConversation: 'Select a conversation',
    selectFirst: 'Select a desktop conversation first',
    send: 'Send',
    sendPlaceholder: 'Send a message to this desktop Agent session',
    serviceStarted: 'Started',
    sessionsChanged: 'The selected desktop conversation is no longer available.',
    sseClients: 'SSE clients',
    stop: 'Stop',
    stopped: 'Stopped',
    unavailable: 'Unavailable',
    verify: 'Verify',
    webui: 'WebUI'
  },
  'zh-CN': {
    agent: '智能体',
    authDescription: '请输入 Cherry Studio 设置中配置的 WebUI 访问 KEY。',
    authKey: '访问 KEY',
    authTitle: 'WebUI 安全验证',
    bridgeStatus: '连接状态',
    cancel: '取消',
    checkingBridge: '正在检查桌面桥接服务',
    close: '关闭',
    connected: 'Win11 桌面桥接已连接',
    context: '上下文',
    copy: '复制',
    create: '创建',
    creating: '创建中...',
    desktopSession: '桌面会话',
    disconnected: '桌面桥接不可用',
    emptyConversation: '此桌面会话暂无消息。',
    generating: '生成中',
    invalidKey: '访问 KEY 无效',
    loadingConversations: '正在加载会话',
    loadingMessages: '正在加载桌面消息',
    newConversation: '新建会话',
    noAgents: '暂无可用的桌面智能体。',
    noContext: '暂无上下文用量',
    noSessions: '暂无桌面会话',
    reasoning: '思考过程',
    runtime: '运行状态',
    selectConversation: '选择一个会话',
    selectFirst: '请先选择桌面会话',
    send: '发送',
    sendPlaceholder: '向此桌面智能体会话发送消息',
    serviceStarted: '启动时间',
    sessionsChanged: '选中的桌面会话已不可用。',
    sseClients: 'SSE 客户端',
    stop: '停止',
    stopped: '已停止',
    unavailable: '不可用',
    verify: '验证',
    webui: 'WebUI'
  },
  'zh-TW': {
    agent: '智慧體',
    authDescription: '請輸入 Cherry Studio 設定中配置的 WebUI 存取 KEY。',
    authKey: '存取 KEY',
    authTitle: 'WebUI 安全驗證',
    bridgeStatus: '連線狀態',
    cancel: '取消',
    checkingBridge: '正在檢查桌面橋接服務',
    close: '關閉',
    connected: 'Win11 桌面橋接已連線',
    context: '上下文',
    copy: '複製',
    create: '建立',
    creating: '建立中...',
    desktopSession: '桌面會話',
    disconnected: '桌面橋接不可用',
    emptyConversation: '此桌面會話尚無訊息。',
    generating: '生成中',
    invalidKey: '存取 KEY 無效',
    loadingConversations: '正在載入會話',
    loadingMessages: '正在載入桌面訊息',
    newConversation: '新增會話',
    noAgents: '尚無可用的桌面智慧體。',
    noContext: '暫無上下文用量',
    noSessions: '尚無桌面會話',
    reasoning: '思考過程',
    runtime: '執行狀態',
    selectConversation: '選擇一個會話',
    selectFirst: '請先選擇桌面會話',
    send: '傳送',
    sendPlaceholder: '向此桌面智慧體會話傳送訊息',
    serviceStarted: '啟動時間',
    sessionsChanged: '選取的桌面會話已不可用。',
    sseClients: 'SSE 用戶端',
    stop: '停止',
    stopped: '已停止',
    unavailable: '不可用',
    verify: '驗證',
    webui: 'WebUI'
  }
} as const

type TextKey = keyof (typeof textPacks)[typeof fallbackLanguage]

const toErrorMessage = (error: unknown) => {
  return error instanceof Error ? error.message : 'Unable to reach the desktop bridge'
}

const toConversationSummary = (session: WebUiAgentSessionEntity): WebUiConversationSummary => ({
  id: session.id,
  agentId: session.agentId,
  title: session.name || 'Untitled session',
  updatedAt: session.updatedAt,
  workspaceLabel: session.workspace?.name ?? session.workspace?.path
})

const terminalToolStates: ReadonlySet<WebUiToolCallState> = new Set(['output-available', 'output-error', 'output-denied'])

const toDisplayText = (value: unknown): string | undefined => {
  if (value === undefined) return undefined
  if (typeof value === 'string') return value

  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

const toToolName = (type: string, toolName?: string) => {
  if (toolName) return toolName
  if (type === 'dynamic-tool') return 'Tool'
  return type.startsWith('tool-') ? type.slice('tool-'.length) : type
}

const toToolState = (state?: string): WebUiToolCallState => {
  switch (state) {
    case 'input-streaming':
    case 'approval-requested':
    case 'output-available':
    case 'output-error':
    case 'output-denied':
      return state
    default:
      return 'input-available'
  }
}

const toToolCalls = (parts: readonly WebUiMessagePart[]) => {
  const tools = new Map<string, WebUiToolCallSnapshot>()

  for (const part of parts) {
    if (!part.type.startsWith('tool-') && part.type !== 'dynamic-tool') continue
    const id = part.toolCallId
    if (!id) continue
    const state = part.state ?? 'input-available'
    const input = toDisplayText(part.input)
    const output = toDisplayText(part.output)
    const tool: WebUiToolCallSnapshot = {
      id,
      name: toToolName(part.type, part.toolName),
      state: toToolState(state),
      ...(input ? { input } : {}),
      ...(output ? { output } : {}),
      ...(part.errorText ? { errorText: part.errorText } : {})
    }
    tools.set(id, tool)
  }

  return [...tools.values()]
}

const toMessageSnapshot = (message: WebUiAgentSessionMessageEntity): WebUiMessageSnapshot => {
  const parts = message.data.parts ?? []
  const content = parts
    .filter((part) => part.type === 'text' && typeof part.text === 'string')
    .map((part) => part.text as string)
    .join('')
  const reasoning = parts
    .filter((part) => part.type === 'reasoning' && typeof part.text === 'string')
    .map((part) => part.text as string)
    .join('')
  const toolCalls = toToolCalls(parts)

  return {
    id: message.id,
    conversationId: message.sessionId,
    role: message.role,
    content: content || message.searchableText || '',
    ...(reasoning ? { reasoning } : {}),
    ...(toolCalls.length ? { toolCalls } : {}),
    createdAt: message.createdAt
  }
}

const App = defineComponent({
  name: 'CherryStudioWebuiShell',
  setup() {
    const httpClient = createWebUiHttpClient()
    const sseClient = createWebUiSseClient()
    const chatStore = useWebUiChatStore()
    const { activeRunConversationId, conversations, messages, selectedConversationId } = storeToRefs(chatStore)
    const bridgeState = ref<'checking' | 'connected' | 'offline'>('checking')
    const language = ref(normalizeLanguage(navigator.language))
    const authRequired = ref(false)
    const isAuthenticated = ref(true)
    const authKeyDraft = ref('')
    const authError = ref('')
    const userName = ref('')
    const bridgeDetail = ref('')
    const serviceStartedAt = ref('Pending')
    const sseClientCount = ref('0')
    const conversationLoadState = ref<'idle' | 'loading' | 'ready' | 'error'>('idle')
    const conversationLoadMessage = ref('Loading conversations')
    const messageLoadState = ref<'idle' | 'loading' | 'ready' | 'error'>('idle')
    const messageLoadMessage = ref('')
    const composerText = ref('')
    const submitError = ref('')
    const agents = ref<readonly WebUiAgentEntity[]>([])
    const models = ref<readonly WebUiModel[]>([])
    const newConversationOpen = ref(false)
    const newConversationState = ref<'idle' | 'loading' | 'creating' | 'error'>('idle')
    const newConversationError = ref('')
    const selectedAgentId = ref('')
    const contextUsage = ref<WebUiContextUsage | null>(null)
    const slashCommands = ref<readonly WebUiSlashCommand[]>([])
    const modelPickerOpen = ref(false)
    const modelUpdateState = ref<'idle' | 'updating' | 'error'>('idle')
    const mobileSidebarOpen = ref(false)
    const messageStack = ref<HTMLElement>()
    const pendingChunks = new Map<string, WebUiChunkPayload[]>()
    let healthTimer: number | undefined
    let syncTimer: number | undefined
    let chunkFrame: number | undefined
    let latestMessageRequest = 0

    const selectedConversation = computed(() =>
      conversations.value.find((conversation) => conversation.id === selectedConversationId.value)
    )
    const selectedAgentName = computed(() => {
      const agentId = selectedConversation.value?.agentId
      return agents.value.find((agent) => agent.id === agentId)?.name
    })
    const selectedAgent = computed(() => agents.value.find((agent) => agent.id === selectedConversation.value?.agentId))
    const selectedModel = computed(() => models.value.find((model) => model.id === selectedAgent.value?.model))
    const modelPickerLabel = computed(() => selectedModel.value?.name ?? selectedAgent.value?.modelName ?? selectedAgent.value?.model ?? text('agent'))
    const contextUsagePercentage = computed(() => {
      if (!contextUsage.value?.maxTokens) return undefined
      return Math.min(100, Math.round((contextUsage.value.totalTokens / contextUsage.value.maxTokens) * 100))
    })
    const contextUsageLabel = computed(() => {
      if (contextUsagePercentage.value === undefined) return text('noContext')
      return `${text('context')}: ${contextUsagePercentage.value}%`
    })
    const contextUsageTone = computed(() => {
      const percentage = contextUsagePercentage.value
      if (percentage === undefined) return 'empty'
      if (percentage >= 90) return 'critical'
      if (percentage >= 75) return 'warning'
      return 'normal'
    })
    const slashCommandSuggestions = computed(() => {
      const input = composerText.value.trimStart()
      if (modelPickerOpen.value || !input.startsWith('/')) return []

      const query = input.slice(1).toLowerCase()
      return slashCommands.value.filter((command) => command.name.toLowerCase().startsWith(query)).slice(0, 6)
    })
    const messageAuthorName = (role: WebUiRole) => {
      if (role === 'user') return userName.value || role
      if (role === 'assistant') return selectedAgentName.value || role
      return role
    }

    const text = (key: TextKey) => {
      const pack = textPacks[language.value as keyof typeof textPacks] ?? textPacks[fallbackLanguage]
      return pack[key] ?? textPacks[fallbackLanguage][key]
    }

    const statusItems = computed<readonly WebuiStatus[]>(() => [
      {
        label: text('runtime'),
        value: bridgeDetail.value
      },
      {
        label: text('serviceStarted'),
        value: serviceStartedAt.value
      },
      {
        label: text('sseClients'),
        value: sseClientCount.value
      }
    ])

    const refreshHealth = async () => {
      try {
        const health = await httpClient.getJson<WebUiHealthResponse>('/api/health')
        language.value = normalizeLanguage(health.language)
        bridgeState.value = health.ok ? 'connected' : 'offline'
        bridgeDetail.value = health.ok ? text('connected') : text('disconnected')
        serviceStartedAt.value = new Date(health.startedAt).toLocaleString()
        sseClientCount.value = String(health.sseClients)
      } catch (error) {
        bridgeState.value = 'offline'
        bridgeDetail.value = toErrorMessage(error)
        serviceStartedAt.value = text('unavailable')
        sseClientCount.value = '0'
      }
    }

    const loadConversations = async () => {
      conversationLoadState.value = 'loading'
      conversationLoadMessage.value = text('loadingConversations')

      try {
        const sessions: WebUiAgentSessionEntity[] = []
        const seenCursors = new Set<string>()
        let cursor: string | undefined
        do {
          const query = new URLSearchParams({ limit: '200' })
          if (cursor) query.set('cursor', cursor)
          const page = await httpClient.getJson<WebUiCursorResponse<WebUiAgentSessionEntity>>(
            `/api/data/agent-sessions?${query.toString()}`
          )
          sessions.push(...page.items)
          cursor = page.nextCursor
          if (cursor && seenCursors.has(cursor)) break
          if (cursor) seenCursors.add(cursor)
        } while (cursor)
        conversations.value = sessions.map(toConversationSummary)
        if (
          selectedConversationId.value &&
          !conversations.value.some((conversation) => conversation.id === selectedConversationId.value)
        ) {
          selectedConversationId.value = undefined
          messages.value = []
          messageLoadState.value = 'idle'
          messageLoadMessage.value = text('sessionsChanged')
        }
        conversationLoadState.value = 'ready'
        conversationLoadMessage.value = conversations.value.length ? '' : text('noSessions')
      } catch (error) {
        conversations.value = []
        conversationLoadState.value = 'error'
        conversationLoadMessage.value = toErrorMessage(error)
      }
    }

    const loadConversationMessages = async (conversationId: string) => {
      const requestId = ++latestMessageRequest
      messageLoadState.value = 'loading'
      messageLoadMessage.value = text('loadingMessages')

      try {
        const sessionMessages: WebUiAgentSessionMessageEntity[] = []
        const seenCursors = new Set<string>()
        let cursor: string | undefined
        do {
          const query = new URLSearchParams({ limit: '200' })
          if (cursor) query.set('cursor', cursor)
          const page = await httpClient.getJson<WebUiCursorResponse<WebUiAgentSessionMessageEntity>>(
            `/api/data/agent-sessions/${encodeURIComponent(conversationId)}/messages?${query.toString()}`
          )
          sessionMessages.push(...page.items)
          cursor = page.nextCursor
          if (cursor && seenCursors.has(cursor)) break
          if (cursor) seenCursors.add(cursor)
        } while (cursor)
        if (requestId !== latestMessageRequest || selectedConversationId.value !== conversationId) return

        messages.value = sessionMessages.map(toMessageSnapshot).reverse()
        messageLoadState.value = 'ready'
        messageLoadMessage.value = messages.value.length ? '' : text('emptyConversation')
      } catch (error) {
        if (requestId !== latestMessageRequest || selectedConversationId.value !== conversationId) return

        messages.value = []
        messageLoadState.value = 'error'
        messageLoadMessage.value = toErrorMessage(error)
      }
    }

    const loadAgents = async () => {
      const page = await httpClient.getJson<WebUiOffsetResponse<WebUiAgentEntity>>('/api/data/agents')
      agents.value = page.items.filter((agent) => Boolean(agent.model))
    }

    const loadModels = async () => {
      const availableModels = await httpClient.getJson<readonly WebUiModel[]>('/api/data/models')
      models.value = availableModels.filter(
        (model) =>
          model.isEnabled &&
          !model.isHidden &&
          !model.capabilities.includes('embedding') &&
          !model.capabilities.includes('rerank') &&
          !model.capabilities.includes('image-generation')
      )
    }

    const updateSessionModel = async (model: WebUiModel) => {
      const conversationId = selectedConversationId.value
      if (!conversationId || model.id === selectedAgent.value?.model || modelUpdateState.value === 'updating') return

      modelUpdateState.value = 'updating'
      submitError.value = ''
      try {
        await httpClient.patchJson(`/api/agent-sessions/${encodeURIComponent(conversationId)}/model`, { model: model.id })
        await loadAgents()
        refreshComposerInfo(conversationId)
        modelPickerOpen.value = false
        modelUpdateState.value = 'idle'
      } catch (error) {
        submitError.value = toErrorMessage(error)
        modelUpdateState.value = 'error'
      }
    }

    const refreshComposerInfo = (conversationId = selectedConversationId.value) => {
      if (!conversationId) return
      void httpClient
        .getJson<WebUiContextUsageResponse>(`/api/agent-sessions/${encodeURIComponent(conversationId)}/context-usage`)
        .then((response) => {
          if (selectedConversationId.value === conversationId) contextUsage.value = response.usage
        })
        .catch(() => {
          if (selectedConversationId.value === conversationId) contextUsage.value = null
        })
    }

    const refreshSlashCommands = (conversationId = selectedConversationId.value) => {
      if (!conversationId) return
      void httpClient
        .getJson<WebUiSlashCommandsResponse>(`/api/agent-sessions/${encodeURIComponent(conversationId)}/slash-commands`)
        .then((response) => {
          if (selectedConversationId.value === conversationId) slashCommands.value = response.commands
        })
        .catch(() => {
          if (selectedConversationId.value === conversationId) slashCommands.value = []
        })
    }

    const selectConversation = (conversationId: string) => {
      if (conversationId === selectedConversationId.value) return

      selectedConversationId.value = conversationId
      mobileSidebarOpen.value = false
      void loadConversationMessages(conversationId)
      refreshComposerInfo(conversationId)
      refreshSlashCommands(conversationId)
    }

    const openNewConversation = async () => {
      newConversationOpen.value = true
      newConversationState.value = 'loading'
      newConversationError.value = ''

      try {
        await loadAgents()
        selectedAgentId.value = agents.value[0]?.id ?? ''
        newConversationState.value = 'idle'
        if (!agents.value.length) newConversationError.value = text('noAgents')
      } catch (error) {
        agents.value = []
        selectedAgentId.value = ''
        newConversationState.value = 'error'
        newConversationError.value = toErrorMessage(error)
      }
    }

    const createConversation = async () => {
      if (!selectedAgentId.value || newConversationState.value === 'creating') return

      newConversationState.value = 'creating'
      newConversationError.value = ''
      try {
        const session = await httpClient.postJson<WebUiAgentSessionEntity>('/api/data/agent-sessions', {
          agentId: selectedAgentId.value,
          name: '',
          workspace: { type: 'system' }
        })
        newConversationOpen.value = false
        await loadConversations()
        selectConversation(session.id)
      } catch (error) {
        newConversationState.value = 'error'
        newConversationError.value = toErrorMessage(error)
      }
    }

    const refreshFromDesktopSync = () => {
      if (syncTimer) window.clearTimeout(syncTimer)
      syncTimer = window.setTimeout(() => {
        syncTimer = undefined
        void loadConversations()
        if (selectedConversationId.value) {
          void loadConversationMessages(selectedConversationId.value)
          refreshComposerInfo(selectedConversationId.value)
        }
      }, 180)
    }

    const applyStreamChunk = (payload: WebUiChunkPayload) => {
      if (payload.conversationId !== selectedConversationId.value) return

      const messageIndex = messages.value.findIndex((message) => message.id === payload.messageId)
      if (messageIndex < 0) return

      const nextMessages = [...messages.value]
      const message = nextMessages[messageIndex]
      if (!message) return
      const chunk = payload.chunk
      if (chunk.type === 'text-delta' && chunk.delta) {
        nextMessages[messageIndex] = { ...message, content: `${message.content}${chunk.delta}` }
      } else if (chunk.type === 'reasoning-delta' && chunk.delta) {
        nextMessages[messageIndex] = { ...message, reasoning: `${message.reasoning ?? ''}${chunk.delta}` }
      } else if (chunk.toolCallId) {
        const previousTools = message.toolCalls ?? []
        const previousTool = previousTools.find((tool) => tool.id === chunk.toolCallId)
        const input = toDisplayText(chunk.input)
        const output = toDisplayText(chunk.output)
        const nextTool: WebUiToolCallSnapshot = {
          id: chunk.toolCallId,
          name: chunk.toolName ?? previousTool?.name ?? 'Tool',
          state:
            chunk.type === 'tool-approval-request'
              ? 'approval-requested'
              : chunk.type === 'tool-output-available'
                ? 'output-available'
                : chunk.type === 'tool-output-error'
                  ? 'output-error'
                  : chunk.type === 'tool-output-denied'
                    ? 'output-denied'
                    : chunk.type === 'tool-input-start'
                      ? 'input-streaming'
                      : chunk.type === 'tool-input-available'
                        ? 'input-available'
                        : previousTool?.state ?? 'input-streaming',
          ...(chunk.type === 'tool-input-delta'
            ? { input: `${previousTool?.input ?? ''}${chunk.inputTextDelta ?? ''}` }
            : input
              ? { input }
              : previousTool?.input
                ? { input: previousTool.input }
                : {}),
          ...(output ? { output } : previousTool?.output ? { output: previousTool.output } : {}),
          ...(chunk.errorText ? { errorText: chunk.errorText } : previousTool?.errorText ? { errorText: previousTool.errorText } : {})
        }
        nextMessages[messageIndex] = {
          ...message,
          toolCalls: [...previousTools.filter((tool) => tool.id !== chunk.toolCallId), nextTool]
        }
      } else {
        return
      }
      messages.value = nextMessages
    }

    const queueStreamChunk = (payload: WebUiChunkPayload) => {
      const chunks = pendingChunks.get(payload.messageId) ?? []
      chunks.push(payload)
      pendingChunks.set(payload.messageId, chunks)
      if (chunkFrame !== undefined) return

      chunkFrame = window.requestAnimationFrame(() => {
        chunkFrame = undefined
        for (const queued of pendingChunks.values()) {
          for (const chunk of queued) applyStreamChunk(chunk)
        }
        pendingChunks.clear()
      })
    }

    const scrollMessagesToEnd = () => {
      void nextTick(() => {
        if (messageStack.value) messageStack.value.scrollTop = messageStack.value.scrollHeight
      })
    }

    watch(messages, scrollMessagesToEnd)

    const submitMessage = async () => {
      const conversationId = selectedConversationId.value
      const text = composerText.value.trim()
      if (!conversationId || !text || activeRunConversationId.value) return

      submitError.value = ''
      activeRunConversationId.value = conversationId
      try {
        await httpClient.postJson(`/api/agent-sessions/${encodeURIComponent(conversationId)}/messages`, { text })
        composerText.value = ''
        await loadConversationMessages(conversationId)
        refreshSlashCommands(conversationId)
      } catch (error) {
        submitError.value = toErrorMessage(error)
        activeRunConversationId.value = undefined
      }
    }

    const abortMessage = async () => {
      const conversationId = selectedConversationId.value
      if (!conversationId || activeRunConversationId.value !== conversationId) return

      try {
        await httpClient.postJson(`/api/agent-sessions/${encodeURIComponent(conversationId)}/abort`, {})
      } catch (error) {
        submitError.value = toErrorMessage(error)
        activeRunConversationId.value = undefined
      }
    }

    const startAuthenticatedSession = () => {
      void refreshHealth()
      void loadConversations()
      void loadAgents().catch(() => {
        agents.value = []
      })
      void loadModels().catch(() => {
        models.value = []
      })
      sseClient.connect()
      if (!healthTimer) healthTimer = window.setInterval(() => void refreshHealth(), 15_000)
    }

    const loadAuthStatus = async () => {
      try {
        const status = await httpClient.getJson<WebUiAuthStatusResponse>('/api/auth/status')
        language.value = normalizeLanguage(status.language)
        userName.value = status.userName?.trim() ?? ''
        authRequired.value = status.authRequired
        isAuthenticated.value = !status.authRequired
        bridgeDetail.value = text('checkingBridge')
        serviceStartedAt.value = text('unavailable')
        if (!status.authRequired) startAuthenticatedSession()
      } catch (error) {
        bridgeState.value = 'offline'
        bridgeDetail.value = toErrorMessage(error)
        serviceStartedAt.value = text('unavailable')
      }
    }

    const verifyAuthKey = async () => {
      const key = authKeyDraft.value.trim()
      if (!key) {
        authError.value = text('invalidKey')
        return
      }

      httpClient.setAuthKey(key)
      sseClient.setAuthKey(key)
      try {
        await refreshHealth()
        authError.value = ''
        isAuthenticated.value = true
        startAuthenticatedSession()
      } catch {
        httpClient.setAuthKey('')
        sseClient.setAuthKey('')
        authError.value = text('invalidKey')
        isAuthenticated.value = false
      }
    }

    const unsubscribeSync = sseClient.subscribe('sync', refreshFromDesktopSync)
    const unsubscribeChunk = sseClient.subscribe<WebUiChunkPayload>('chunk', ({ data }) => {
      if (data && typeof data === 'object') queueStreamChunk(data)
    })
    const unsubscribeDone = sseClient.subscribe<{ conversationId?: string }>('done', ({ data }) => {
      if (data?.conversationId === activeRunConversationId.value) activeRunConversationId.value = undefined
      if (data?.conversationId === selectedConversationId.value) {
        refreshComposerInfo(data.conversationId)
        refreshSlashCommands(data.conversationId)
      }
    })
    const unsubscribeError = sseClient.subscribe<{ conversationId?: string; message?: string }>('error', ({ data }) => {
      if (data?.conversationId === activeRunConversationId.value) {
        submitError.value = data.message ?? text('disconnected')
        activeRunConversationId.value = undefined
      }
    })

    onMounted(() => {
      void loadAuthStatus()
    })

    onBeforeUnmount(() => {
      if (healthTimer) window.clearInterval(healthTimer)
      if (syncTimer) window.clearTimeout(syncTimer)
      if (chunkFrame !== undefined) window.cancelAnimationFrame(chunkFrame)
      pendingChunks.clear()
      unsubscribeSync()
      unsubscribeChunk()
      unsubscribeDone()
      unsubscribeError()
      sseClient.close()
    })

    return () =>
      authRequired.value && !isAuthenticated.value
        ? h('main', { class: 'auth-shell' }, [
            h('section', { class: 'auth-panel' }, [
              h('img', { class: 'brand-logo', src: webUiLogoPath, alt: 'Cherry Studio' }),
              h('h1', text('authTitle')),
              h('p', { class: 'empty-copy' }, text('authDescription')),
              h('label', { class: 'field-label', for: 'webui-auth-key' }, text('authKey')),
              h('input', {
                id: 'webui-auth-key',
                autocomplete: 'current-password',
                type: 'password',
                value: authKeyDraft.value,
                onInput: (event: Event) => {
                  authKeyDraft.value = (event.target as HTMLInputElement).value
                },
                onKeydown: (event: KeyboardEvent) => {
                  if (event.key === 'Enter') {
                    event.preventDefault()
                    void verifyAuthKey()
                  }
                }
              }),
              authError.value ? h('p', { class: 'composer-error', role: 'alert' }, authError.value) : undefined,
              h(
                'button',
                {
                  class: 'send-button',
                  type: 'button',
                  onClick: () => void verifyAuthKey()
                },
                text('verify')
              )
            ])
          ])
        :
      h('main', { class: 'webui-shell' }, [
        mobileSidebarOpen.value
          ? h('button', {
              class: 'mobile-sidebar-backdrop',
              type: 'button',
              'aria-label': text('close'),
              onClick: () => {
                mobileSidebarOpen.value = false
              }
            })
          : undefined,
        h('section', { class: ['conversation-list', { 'conversation-list-open': mobileSidebarOpen.value }], 'aria-label': text('newConversation') }, [
          h('header', { class: 'panel-header' }, [
            h('img', { class: 'brand-logo', src: webUiLogoPath, alt: 'Cherry Studio' }),
            h('div', [
              h('p', { class: 'eyebrow' }, 'Cherry Studio'),
              h('h1', text('webui'))
            ]),
            h(
              'button',
              {
                class: 'mobile-close-button',
                type: 'button',
                title: text('close'),
                'aria-label': text('close'),
                onClick: () => {
                  mobileSidebarOpen.value = false
                }
              },
              '×'
            )
          ]),
          h(
            'button',
            {
              class: 'new-chat-button',
              type: 'button',
              onClick: () => void openNewConversation()
            },
            text('newConversation')
          ),
          h(
            'p',
            { class: ['empty-copy', `empty-copy-${conversationLoadState.value}`] },
            conversationLoadMessage.value
          ),
          h(
            'nav',
            { class: 'conversation-nav', 'aria-label': text('desktopSession') },
            conversations.value.map((conversation) =>
              h(
                'button',
                {
                  key: conversation.id,
                  type: 'button',
                  class: [
                    'conversation-item',
                    { 'conversation-item-selected': conversation.id === selectedConversationId.value }
                  ],
                  'aria-current': conversation.id === selectedConversationId.value ? 'page' : undefined,
                  onClick: () => selectConversation(conversation.id)
                },
                [
                  h('span', { class: 'conversation-title' }, conversation.title),
                  h('span', { class: 'conversation-meta' }, [
                    conversation.workspaceLabel ? `${conversation.workspaceLabel} · ` : '',
                    new Date(conversation.updatedAt).toLocaleString()
                  ])
                ]
              )
            )
          )
        ]),
        h('section', { class: 'chat-stage', 'aria-label': text('desktopSession') }, [
          h('header', { class: 'chat-header' }, [
            h('div', [
              h('p', { class: 'eyebrow' }, selectedConversation.value?.workspaceLabel ?? text('desktopSession')),
              h('h2', selectedConversation.value?.title ?? text('selectConversation'))
            ]),
            h('div', { class: 'mobile-chat-actions' }, [
              h(
                'span',
                {
                  class: ['context-orb', `context-orb-${contextUsageTone.value}`],
                  title: contextUsageLabel.value,
                  role: 'img',
                  'aria-label': contextUsageLabel.value,
                  style: { '--context-usage': `${contextUsagePercentage.value ?? 0}%` }
                },
                contextUsagePercentage.value === undefined ? '·' : `${contextUsagePercentage.value}%`
              ),
              h('span', {
                class: ['mobile-bridge-indicator', `mobile-bridge-indicator-${bridgeState.value}`],
                role: 'status',
                title: bridgeDetail.value,
                'aria-label': bridgeDetail.value
              }),
              h(
                'button',
                {
                  class: 'mobile-sidebar-button',
                  type: 'button',
                  title: text('desktopSession'),
                  'aria-label': text('desktopSession'),
                  'aria-expanded': mobileSidebarOpen.value,
                  onClick: () => {
                    mobileSidebarOpen.value = !mobileSidebarOpen.value
                  }
                },
                '☰'
              )
            ])
          ]),
          h('div', { class: 'message-stack', 'aria-live': 'polite', ref: messageStack }, [
            messageLoadMessage.value ? h('p', { class: 'empty-copy' }, messageLoadMessage.value) : undefined,
            ...messages.value.map((message) =>
              h(
                'article',
                {
                  class: ['message', message.role === 'user' ? 'user-message' : 'assistant-message'],
                  key: message.id
                },
                [
                  h('header', { class: 'message-header' }, [
                    h('p', { class: 'message-role' }, messageAuthorName(message.role)),
                    message.content
                      ? h(
                          'button',
                          {
                            class: 'copy-button',
                            type: 'button',
                            onClick: () => void navigator.clipboard.writeText(message.content)
                          },
                          text('copy')
                        )
                      : undefined
                  ]),
                  message.reasoning
                    ? h('details', { class: 'reasoning-block' }, [
                        h('summary', text('reasoning')),
                        h('div', { class: 'markdown-content', innerHTML: renderMarkdown(message.reasoning) })
                      ])
                    : undefined,
                  ...(message.toolCalls ?? []).map((tool) =>
                    h('details', { class: ['tool-call', `tool-call-${tool.state}`], open: !terminalToolStates.has(tool.state) }, [
                      h('summary', [
                        h('span', { class: 'tool-state-indicator', 'aria-hidden': 'true' }),
                        h('span', { class: 'tool-call-name' }, tool.name),
                        h('span', { class: 'tool-call-state' }, tool.state.replaceAll('-', ' '))
                      ]),
                      h('div', { class: 'tool-call-body' }, [
                        tool.input ? h('pre', { class: 'tool-call-data' }, tool.input) : undefined,
                        tool.output ? h('pre', { class: 'tool-call-data' }, tool.output) : undefined,
                        tool.errorText ? h('p', { class: 'tool-call-error' }, tool.errorText) : undefined
                      ])
                    ])
                  ),
                  message.content
                    ? h('div', { class: 'markdown-content', innerHTML: renderMarkdown(message.content) })
                    : message.toolCalls?.length
                      ? undefined
                      : h('span', { class: 'streaming-placeholder', 'aria-label': text('generating') }),
                  h('time', { class: 'message-time', datetime: message.createdAt }, new Date(message.createdAt).toLocaleString())
                ]
              )
            )
          ]),
          h('footer', { class: 'composer' }, [
            h('div', { class: 'composer-surface' }, [
              h('textarea', {
                disabled: !selectedConversation.value || activeRunConversationId.value === selectedConversationId.value,
                value: composerText.value,
                placeholder: selectedConversation.value ? text('sendPlaceholder') : text('selectFirst'),
                rows: 3,
                onInput: (event: Event) => {
                  composerText.value = (event.target as HTMLTextAreaElement).value
                },
                onKeydown: (event: KeyboardEvent) => {
                  if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
                    event.preventDefault()
                    void submitMessage()
                  }
                }
              }),
              h('div', { class: 'composer-toolbar' }, [
                h(
                  'button',
                  {
                    class: 'model-selector-button',
                    type: 'button',
                    disabled: !selectedConversation.value || !models.value.length || modelUpdateState.value === 'updating',
                    title: selectedAgentName.value ? `${selectedAgentName.value}: ${modelPickerLabel.value}` : modelPickerLabel.value,
                    'aria-expanded': modelPickerOpen.value,
                    onClick: () => {
                      modelPickerOpen.value = !modelPickerOpen.value
                    }
                  },
                  modelUpdateState.value === 'updating' ? text('generating') : modelPickerLabel.value
                ),
                h(
                  'button',
                  {
                    class: ['send-button', { 'send-button-is-stop': activeRunConversationId.value === selectedConversationId.value }],
                    type: 'button',
                    disabled: !selectedConversation.value || (!composerText.value.trim() && activeRunConversationId.value !== selectedConversationId.value),
                    'aria-label': activeRunConversationId.value === selectedConversationId.value ? text('stop') : text('send'),
                    title: activeRunConversationId.value === selectedConversationId.value ? text('stop') : text('send'),
                    onClick: () => {
                      if (activeRunConversationId.value === selectedConversationId.value) {
                        void abortMessage()
                        return
                      }
                      void submitMessage()
                    }
                  },
                  activeRunConversationId.value === selectedConversationId.value ? text('stop') : text('send')
                )
              ]),
            modelPickerOpen.value
              ? h(
                  'div',
                  { class: 'model-picker-menu', role: 'listbox' },
                  models.value.map((model) =>
                    h(
                      'button',
                      {
                        class: ['model-picker-option', { 'model-picker-option-selected': model.id === selectedAgent.value?.model }],
                        key: model.id,
                        type: 'button',
                        role: 'option',
                        'aria-selected': model.id === selectedAgent.value?.model,
                        onClick: () => void updateSessionModel(model)
                      },
                      [
                        h('span', { class: 'model-picker-name' }, model.name),
                        h('span', { class: 'model-picker-provider' }, model.providerId)
                      ]
                    )
                  )
                )
              : undefined,
            slashCommandSuggestions.value.length
              ? h(
                  'div',
                  { class: 'slash-command-menu', role: 'listbox' },
                  slashCommandSuggestions.value.map((command) =>
                    h(
                      'button',
                      {
                        class: 'slash-command-option',
                        key: command.name,
                        type: 'button',
                        role: 'option',
                        onClick: () => {
                          composerText.value = `/${command.name} `
                        }
                      },
                      [
                        h('span', { class: 'slash-command-name' }, `/${command.name}`),
                        command.description ? h('span', { class: 'slash-command-description' }, command.description) : undefined
                      ]
                    )
                  )
                )
              : undefined,
            ])
          ]),
          submitError.value ? h('p', { class: 'composer-error', role: 'alert' }, submitError.value) : undefined
        ]),
        h('aside', { class: 'status-panel', 'aria-label': text('bridgeStatus') }, [
          h('h2', text('bridgeStatus')),
          h('div', {
            class: ['bridge-indicator', `bridge-indicator-${bridgeState.value}`],
            role: 'status',
            'aria-live': 'polite'
          }),
          ...statusItems.value.map((item) =>
            h('dl', { class: 'status-row', key: item.label }, [
              h('dt', item.label),
              h('dd', item.value)
            ])
          )
        ]),
        newConversationOpen.value
          ? h('div', { class: 'modal-backdrop' }, [
              h('section', { class: 'new-conversation-dialog', role: 'dialog', 'aria-modal': 'true' }, [
                h('header', { class: 'dialog-header' }, [
                  h('h2', text('newConversation')),
                  h(
                    'button',
                    {
                      class: 'icon-button',
                      type: 'button',
                      title: text('close'),
                      'aria-label': text('close'),
                      onClick: () => {
                        newConversationOpen.value = false
                      }
                    },
                    '×'
                  )
                ]),
                h('label', { class: 'field-label', for: 'agent-select' }, text('agent')),
                h(
                  'select',
                  {
                    id: 'agent-select',
                    disabled: newConversationState.value === 'loading' || !agents.value.length,
                    value: selectedAgentId.value,
                    onChange: (event: Event) => {
                      selectedAgentId.value = (event.target as HTMLSelectElement).value
                    }
                  },
                  agents.value.map((agent) =>
                    h('option', { key: agent.id, value: agent.id }, `${agent.name} · ${agent.modelName ?? agent.model}`)
                  )
                ),
                newConversationError.value
                  ? h('p', { class: 'composer-error', role: 'alert' }, newConversationError.value)
                  : undefined,
                h('footer', { class: 'dialog-actions' }, [
                  h(
                    'button',
                    {
                      class: 'secondary-button',
                      type: 'button',
                      onClick: () => {
                        newConversationOpen.value = false
                      }
                    },
                    text('cancel')
                  ),
                  h(
                    'button',
                    {
                      class: 'send-button',
                      type: 'button',
                      disabled: !selectedAgentId.value || newConversationState.value === 'creating',
                      onClick: () => void createConversation()
                    },
                    newConversationState.value === 'creating' ? text('creating') : text('create')
                  )
                ])
              ])
            ])
          : undefined
      ])
  }
})

const style = document.createElement('style')
style.textContent = `
  :root {
    color: #1f2937;
    background: #f6f7fb;
    font-family:
      Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  }

  * {
    box-sizing: border-box;
  }

  body {
    min-width: 320px;
    height: 100vh;
    height: 100dvh;
    margin: 0;
    overflow: hidden;
  }

  button,
  textarea,
  select {
    font: inherit;
  }

  .webui-shell {
    display: grid;
    grid-template-columns: minmax(240px, 280px) minmax(0, 1fr) minmax(220px, 260px);
    height: 100vh;
    height: 100dvh;
    overflow: hidden;
  }

  .auth-shell {
    display: grid;
    min-height: 100vh;
    place-items: center;
    padding: 24px;
  }

  .auth-panel {
    display: grid;
    width: min(420px, 100%);
    gap: 14px;
    padding: 24px;
    background: #ffffff;
    border: 1px solid #e5e7eb;
    border-radius: 8px;
    box-shadow: 0 18px 48px rgb(17 24 39 / 10%);
  }

  .conversation-list,
  .status-panel {
    min-height: 0;
    overflow-y: auto;
    padding: 20px;
    background: #ffffff;
    border-color: #e5e7eb;
  }

  .conversation-list {
    border-right: 1px solid #e5e7eb;
  }

  .status-panel {
    border-left: 1px solid #e5e7eb;
  }

  .panel-header {
    display: flex;
    gap: 12px;
    align-items: center;
    margin-bottom: 24px;
  }

  .brand-logo {
    display: block;
    width: 40px;
    height: 40px;
    border-radius: 8px;
  }

  .mobile-close-button,
  .mobile-sidebar-button {
    display: none;
  }

  .mobile-chat-actions {
    display: flex;
    gap: 10px;
    align-items: center;
  }

  .eyebrow {
    margin: 0 0 2px;
    color: #6b7280;
    font-size: 12px;
  }

  h1,
  h2,
  p {
    margin-top: 0;
  }

  h1 {
    margin-bottom: 0;
    font-size: 22px;
    overflow-wrap: anywhere;
  }

  h2 {
    margin-bottom: 16px;
    font-size: 16px;
    overflow-wrap: anywhere;
  }

  .new-chat-button,
  .send-button {
    min-height: 40px;
    padding: 0 14px;
    color: #ffffff;
    background: #111827;
    border: 0;
    border-radius: 8px;
  }

  .new-chat-button {
    width: 100%;
  }

  .secondary-button,
  .icon-button {
    min-height: 40px;
    padding: 0 14px;
    color: #1f2937;
    background: #ffffff;
    border: 1px solid #d1d5db;
    border-radius: 8px;
    cursor: pointer;
  }

  .icon-button {
    width: 40px;
    padding: 0;
    font-size: 22px;
  }

  button:disabled,
  textarea:disabled {
    cursor: not-allowed;
    opacity: 0.58;
  }

  .empty-copy {
    margin-top: 18px;
    color: #6b7280;
    font-size: 14px;
    line-height: 1.6;
  }

  .conversation-nav {
    display: grid;
    gap: 8px;
    margin-top: 18px;
  }

  .conversation-item {
    display: grid;
    width: 100%;
    min-height: 58px;
    padding: 10px 12px;
    text-align: left;
    background: #f9fafb;
    border: 1px solid #e5e7eb;
    border-radius: 8px;
    cursor: pointer;
  }

  .conversation-item:hover,
  .conversation-item-selected {
    background: #eef2ff;
    border-color: #a5b4fc;
  }

  .conversation-title {
    overflow: hidden;
    color: #111827;
    font-size: 14px;
    font-weight: 600;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .conversation-meta {
    overflow: hidden;
    color: #6b7280;
    font-size: 12px;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .chat-stage {
    display: grid;
    grid-template-rows: auto minmax(0, 1fr) auto;
    height: 100vh;
    height: 100dvh;
    min-width: 0;
    overflow: hidden;
    padding: 20px 28px 16px;
  }

  .message-stack {
    display: flex;
    flex-direction: column;
    gap: 14px;
    min-height: 0;
    overflow-y: auto;
    padding: 16px 4px 12px;
  }

  .chat-header {
    display: flex;
    gap: 12px;
    align-items: center;
    justify-content: space-between;
    padding-bottom: 16px;
    border-bottom: 1px solid #e5e7eb;
  }

  .chat-header h2 {
    margin-bottom: 0;
  }

  .chat-header > div:first-child {
    min-width: 0;
  }

  .chat-header .eyebrow,
  .chat-header h2 {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .context-orb {
    display: grid;
    width: 40px;
    height: 40px;
    flex: 0 0 auto;
    place-items: center;
    color: #334155;
    font-size: 11px;
    font-variant-numeric: tabular-nums;
    font-weight: 700;
    background: radial-gradient(circle at center, #ffffff 62%, transparent 64%),
      conic-gradient(var(--context-color) var(--context-usage), #e2e8f0 0);
    border-radius: 50%;
  }

  .context-orb-normal {
    --context-color: #22c55e;
  }

  .context-orb-warning {
    --context-color: #f59e0b;
  }

  .context-orb-critical {
    --context-color: #ef4444;
  }

  .context-orb-empty {
    color: #94a3b8;
    background: radial-gradient(circle at center, #ffffff 62%, transparent 64%), #e2e8f0;
  }

  .message {
    max-width: min(680px, 86%);
    padding: 14px 16px;
    line-height: 1.6;
    background: #ffffff;
    border: 1px solid #e5e7eb;
    border-radius: 8px;
  }

  .user-message {
    align-self: flex-end;
    color: #ffffff;
    background: #2563eb;
    border-color: #2563eb;
  }

  .user-message ::selection {
    color: #111827;
    background: #fef08a;
  }

  .assistant-message {
    align-self: flex-start;
  }

  .message p {
    margin-bottom: 0;
  }

  .message-role,
  .message-time {
    display: block;
    margin-bottom: 8px;
    font-size: 12px;
    opacity: 0.78;
  }

  .message-header {
    display: flex;
    gap: 12px;
    align-items: center;
    justify-content: space-between;
  }

  .copy-button {
    padding: 2px 6px;
    color: inherit;
    font-size: 12px;
    background: transparent;
    border: 0;
    cursor: pointer;
    opacity: 0.72;
  }

  .markdown-content {
    overflow-wrap: anywhere;
  }

  .markdown-content > :first-child {
    margin-top: 0;
  }

  .markdown-content > :last-child {
    margin-bottom: 0;
  }

  .markdown-content pre {
    max-width: 100%;
    padding: 12px;
    overflow-x: auto;
    color: #e5e7eb;
    background: #17191f;
    border-radius: 6px;
  }

  .markdown-content code:not(pre code) {
    padding: 2px 5px;
    color: #9f1239;
    background: #fff1f2;
    border-radius: 4px;
  }

  .markdown-content a {
    color: #1d4ed8;
  }

  .markdown-content table {
    display: block;
    max-width: 100%;
    overflow-x: auto;
    border-collapse: collapse;
    border: 1px solid #d1d5db;
  }

  .markdown-content th,
  .markdown-content td {
    min-width: 88px;
    padding: 8px 10px;
    text-align: left;
    vertical-align: top;
    border: 1px solid #d1d5db;
  }

  .markdown-content th {
    font-weight: 600;
    background: #f3f4f6;
  }

  .reasoning-block {
    margin-bottom: 12px;
    padding: 10px 12px;
    color: #4b5563;
    background: #f3f4f6;
    border-left: 3px solid #9ca3af;
    border-radius: 4px;
  }

  .reasoning-block summary {
    cursor: pointer;
    font-size: 13px;
    font-weight: 600;
  }

  .reasoning-block[open] summary {
    margin-bottom: 8px;
  }

  .tool-call {
    margin: 0 0 10px;
    color: #374151;
    background: #f9fafb;
    border: 1px solid #e5e7eb;
    border-radius: 6px;
  }

  .tool-call summary {
    display: flex;
    gap: 8px;
    align-items: center;
    min-height: 36px;
    padding: 0 10px;
    cursor: pointer;
    list-style: none;
  }

  .tool-call summary::-webkit-details-marker {
    display: none;
  }

  .tool-state-indicator {
    width: 8px;
    height: 8px;
    flex: 0 0 auto;
    background: #6b7280;
    border-radius: 999px;
  }

  .tool-call-input-streaming .tool-state-indicator,
  .tool-call-approval-requested .tool-state-indicator {
    background: #d97706;
    animation: pulse 1s ease-in-out infinite;
  }

  .tool-call-output-available .tool-state-indicator {
    background: #16a34a;
  }

  .tool-call-output-error .tool-state-indicator,
  .tool-call-output-denied .tool-state-indicator {
    background: #dc2626;
  }

  .tool-call-name {
    overflow: hidden;
    font-size: 13px;
    font-weight: 600;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .tool-call-state {
    margin-left: auto;
    color: #6b7280;
    font-size: 12px;
    text-transform: capitalize;
  }

  .tool-call-body {
    padding: 0 10px 10px;
  }

  .tool-call-data {
    max-height: 240px;
    margin: 0;
    padding: 9px;
    overflow: auto;
    color: #374151;
    font: 12px/1.5 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    white-space: pre-wrap;
    background: #ffffff;
    border: 1px solid #e5e7eb;
    border-radius: 4px;
  }

  .tool-call-data + .tool-call-data,
  .tool-call-error {
    margin-top: 8px;
  }

  .tool-call-error {
    margin-bottom: 0;
    color: #b91c1c;
    font-size: 13px;
  }

  .streaming-placeholder {
    display: inline-block;
    width: 8px;
    height: 8px;
    background: #6b7280;
    border-radius: 999px;
    animation: pulse 1s ease-in-out infinite;
  }

  @keyframes pulse {
    50% {
      opacity: 0.25;
    }
  }

  .message-time {
    margin-top: 10px;
    margin-bottom: 0;
  }

  .composer {
    margin-top: 12px;
    padding-top: 12px;
    background: #f6f7fb;
    border-top: 1px solid #e5e7eb;
  }

  .composer-surface {
    position: relative;
    overflow: visible;
    background: #ffffff;
    border: 1px solid #dbe1ea;
    border-radius: 18px;
    box-shadow: 0 1px 5px rgb(15 23 42 / 5%);
  }

  .composer-surface textarea {
    display: block;
    min-height: 100px;
    padding: 14px 14px 8px;
    resize: vertical;
    border: 0;
    border-radius: 18px 18px 0 0;
    outline: 0;
  }

  .composer-toolbar {
    display: flex;
    min-height: 48px;
    gap: 12px;
    align-items: center;
    justify-content: space-between;
    padding: 6px 8px 8px;
  }

  .composer-toolbar::before {
    position: absolute;
    right: 12px;
    bottom: 48px;
    left: 12px;
    height: 1px;
    content: '';
    background: #f1f5f9;
  }

  .model-selector-button {
    min-width: 0;
    max-width: min(70vw, 420px);
    min-height: 30px;
    padding: 0 10px;
    overflow: hidden;
    color: #475569;
    font-size: 12px;
    text-align: left;
    text-overflow: ellipsis;
    white-space: nowrap;
    background: #f1f5f9;
    border: 0;
    border-radius: 15px;
    cursor: pointer;
  }

  .send-button {
    display: grid;
    width: 40px;
    min-width: 40px;
    min-height: 40px;
    height: 40px;
    padding: 0;
    place-items: center;
    color: transparent;
    border-radius: 50%;
    cursor: pointer;
  }

  .send-button::after {
    color: #ffffff;
    font-size: 20px;
    font-weight: 700;
    line-height: 1;
    content: '\\2191';
  }

  .send-button-is-stop::after {
    font-size: 15px;
    content: '\\25a0';
  }

  .model-picker-menu {
    position: absolute;
    z-index: 6;
    right: 8px;
    bottom: calc(100% + 8px);
    left: 0;
    display: grid;
    max-height: min(276px, 42dvh);
    overflow-y: auto;
    padding: 6px;
    background: #ffffff;
    border: 1px solid #dbe1ea;
    border-radius: 12px;
    box-shadow: 0 12px 32px rgb(15 23 42 / 14%);
  }

  .model-picker-option {
    display: grid;
    gap: 2px;
    width: 100%;
    padding: 9px 10px;
    text-align: left;
    color: #1f2937;
    background: transparent;
    border: 0;
    border-radius: 8px;
    cursor: pointer;
  }

  .model-picker-option:hover,
  .model-picker-option:focus-visible,
  .model-picker-option-selected {
    background: #eef2ff;
    outline: 0;
  }

  .model-picker-name {
    overflow: hidden;
    font-size: 13px;
    font-weight: 600;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .model-picker-provider {
    color: #64748b;
    font-size: 12px;
  }

  .slash-command-menu {
    position: absolute;
    z-index: 5;
    right: 8px;
    bottom: calc(100% + 8px);
    left: 0;
    display: grid;
    max-height: min(252px, 36dvh);
    overflow-y: auto;
    padding: 6px;
    background: #ffffff;
    border: 1px solid #dbe1ea;
    border-radius: 12px;
    box-shadow: 0 12px 32px rgb(15 23 42 / 14%);
  }

  .slash-command-option {
    display: grid;
    grid-template-columns: minmax(96px, auto) minmax(0, 1fr);
    gap: 10px;
    width: 100%;
    padding: 9px 10px;
    text-align: left;
    color: #1f2937;
    background: transparent;
    border: 0;
    border-radius: 8px;
    cursor: pointer;
  }

  .slash-command-option:hover,
  .slash-command-option:focus-visible {
    background: #eef2ff;
    outline: 0;
  }

  .slash-command-name {
    font: 600 13px/1.4 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  }

  .slash-command-description {
    overflow: hidden;
    color: #64748b;
    font-size: 13px;
    line-height: 1.4;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  textarea,
  input {
    width: 100%;
    padding: 12px;
    color: #111827;
    font-size: 16px;
    background: #ffffff;
    border: 1px solid #d1d5db;
    border-radius: 8px;
  }

  textarea {
    min-height: 76px;
    max-height: 180px;
    resize: vertical;
  }

  .composer-error {
    margin: 8px 0 0;
    color: #b42318;
    font-size: 13px;
  }

  .modal-backdrop {
    position: fixed;
    z-index: 20;
    display: grid;
    inset: 0;
    place-items: center;
    padding: 20px;
    background: rgb(17 24 39 / 48%);
  }

  .new-conversation-dialog {
    width: min(440px, 100%);
    padding: 20px;
    background: #ffffff;
    border: 1px solid #d1d5db;
    border-radius: 8px;
    box-shadow: 0 18px 48px rgb(17 24 39 / 18%);
  }

  .dialog-header,
  .dialog-actions {
    display: flex;
    gap: 12px;
    align-items: center;
    justify-content: space-between;
  }

  .dialog-header h2 {
    margin-bottom: 0;
  }

  .field-label {
    display: block;
    margin: 24px 0 8px;
    font-size: 13px;
    font-weight: 600;
  }

  select {
    width: 100%;
    min-height: 40px;
    padding: 0 10px;
    color: #111827;
    background: #ffffff;
    border: 1px solid #d1d5db;
    border-radius: 8px;
  }

  .dialog-actions {
    justify-content: flex-end;
    margin-top: 24px;
  }

  .status-row {
    margin: 0 0 16px;
    padding-bottom: 14px;
    border-bottom: 1px solid #f0f1f4;
  }

  .bridge-indicator {
    width: 10px;
    height: 10px;
    margin-bottom: 16px;
    background: #f59e0b;
    border-radius: 999px;
  }

  .bridge-indicator-connected {
    background: #16a34a;
  }

  .bridge-indicator-offline {
    background: #dc2626;
  }

  .status-row dt {
    margin-bottom: 4px;
    color: #6b7280;
    font-size: 12px;
  }

  .status-row dd {
    margin: 0;
    font-size: 14px;
  }

  @media (prefers-color-scheme: dark) {
    :root {
      color: #e5e7eb;
      background: #111827;
      color-scheme: dark;
    }

    .conversation-list,
    .status-panel,
    .message,
    .auth-panel,
    .new-conversation-dialog,
    textarea,
    input,
    select,
    .tool-call-data {
      color: #e5e7eb;
      background: #1f2937;
      border-color: #374151;
    }

    .chat-stage,
    .composer {
      background: #111827;
      border-color: #374151;
    }

    .composer-surface {
      background: #1f2937;
      border-color: #475569;
      box-shadow: 0 1px 5px rgb(0 0 0 / 14%);
    }

    .composer-surface textarea {
      background: #1f2937;
    }

    .composer-toolbar::before {
      background: #334155;
    }

    .conversation-item,
    .tool-call,
    .reasoning-block,
    .markdown-content th {
      color: #e5e7eb;
      background: #273449;
      border-color: #475569;
    }

    .conversation-item:hover,
    .conversation-item-selected {
      background: #263b5b;
      border-color: #60a5fa;
    }

    .conversation-title,
    .tool-call,
    .tool-call-data {
      color: #e5e7eb;
    }

    .markdown-content th,
    .markdown-content td,
    .markdown-content table {
      border-color: #475569;
    }

    .markdown-content code:not(pre code) {
      color: #fecdd3;
      background: #4c1d2b;
    }

    .markdown-content a {
      color: #93c5fd;
    }

    .secondary-button,
    .icon-button,
    .slash-command-menu,
    .model-picker-menu {
      color: #e5e7eb;
      background: #273449;
      border-color: #475569;
    }

    .slash-command-option {
      color: #e5e7eb;
    }

    .model-picker-option {
      color: #e5e7eb;
    }

    .slash-command-option:hover,
    .slash-command-option:focus-visible {
      background: #334155;
    }

    .model-picker-option:hover,
    .model-picker-option:focus-visible,
    .model-picker-option-selected {
      background: #334155;
    }

    .slash-command-description {
      color: #94a3b8;
    }

    .model-picker-provider,
    .model-selector-button {
      color: #cbd5e1;
    }

    .model-selector-button {
      background: #334155;
    }

    .mobile-sidebar-button {
      color: #e5e7eb;
      background: #273449;
      border-color: #475569;
    }

    .context-orb {
      color: #cbd5e1;
      background: radial-gradient(circle at center, #111827 62%, transparent 64%),
        conic-gradient(var(--context-color) var(--context-usage), #475569 0);
    }

    .context-orb-empty {
      background: radial-gradient(circle at center, #111827 62%, transparent 64%), #475569;
    }
  }

  @media (max-width: 900px) {
    .webui-shell {
      grid-template-columns: 1fr;
      grid-template-rows: minmax(0, 1fr);
      height: 100dvh;
    }

    .mobile-sidebar-backdrop {
      position: fixed;
      z-index: 29;
      inset: 0;
      padding: 0;
      background: rgb(15 23 42 / 52%);
      border: 0;
    }

    .conversation-list {
      position: fixed;
      z-index: 30;
      top: 0;
      bottom: 0;
      left: 0;
      display: grid;
      grid-template-rows: auto auto auto minmax(0, 1fr);
      width: min(320px, calc(100vw - 44px));
      min-height: 0;
      padding: 14px;
      border: 0;
      border-right: 1px solid #e5e7eb;
      box-shadow: 16px 0 36px rgb(15 23 42 / 20%);
      transform: translateX(-105%);
      transition: transform 160ms ease-out;
    }

    .conversation-list-open {
      transform: translateX(0);
    }

    .panel-header {
      margin-bottom: 12px;
    }

    .brand-logo {
      width: 36px;
      height: 36px;
    }

    .mobile-close-button {
      display: grid;
      width: 36px;
      height: 36px;
      margin-left: auto;
      padding: 0;
      place-items: center;
      color: #6b7280;
      font-size: 24px;
      background: transparent;
      border: 0;
    }

    .new-chat-button {
      min-height: 40px;
    }

    .empty-copy {
      margin: 10px 0 0;
      font-size: 13px;
    }

    .conversation-nav {
      min-height: 0;
      margin-top: 10px;
      overflow-y: auto;
    }

    .conversation-item {
      min-height: 52px;
    }

    .chat-stage {
      height: auto;
      min-height: 0;
      padding: 10px 12px 12px;
    }

    .chat-header {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      padding-bottom: 12px;
    }

    .mobile-chat-actions {
      display: flex;
      gap: 10px;
      align-items: center;
      padding-top: 2px;
    }

    .mobile-sidebar-button {
      display: grid;
      width: 36px;
      height: 36px;
      padding: 0;
      place-items: center;
      color: #374151;
      font-size: 20px;
      background: #ffffff;
      border: 1px solid #d1d5db;
      border-radius: 6px;
    }

    .mobile-bridge-indicator {
      width: 10px;
      height: 10px;
      background: #dc2626;
      border-radius: 999px;
    }

    .mobile-bridge-indicator-connected {
      background: #16a34a;
    }

    .mobile-bridge-indicator-offline {
      background: #dc2626;
    }

    @media (prefers-color-scheme: dark) {
      .conversation-list {
        border-color: #475569;
      }

      .mobile-sidebar-button {
        color: #e5e7eb;
        background: #273449;
        border-color: #475569;
      }
    }

    .message-stack {
      gap: 12px;
      padding: 12px 0 10px;
    }

    .message {
      max-width: 94%;
      padding: 12px 14px;
    }

    .composer {
      gap: 10px;
      margin: 8px 0 max(8px, env(safe-area-inset-bottom));
      padding: 8px;
      background: #ffffff;
      border: 1px solid #dbe1ea;
      border-radius: 22px;
      box-shadow: 0 8px 28px rgb(15 23 42 / 10%);
    }

    .status-panel {
      display: none;
    }
  }

  @media (max-width: 640px) {
    .conversation-list {
      padding: 12px;
    }

    .panel-header {
      gap: 10px;
    }

    h1 {
      font-size: 19px;
    }

    .chat-stage {
      padding: 12px;
    }

    .message {
      max-width: 100%;
    }

    .message-header {
      gap: 8px;
    }

    .slash-command-menu {
      right: 0;
      bottom: calc(100% + 10px);
      max-height: min(230px, 32dvh);
    }

    .model-picker-menu {
      right: 0;
      bottom: calc(100% + 10px);
      max-height: min(256px, 36dvh);
    }

    .slash-command-option {
      grid-template-columns: 1fr;
      gap: 2px;
    }

    .composer-surface textarea {
      min-height: 76px;
      max-height: 148px;
      padding: 10px 12px 8px;
    }

    .composer-toolbar {
      min-height: 52px;
      padding: 6px 6px 8px;
    }

    .composer-row .send-button {
      display: grid;
      width: 44px;
      min-height: 44px;
      height: 44px;
      padding: 0;
      place-items: center;
      color: transparent;
      background: #111827;
      border-radius: 50%;
    }

    .composer-row .send-button::after {
      content: '↑';
      color: #ffffff;
      font-size: 25px;
      line-height: 1;
    }

    .send-button {
      min-height: 0;
    }

    textarea {
      min-height: 76px;
      max-height: 148px;
    }

    .markdown-content th,
    .markdown-content td {
      min-width: 76px;
      padding: 7px 8px;
      font-size: 13px;
    }

    @media (prefers-color-scheme: dark) {
      .composer {
        background: #1f2937;
        border-color: #475569;
      }

      .composer-row textarea {
        background: #1f2937;
      }
    }
  }
`
document.head.appendChild(style)

createApp(App).use(createPinia()).mount('#app')
