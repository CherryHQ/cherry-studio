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
  WebUiModelGroup,
  WebUiModelsResponse,
  WebUiConversationSummary,
  WebUiChunkPayload,
  WebUiCursorResponse,
  WebUiHealthResponse,
  WebUiMessageSnapshot,
  WebUiSendAttachment,
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

type WebUiDraftAttachment = {
  readonly id: string
  readonly file: File
}

const fallbackLanguage = 'en-US'
const webUiLogoPath = './icon.png'
const webUiVersion = '0.1.0'
const projectRepositoryUrl = 'https://github.com/EasongChung/cherry-studio'
const messagePageSize = 50
const maxAttachmentCount = 5
const maxAttachmentBytes = 10 * 1024 * 1024
const maxAttachmentsBytes = 25 * 1024 * 1024
const webUiLanguages = [
  { id: 'en-US', label: 'English' },
  { id: 'zh-CN', label: '中文' },
  { id: 'zh-TW', label: '繁體中文' }
] as const

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
    appVersion: 'Cherry Studio',
    authDescription: 'Enter the WebUI access key configured in Cherry Studio.',
    authKey: 'Access key',
    authTitle: 'WebUI verification',
    bridgeStatus: 'Bridge status',
    changeLanguage: 'Change language',
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
    githubProject: 'Open project repository',
    invalidKey: 'Invalid access key',
    loadingConversations: 'Loading conversations',
    loadingMessages: 'Loading desktop messages',
    loadingOlder: 'Loading earlier messages...',
    loadOlder: 'Load earlier messages',
    model: 'Model',
    newConversation: 'New conversation',
    conversationHistory: 'Conversation history',
    noAgents: 'No configured desktop Agents are available.',
    noContext: 'No context usage available',
    noSessions: 'No desktop sessions yet',
    reasoning: 'Reasoning',
    processDetails: 'Processing details',
    toolCalls: 'Tool calls',
    processingTime: 'Processed in',
    requestAborted: 'Generation was interrupted',
    runtime: 'Runtime',
    selectConversation: 'Select a conversation',
    selectFirst: 'Select a desktop conversation first',
    send: 'Send',
    sendPlaceholder: 'Type a message. Ctrl+Enter to send. Type / to search skills or commands.',
    serviceStarted: 'Started',
    sessionsChanged: 'The selected desktop conversation is no longer available.',
    sseClients: 'SSE clients',
    stop: 'Stop',
    stopped: 'Stopped',
    switchToDark: 'Switch to dark theme',
    switchToLight: 'Switch to light theme',
    attachmentPending: 'Add file',
    attachmentLimit: 'Up to 5 files, 10 MB each and 25 MB total.',
    attachmentReadFailed: 'Unable to read the selected file.',
    removeAttachment: 'Remove attachment',
    backToBottom: 'Back to bottom',
    resizeComposer: 'Resize message input',
    newConversationTool: 'New conversation',
    thinkingPending: 'Reasoning length',
    thinkingUnavailable: 'The current desktop Agent runtime does not expose reasoning length control.',
    reasoningDefault: 'Default',
    reasoningNone: 'Off',
    reasoningMinimal: 'Minimal',
    reasoningLow: 'Low',
    reasoningMedium: 'Medium',
    reasoningHigh: 'High',
    reasoningXhigh: 'Extra high',
    reasoningAuto: 'Auto',
    unavailable: 'Unavailable',
    verify: 'Verify',
    webui: 'WebUI',
    webUiVersion: 'WebUI'
  },
  'zh-CN': {
    agent: '智能体',
    appVersion: 'Cherry Studio',
    authDescription: '请输入 Cherry Studio 设置中配置的 WebUI 访问 KEY。',
    authKey: '访问 KEY',
    authTitle: 'WebUI 安全验证',
    bridgeStatus: '连接状态',
    changeLanguage: '切换语言',
    cancel: '取消',
    checkingBridge: '正在检查桌面桥接服务',
    close: '关闭',
    connected: 'Win11 桌面桥接已连接',
    context: '上下文',
    copy: '复制',
    create: '新建',
    creating: '创建中...',
    desktopSession: '桌面会话',
    disconnected: '桌面桥接不可用',
    emptyConversation: '此桌面会话暂无消息。',
    generating: '生成中',
    githubProject: '打开项目仓库',
    invalidKey: '访问 KEY 无效',
    loadingConversations: '正在加载会话',
    loadingMessages: '正在加载桌面消息',
    loadingOlder: '正在加载更早消息...',
    loadOlder: '加载更早消息',
    model: '模型',
    newConversation: '新建会话',
    conversationHistory: '会话记录',
    noAgents: '暂无可用的桌面智能体。',
    noContext: '暂无上下文用量',
    noSessions: '暂无桌面会话',
    reasoning: '思考过程',
    processDetails: '处理过程',
    toolCalls: '工具调用',
    processingTime: '处理用时',
    requestAborted: '生成已中断',
    runtime: '运行状态',
    selectConversation: '选择一个会话',
    selectFirst: '请先选择桌面会话',
    send: '发送',
    sendPlaceholder: '输入消息，按Ctrl+Enter发送，输入/搜索技能或命令。',
    serviceStarted: '启动时间',
    sessionsChanged: '选中的桌面会话已不可用。',
    sseClients: 'SSE 客户端',
    stop: '停止',
    stopped: '已停止',
    switchToDark: '切换至深色主题',
    switchToLight: '切换至浅色主题',
    attachmentPending: '添加文件',
    attachmentLimit: '最多 5 个文件，单个 10 MB，总计 25 MB。',
    attachmentReadFailed: '无法读取所选文件。',
    removeAttachment: '移除附件',
    backToBottom: '回到底部',
    resizeComposer: '调整输入框高度',
    newConversationTool: '新建会话',
    thinkingPending: '思维链长度',
    thinkingUnavailable: '当前桌面 Agent 运行链路尚未开放思维链长度控制。',
    reasoningDefault: '默认',
    reasoningNone: '关闭',
    reasoningMinimal: '最短',
    reasoningLow: '低',
    reasoningMedium: '中',
    reasoningHigh: '高',
    reasoningXhigh: '极高',
    reasoningAuto: '自动',
    unavailable: '不可用',
    verify: '验证',
    webui: 'WebUI',
    webUiVersion: 'WebUI'
  },
  'zh-TW': {
    agent: '智慧體',
    appVersion: 'Cherry Studio',
    authDescription: '請輸入 Cherry Studio 設定中配置的 WebUI 存取 KEY。',
    authKey: '存取 KEY',
    authTitle: 'WebUI 安全驗證',
    bridgeStatus: '連線狀態',
    changeLanguage: '切換語言',
    cancel: '取消',
    checkingBridge: '正在檢查桌面橋接服務',
    close: '關閉',
    connected: 'Win11 桌面橋接已連線',
    context: '上下文',
    copy: '複製',
    create: '新增',
    creating: '建立中...',
    desktopSession: '桌面會話',
    disconnected: '桌面橋接不可用',
    emptyConversation: '此桌面會話尚無訊息。',
    generating: '生成中',
    githubProject: '開啟專案倉庫',
    invalidKey: '存取 KEY 無效',
    loadingConversations: '正在載入會話',
    loadingMessages: '正在載入桌面訊息',
    loadingOlder: '正在載入更早訊息...',
    loadOlder: '載入更早訊息',
    model: '模型',
    newConversation: '新增會話',
    conversationHistory: '會話記錄',
    noAgents: '尚無可用的桌面智慧體。',
    noContext: '暫無上下文用量',
    noSessions: '尚無桌面會話',
    reasoning: '思考過程',
    processDetails: '處理過程',
    toolCalls: '工具調用',
    processingTime: '處理用時',
    requestAborted: '生成已中斷',
    runtime: '執行狀態',
    selectConversation: '選擇一個會話',
    selectFirst: '請先選擇桌面會話',
    send: '傳送',
    sendPlaceholder: '輸入訊息，按Ctrl+Enter傳送，輸入/搜尋技能或命令。',
    serviceStarted: '啟動時間',
    sessionsChanged: '選取的桌面會話已不可用。',
    sseClients: 'SSE 用戶端',
    stop: '停止',
    stopped: '已停止',
    switchToDark: '切換至深色主題',
    switchToLight: '切換至淺色主題',
    attachmentPending: '加入檔案',
    attachmentLimit: '最多 5 個檔案，單個 10 MB，總計 25 MB。',
    attachmentReadFailed: '無法讀取所選檔案。',
    removeAttachment: '移除附件',
    backToBottom: '回到底部',
    resizeComposer: '調整輸入框高度',
    newConversationTool: '新增會話',
    thinkingPending: '思維鏈長度',
    thinkingUnavailable: '目前桌面 Agent 執行鏈路尚未開放思維鏈長度控制。',
    reasoningDefault: '預設',
    reasoningNone: '關閉',
    reasoningMinimal: '最短',
    reasoningLow: '低',
    reasoningMedium: '中',
    reasoningHigh: '高',
    reasoningXhigh: '極高',
    reasoningAuto: '自動',
    unavailable: '不可用',
    verify: '驗證',
    webui: 'WebUI',
    webUiVersion: 'WebUI'
  }
} as const

type TextKey = keyof (typeof textPacks)[typeof fallbackLanguage]

const toErrorMessage = (error: unknown) => {
  return error instanceof Error ? error.message : 'Unable to reach the desktop bridge'
}

const isAbortError = (error: unknown) => {
  const message = error instanceof Error ? error.message : typeof error === 'string' ? error : ''
  return (
    (error instanceof DOMException && error.name === 'AbortError') ||
    (error instanceof Error && error.name === 'AbortError') ||
    /signal\s+is\s+aborted|abort(?:ed)?/i.test(message)
  )
}

const toConversationSummary = (session: WebUiAgentSessionEntity): WebUiConversationSummary => ({
  id: session.id,
  agentId: session.agentId,
  title: session.name || 'Untitled session',
  updatedAt: session.updatedAt,
  workspaceLabel: session.workspace?.name ?? session.workspace?.path
})

const terminalToolStates: ReadonlySet<WebUiToolCallState> = new Set(['output-available', 'output-error', 'output-denied'])

type ComposerToolIconName = 'attachment' | 'newConversation' | 'thinking'

// Mirrors the compact line-icon treatment used by the desktop ComposerSurface.
const renderComposerToolIcon = (name: ComposerToolIconName) => {
  const baseProps = {
    width: 18,
    height: 18,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    'stroke-width': 2,
    'stroke-linecap': 'round',
    'stroke-linejoin': 'round',
    'aria-hidden': 'true'
  }

  if (name === 'newConversation') {
    return h('svg', baseProps, [
      h('path', { d: 'M13 4H6a2 2 0 0 0-2 2v13l4-3h10a2 2 0 0 0 2-2v-3' }),
      h('path', { d: 'M18 3.5v5' }),
      h('path', { d: 'M15.5 6h5' })
    ])
  }

  if (name === 'attachment') {
    return h('svg', baseProps, h('path', { d: 'm21.4 11.6-8.9 8.9a6 6 0 0 1-8.5-8.5l9.2-9.2a4 4 0 0 1 5.7 5.7l-9.2 9.2a2 2 0 0 1-2.8-2.8l8.5-8.5' }))
  }

  if (name === 'thinking') {
    return h('svg', baseProps, [
      h('path', { d: 'M9 18h6' }),
      h('path', { d: 'M10 22h4' }),
      h('path', { d: 'M8.5 14.5A6.5 6.5 0 1 1 15.5 14c-1.1.8-1.5 1.6-1.5 2.5h-4c0-.9-.4-1.5-1.5-2' })
    ])
  }

  return h('svg', baseProps, [
    h('path', { d: 'M9 18h6' }),
    h('path', { d: 'M10 22h4' }),
    h('path', { d: 'M8.5 14.5A6.5 6.5 0 1 1 15.5 14c-1.1.8-1.5 1.6-1.5 2.5h-4c0-.9-.4-1.5-1.5-2' })
  ])
}

const renderLanguageIcon = () =>
  h(
    'svg',
    {
      width: 18,
      height: 18,
      viewBox: '0 0 24 24',
      fill: 'none',
      stroke: 'currentColor',
      'stroke-width': 2,
      'stroke-linecap': 'round',
      'stroke-linejoin': 'round',
      'aria-hidden': 'true'
    },
    [
      h('circle', { cx: 12, cy: 12, r: 10 }),
      h('path', { d: 'M2 12h20' }),
      h('path', { d: 'M12 2a15.3 15.3 0 0 1 0 20' }),
      h('path', { d: 'M12 2a15.3 15.3 0 0 0 0 20' })
    ]
  )

const renderGithubIcon = () =>
  h(
    'svg',
    {
      width: 18,
      height: 18,
      viewBox: '0 0 24 24',
      fill: 'currentColor',
      'aria-hidden': 'true'
    },
    h('path', {
      d: 'M12 2C6.48 2 2 6.58 2 12.23c0 4.52 2.87 8.35 6.84 9.71.5.1.68-.22.68-.49 0-.24-.01-1.04-.01-1.88-2.78.62-3.37-1.21-3.37-1.21-.45-1.19-1.11-1.5-1.11-1.5-.91-.64.07-.63.07-.63 1 .08 1.53 1.06 1.53 1.06.9 1.57 2.35 1.12 2.92.86.09-.67.35-1.12.64-1.38-2.22-.26-4.56-1.15-4.56-5.12 0-1.13.39-2.05 1.03-2.78-.1-.26-.45-1.32.1-2.75 0 0 .84-.28 2.75 1.06A9.3 9.3 0 0 1 12 6.86c.85 0 1.7.12 2.5.35 1.91-1.34 2.75-1.06 2.75-1.06.55 1.43.2 2.49.1 2.75.64.73 1.03 1.65 1.03 2.78 0 3.98-2.34 4.86-4.57 5.11.36.32.68.93.68 1.88 0 1.36-.01 2.45-.01 2.78 0 .27.18.59.69.49A10.23 10.23 0 0 0 22 12.23C22 6.58 17.52 2 12 2Z'
    })
  )

type ActionIconName = 'send' | 'stop' | 'menu' | 'down' | 'resize'

const renderActionIcon = (name: ActionIconName) => {
  const props = {
    width: 18,
    height: 18,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    'stroke-width': 2,
    'stroke-linecap': 'round',
    'stroke-linejoin': 'round',
    'aria-hidden': 'true'
  }

  if (name === 'send') return h('svg', props, [h('path', { d: 'm5 12 7-7 7 7' }), h('path', { d: 'M12 19V5' })])
  if (name === 'stop') return h('svg', { ...props, fill: 'currentColor', stroke: 'none' }, h('rect', { x: 6, y: 6, width: 12, height: 12, rx: 1.5 }))
  if (name === 'menu') return h('svg', props, [h('path', { d: 'M4 7h16' }), h('path', { d: 'M4 12h16' }), h('path', { d: 'M4 17h16' })])
  if (name === 'down') return h('svg', props, [h('path', { d: 'm6 9 6 6 6-6' })])
  return h('svg', props, [
    h('path', { d: 'M5 19A14 14 0 0 0 19 5' }),
    h('path', { d: 'M9 19A10 10 0 0 0 19 9' }),
    h('path', { d: 'M13 19A6 6 0 0 0 19 13' })
  ])
}

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
  const attachments = parts
    .filter((part) => part.type === 'file')
    .map((part) => ({ name: part.filename || 'Attachment', ...(part.mediaType ? { mediaType: part.mediaType } : {}) }))
  const processingTimeMs =
    message.stats?.timeCompletionMs ??
    message.stats?.timeThinkingMs ??
    parts.find((part) => part.type === 'reasoning')?.providerMetadata?.cherry?.thinkingMs

  return {
    id: message.id,
    conversationId: message.sessionId,
    role: message.role,
    content: content || message.searchableText || '',
    ...(reasoning ? { reasoning } : {}),
    ...(toolCalls.length ? { toolCalls } : {}),
    ...(attachments.length ? { attachments } : {}),
    status: message.status,
    ...(processingTimeMs ? { processingTimeMs } : {}),
    createdAt: message.createdAt
  }
}

const readFileAsDataUrl = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.addEventListener('load', () => (typeof reader.result === 'string' ? resolve(reader.result) : reject(new Error('Invalid file data'))))
    reader.addEventListener('error', () => reject(reader.error ?? new Error('Unable to read file')))
    reader.readAsDataURL(file)
  })

const formatDuration = (milliseconds: number) => {
  const seconds = Math.max(0.1, milliseconds / 1000)
  return seconds < 10 ? `${seconds.toFixed(1)}s` : `${Math.round(seconds)}s`
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
    const languageOverride = ref(false)
    const languagePickerOpen = ref(false)
    const authRequired = ref(false)
    const isAuthenticated = ref(true)
    const authKeyDraft = ref('')
    const authError = ref('')
    const userName = ref('')
    const bridgeDetail = ref('')
    const appVersion = ref('')
    const serviceStartedAt = ref('Pending')
    const sseClientCount = ref('0')
    const conversationLoadState = ref<'idle' | 'loading' | 'ready' | 'error'>('idle')
    const conversationLoadMessage = ref('Loading conversations')
    const messageLoadState = ref<'idle' | 'loading' | 'ready' | 'error'>('idle')
    const messageLoadMessage = ref('')
    const composerText = ref('')
    const submitError = ref('')
    const agents = ref<readonly WebUiAgentEntity[]>([])
    const modelGroups = ref<readonly WebUiModelGroup[]>([])
    const newConversationOpen = ref(false)
    const newConversationState = ref<'idle' | 'loading' | 'creating' | 'error'>('idle')
    const newConversationError = ref('')
    const selectedAgentId = ref('')
    const contextUsage = ref<WebUiContextUsage | null>(null)
    const slashCommands = ref<readonly WebUiSlashCommand[]>([])
    const modelPickerOpen = ref(false)
    const reasoningPickerOpen = ref(false)
    const reasoningEffort = ref('default')
    const modelUpdateState = ref<'idle' | 'updating' | 'error'>('idle')
    const mobileSidebarOpen = ref(false)
    const themeMode = ref<'light' | 'dark'>(
      window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
    )
    const messageStack = ref<HTMLElement>()
    const composerTextarea = ref<HTMLTextAreaElement>()
    const attachmentInput = ref<HTMLInputElement>()
    const attachments = ref<readonly WebUiDraftAttachment[]>([])
    const olderMessagesCursor = ref<string>()
    const olderMessagesLoading = ref(false)
    const showScrollToBottom = ref(false)
    const composerHeight = ref(92)
    const pendingChunks = new Map<string, WebUiChunkPayload[]>()
    const pendingChunkRetries = new Map<string, number>()
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
    const models = computed(() => modelGroups.value.flatMap((group) => group.models))
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
    const themeToggleLabel = computed(() => (themeMode.value === 'dark' ? text('switchToLight') : text('switchToDark')))
    const reasoningOptions = computed(() => selectedModel.value?.reasoningOptions ?? [])
    const reasoningConfigurable = computed(() => reasoningOptions.value.length > 0)
    const reasoningLabel = computed(() => {
      const labels: Record<string, TextKey> = {
        default: 'reasoningDefault',
        none: 'reasoningNone',
        minimal: 'reasoningMinimal',
        low: 'reasoningLow',
        medium: 'reasoningMedium',
        high: 'reasoningHigh',
        xhigh: 'reasoningXhigh',
        auto: 'reasoningAuto'
      }
      return text(labels[reasoningEffort.value] ?? 'reasoningDefault')
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
    const conversationAgentName = (agentId: string | null) =>
      agents.value.find((agent) => agent.id === agentId)?.name ?? text('agent')

    const text = (key: TextKey) => {
      const pack = textPacks[language.value as keyof typeof textPacks] ?? textPacks[fallbackLanguage]
      return pack[key] ?? textPacks[fallbackLanguage][key]
    }

    const localizedErrorMessage = (error: unknown) => (isAbortError(error) ? text('requestAborted') : toErrorMessage(error))
    const localizedSseErrorMessage = (message?: string) =>
      message && isAbortError(message) ? text('requestAborted') : message || text('disconnected')
    const isAbortSseMessage = (message?: string) => Boolean(message && isAbortError(message))

    const hasProcessDetails = (message: WebUiMessageSnapshot) =>
      Boolean(message.reasoning || message.toolCalls?.length)
    const getProcessSummary = (message: WebUiMessageSnapshot) => {
      if (message.status !== 'pending' && message.processingTimeMs) {
        return `${text('processingTime')} ${formatDuration(message.processingTimeMs)}`
      }
      if (message.toolCalls?.length) return `${text('processDetails')} · ${message.toolCalls.length} ${text('toolCalls')}`
      return text('reasoning')
    }
    const renderToolCall = (tool: WebUiToolCallSnapshot, message: WebUiMessageSnapshot) =>
      h('details', { class: ['tool-call', `tool-call-${tool.state}`], open: message.status === 'pending' && !terminalToolStates.has(tool.state) }, [
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
    const renderProcessDetails = (message: WebUiMessageSnapshot) =>
      hasProcessDetails(message)
        ? h('details', { class: ['process-block', { 'process-block-pending': message.status === 'pending' }] }, [
            h('summary', [
              h('span', { class: 'process-state-indicator', 'aria-hidden': 'true' }),
              h('span', { class: 'process-summary' }, getProcessSummary(message))
            ]),
            message.reasoning
              ? h('section', { class: 'process-section' }, [
                  h('p', { class: 'process-section-title' }, text('reasoning')),
                  h('div', { class: 'markdown-content', innerHTML: renderMarkdown(message.reasoning) })
                ])
              : undefined,
            message.toolCalls?.length
              ? h('section', { class: 'process-section' }, [
                  h('p', { class: 'process-section-title' }, `${text('toolCalls')} (${message.toolCalls.length})`),
                  ...message.toolCalls.map((tool) => renderToolCall(tool, message))
                ])
              : undefined
          ])
        : undefined

    const selectLanguage = (nextLanguage: (typeof webUiLanguages)[number]['id']) => {
      language.value = nextLanguage
      languageOverride.value = true
      languagePickerOpen.value = false
      bridgeDetail.value = bridgeState.value === 'connected' ? text('connected') : text('disconnected')
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
    const versionItems = computed<readonly WebuiStatus[]>(() => [
      {
        label: text('appVersion'),
        value: appVersion.value || text('unavailable')
      },
      {
        label: text('webUiVersion'),
        value: webUiVersion
      }
    ])

    const refreshHealth = async () => {
      try {
        const health = await httpClient.getJson<WebUiHealthResponse>('/api/health')
        if (!languageOverride.value) language.value = normalizeLanguage(health.language)
        bridgeState.value = health.ok ? 'connected' : 'offline'
        bridgeDetail.value = health.ok ? text('connected') : text('disconnected')
        appVersion.value = health.appVersion ?? ''
        serviceStartedAt.value = new Date(health.startedAt).toLocaleString()
        sseClientCount.value = String(health.sseClients)
      } catch (error) {
        bridgeState.value = 'offline'
        bridgeDetail.value = localizedErrorMessage(error)
        appVersion.value = ''
        serviceStartedAt.value = text('unavailable')
        sseClientCount.value = '0'
      }
    }

    const loadConversations = async () => {
      conversationLoadState.value = 'loading'
      conversationLoadMessage.value = ''

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
        conversations.value = sessions
          .map(toConversationSummary)
          .sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt))
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
        conversationLoadMessage.value = localizedErrorMessage(error)
      }
    }

    const mergeMessages = (
      current: readonly WebUiMessageSnapshot[],
      incoming: readonly WebUiMessageSnapshot[]
    ): readonly WebUiMessageSnapshot[] => {
      const byId = new Map(current.map((message) => [message.id, message]))
      for (const message of incoming) byId.set(message.id, message)
      return [...byId.values()].sort((left, right) => Date.parse(left.createdAt) - Date.parse(right.createdAt))
    }

    const loadConversationMessages = async (conversationId: string, mode: 'replace' | 'refresh' = 'replace') => {
      const requestId = ++latestMessageRequest
      if (mode === 'replace') {
        messageLoadState.value = 'loading'
        messageLoadMessage.value = ''
      }

      try {
        const query = new URLSearchParams({ limit: String(messagePageSize) })
        const page = await httpClient.getJson<WebUiCursorResponse<WebUiAgentSessionMessageEntity>>(
          `/api/data/agent-sessions/${encodeURIComponent(conversationId)}/messages?${query.toString()}`
        )
        if (requestId !== latestMessageRequest || selectedConversationId.value !== conversationId) return

        const latest = page.items.map(toMessageSnapshot).reverse()
        messages.value = mode === 'replace' ? latest : mergeMessages(messages.value, latest)
        if (mode === 'replace') olderMessagesCursor.value = page.nextCursor
        messageLoadState.value = 'ready'
        messageLoadMessage.value = messages.value.length ? '' : text('emptyConversation')
        refreshComposerInfo(conversationId)
        if (mode === 'replace') scrollMessagesToEnd()
      } catch (error) {
        if (requestId !== latestMessageRequest || selectedConversationId.value !== conversationId) return

        messageLoadState.value = 'error'
        messageLoadMessage.value = localizedErrorMessage(error)
      }
    }

    const loadOlderMessages = async () => {
      const conversationId = selectedConversationId.value
      const cursor = olderMessagesCursor.value
      const stack = messageStack.value
      if (!conversationId || !cursor || olderMessagesLoading.value) return

      olderMessagesLoading.value = true
      const previousScrollHeight = stack?.scrollHeight ?? 0
      try {
        const query = new URLSearchParams({ limit: String(messagePageSize), cursor })
        const page = await httpClient.getJson<WebUiCursorResponse<WebUiAgentSessionMessageEntity>>(
          `/api/data/agent-sessions/${encodeURIComponent(conversationId)}/messages?${query.toString()}`
        )
        if (selectedConversationId.value !== conversationId) return
        messages.value = mergeMessages(page.items.map(toMessageSnapshot).reverse(), messages.value)
        olderMessagesCursor.value = page.nextCursor
        await nextTick()
        if (stack) stack.scrollTop += stack.scrollHeight - previousScrollHeight
      } catch (error) {
        submitError.value = localizedErrorMessage(error)
      } finally {
        olderMessagesLoading.value = false
      }
    }

    const loadAgents = async () => {
      const page = await httpClient.getJson<WebUiOffsetResponse<WebUiAgentEntity>>('/api/data/agents')
      agents.value = page.items.filter((agent) => Boolean(agent.model))
    }

    const loadModels = async () => {
      const response = await httpClient.getJson<WebUiModelsResponse>('/api/webui/models')
      modelGroups.value = response.groups
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
        submitError.value = localizedErrorMessage(error)
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
      if (conversationId === selectedConversationId.value) {
        mobileSidebarOpen.value = false
        void loadConversationMessages(conversationId, 'refresh')
        refreshComposerInfo(conversationId)
        refreshSlashCommands(conversationId)
        return
      }

      selectedConversationId.value = conversationId
      mobileSidebarOpen.value = false
      messages.value = []
      contextUsage.value = null
      slashCommands.value = []
      olderMessagesCursor.value = undefined
      attachments.value = []
      reasoningEffort.value = 'default'
      modelPickerOpen.value = false
      reasoningPickerOpen.value = false
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
        newConversationError.value = localizedErrorMessage(error)
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
        newConversationError.value = localizedErrorMessage(error)
      }
    }

    const refreshFromDesktopSync = (reason?: string, conversationId?: string) => {
      if (syncTimer) window.clearTimeout(syncTimer)
      syncTimer = window.setTimeout(() => {
        syncTimer = undefined
        void loadConversations()
        const selectedId = selectedConversationId.value
        if (selectedId && (!conversationId || conversationId === selectedId)) {
          if (reason === 'stream-terminal' || reason === 'message-submitted') {
            void loadConversationMessages(selectedId, 'refresh')
          }
          refreshComposerInfo(selectedId)
        }
      }, 180)
    }

    const applyStreamChunk = (payload: WebUiChunkPayload): boolean => {
      if (payload.conversationId !== selectedConversationId.value) return true

      const messageIndex = messages.value.findIndex((message) => message.id === payload.messageId)
      if (messageIndex < 0) return false

      const nextMessages = [...messages.value]
      const message = nextMessages[messageIndex]
      if (!message) return false
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
        return true
      }
      messages.value = nextMessages
      return true
    }

    const queueStreamChunk = (payload: WebUiChunkPayload) => {
      const chunks = pendingChunks.get(payload.messageId) ?? []
      chunks.push(payload)
      pendingChunks.set(payload.messageId, chunks)
      if (chunkFrame !== undefined) return

      chunkFrame = window.requestAnimationFrame(() => {
        chunkFrame = undefined
        const shouldFollow = !showScrollToBottom.value
        const retryChunks: WebUiChunkPayload[] = []
        for (const queued of pendingChunks.values()) {
          for (const chunk of queued) {
            if (applyStreamChunk(chunk)) {
              pendingChunkRetries.delete(chunk.messageId)
              continue
            }
            const retries = pendingChunkRetries.get(chunk.messageId) ?? 0
            if (retries < 2) {
              pendingChunkRetries.set(chunk.messageId, retries + 1)
              retryChunks.push(chunk)
            }
          }
        }
        pendingChunks.clear()
        if (shouldFollow) scrollMessagesToEnd()
        if (retryChunks.length > 0 && selectedConversationId.value) {
          const conversationId = selectedConversationId.value
          void loadConversationMessages(conversationId, 'refresh').finally(() => {
            for (const chunk of retryChunks) queueStreamChunk(chunk)
          })
        }
      })
    }

    const scrollMessagesToEnd = (behavior: ScrollBehavior = 'auto') => {
      void nextTick(() => {
        const stack = messageStack.value
        if (stack) stack.scrollTo({ top: stack.scrollHeight, behavior })
        showScrollToBottom.value = false
      })
    }

    const updateMessageScrollState = () => {
      const stack = messageStack.value
      if (!stack) return
      showScrollToBottom.value = stack.scrollHeight - stack.scrollTop - stack.clientHeight > 96
    }

    const beginComposerResize = (event: PointerEvent) => {
      event.preventDefault()
      const startY = event.clientY
      const startHeight = composerHeight.value
      const onMove = (moveEvent: PointerEvent) => {
        composerHeight.value = Math.max(76, Math.min(220, startHeight + startY - moveEvent.clientY))
      }
      const onEnd = () => {
        window.removeEventListener('pointermove', onMove)
        window.removeEventListener('pointerup', onEnd)
      }
      window.addEventListener('pointermove', onMove)
      window.addEventListener('pointerup', onEnd, { once: true })
    }

    const addAttachments = (selectedFiles: FileList | null) => {
      if (!selectedFiles?.length) return
      const next = [...attachments.value]
      let totalBytes = next.reduce((sum, attachment) => sum + attachment.file.size, 0)
      for (const file of Array.from(selectedFiles)) {
        if (next.length >= maxAttachmentCount || file.size > maxAttachmentBytes || totalBytes + file.size > maxAttachmentsBytes) {
          submitError.value = text('attachmentLimit')
          break
        }
        next.push({ id: `${file.name}-${file.size}-${file.lastModified}-${next.length}`, file })
        totalBytes += file.size
      }
      attachments.value = next
    }

    const buildSendAttachments = async (): Promise<readonly WebUiSendAttachment[]> =>
      Promise.all(
        attachments.value.map(async ({ file }) => ({
          name: file.name,
          mediaType: file.type || 'application/octet-stream',
          size: file.size,
          dataUrl: await readFileAsDataUrl(file)
        }))
      )

    const submitMessage = async () => {
      const conversationId = selectedConversationId.value
      const messageText = composerText.value.trim()
      if (!conversationId || (!messageText && attachments.value.length === 0) || activeRunConversationId.value) return

      submitError.value = ''
      activeRunConversationId.value = conversationId
      try {
        const sendAttachments = await buildSendAttachments()
        await httpClient.postJson(`/api/agent-sessions/${encodeURIComponent(conversationId)}/messages`, {
          text: messageText,
          attachments: sendAttachments,
          reasoningEffort: reasoningEffort.value
        })
        composerText.value = ''
        attachments.value = []
        await loadConversationMessages(conversationId, 'refresh')
        scrollMessagesToEnd('smooth')
        refreshSlashCommands(conversationId)
      } catch (error) {
        if (isAbortError(error)) {
          submitError.value = ''
          bridgeDetail.value = text('requestAborted')
          activeRunConversationId.value = undefined
          return
        }
        submitError.value = error instanceof DOMException ? text('attachmentReadFailed') : localizedErrorMessage(error)
        activeRunConversationId.value = undefined
      }
    }

    const abortMessage = async () => {
      const conversationId = selectedConversationId.value
      if (!conversationId || activeRunConversationId.value !== conversationId) return

      try {
        await httpClient.postJson(`/api/agent-sessions/${encodeURIComponent(conversationId)}/abort`, {})
      } catch (error) {
        submitError.value = ''
        bridgeDetail.value = localizedErrorMessage(error)
        activeRunConversationId.value = undefined
      }
    }

    const copyText = async (value: string) => {
      try {
        await navigator.clipboard.writeText(value)
        return
      } catch {
        const fallback = document.createElement('textarea')
        fallback.value = value
        fallback.setAttribute('readonly', 'true')
        fallback.style.position = 'fixed'
        fallback.style.top = '-1000px'
        fallback.style.opacity = '0'
        document.body.appendChild(fallback)
        fallback.select()
        document.execCommand('copy')
        fallback.remove()
      }
    }

    const startAuthenticatedSession = () => {
      void refreshHealth()
      void loadConversations()
      void loadAgents().catch(() => {
        agents.value = []
      })
      void loadModels().catch(() => {
        modelGroups.value = []
      })
      sseClient.connect()
      if (!healthTimer) healthTimer = window.setInterval(() => void refreshHealth(), 15_000)
    }

    const applyThemeMode = () => {
      document.documentElement.dataset.webuiTheme = themeMode.value
    }

    const toggleThemeMode = () => {
      themeMode.value = themeMode.value === 'dark' ? 'light' : 'dark'
      applyThemeMode()
    }

    const loadAuthStatus = async () => {
      try {
        const status = await httpClient.getJson<WebUiAuthStatusResponse>('/api/auth/status')
        if (!languageOverride.value) language.value = normalizeLanguage(status.language)
        userName.value = status.userName?.trim() ?? ''
        authRequired.value = status.authRequired
        isAuthenticated.value = !status.authRequired
        bridgeDetail.value = text('checkingBridge')
        serviceStartedAt.value = text('unavailable')
        if (!status.authRequired) startAuthenticatedSession()
      } catch (error) {
        bridgeState.value = 'offline'
        bridgeDetail.value = localizedErrorMessage(error)
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

    const unsubscribeSync = sseClient.subscribe<{ conversationId?: string; reason?: string }>('sync', ({ data }) =>
      refreshFromDesktopSync(data?.reason, data?.conversationId)
    )
    const unsubscribeChunk = sseClient.subscribe<WebUiChunkPayload>('chunk', ({ data }) => {
      if (data && typeof data === 'object') queueStreamChunk(data)
    })
    const unsubscribeDone = sseClient.subscribe<{ conversationId?: string }>('done', ({ data }) => {
      const conversationId = data?.conversationId
      if (conversationId === activeRunConversationId.value) activeRunConversationId.value = undefined
      if (conversationId && conversationId === selectedConversationId.value) {
        void loadConversationMessages(conversationId, 'refresh')
        refreshComposerInfo(conversationId)
        refreshSlashCommands(conversationId)
      }
    })
    const unsubscribeError = sseClient.subscribe<{ conversationId?: string; message?: string }>('error', ({ data }) => {
      if (data?.conversationId === activeRunConversationId.value) {
        const message = localizedSseErrorMessage(data.message)
        if (isAbortSseMessage(data.message)) {
          submitError.value = ''
          bridgeDetail.value = message
        } else {
          submitError.value = message
        }
        activeRunConversationId.value = undefined
      }
    })

    onMounted(() => {
      applyThemeMode()
      void loadAuthStatus()
    })

    watch(selectedModel, () => {
      if (!reasoningOptions.value.includes(reasoningEffort.value)) reasoningEffort.value = 'default'
      reasoningPickerOpen.value = false
    })

    onBeforeUnmount(() => {
      if (healthTimer) window.clearInterval(healthTimer)
      if (syncTimer) window.clearTimeout(syncTimer)
      if (chunkFrame !== undefined) window.cancelAnimationFrame(chunkFrame)
      pendingChunks.clear()
      pendingChunkRetries.clear()
      unsubscribeSync()
      unsubscribeChunk()
      unsubscribeDone()
      unsubscribeError()
      sseClient.close()
      delete document.documentElement.dataset.webuiTheme
    })

    return () =>
      authRequired.value && !isAuthenticated.value
        ? h('main', { class: 'auth-shell' }, [
            h('section', { class: 'auth-panel' }, [
              h('img', { class: 'brand-logo', src: webUiLogoPath, alt: 'Cherry Studio' }),
              h('h1', text('authTitle')),
              h('p', { class: 'empty-copy' }, text('authDescription')),
              h('label', { class: 'field-label', for: 'webui-auth-key' }, text('authKey')),
              h('div', { class: 'auth-field-row' }, [
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
                h(
                  'button',
                  {
                    class: 'auth-submit-button',
                    type: 'button',
                    title: text('verify'),
                    'aria-label': text('verify'),
                    onClick: () => void verifyAuthKey()
                  },
                  '↑'
                )
              ]),
              authError.value ? h('p', { class: 'composer-error', role: 'alert' }, authError.value) : undefined,
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
            h('div', { class: 'panel-actions' }, [
              h('div', { class: 'language-menu-wrap' }, [
                h(
                  'button',
                  {
                    class: 'panel-icon-button language-toggle-button',
                    type: 'button',
                    title: text('changeLanguage'),
                    'aria-label': text('changeLanguage'),
                    'aria-expanded': languagePickerOpen.value,
                    onClick: () => {
                      languagePickerOpen.value = !languagePickerOpen.value
                    }
                  },
                  renderLanguageIcon()
                ),
                languagePickerOpen.value
                  ? h(
                      'div',
                      { class: 'language-picker-menu', role: 'menu' },
                      webUiLanguages.map((item) =>
                        h(
                          'button',
                          {
                            class: ['language-picker-option', { 'language-picker-option-selected': language.value === item.id }],
                            type: 'button',
                            role: 'menuitemradio',
                            'aria-checked': language.value === item.id,
                            onClick: () => selectLanguage(item.id)
                          },
                          item.label
                        )
                      )
                    )
                  : undefined
              ]),
              h('button', {
                class: ['panel-icon-button', 'theme-toggle-button', `theme-toggle-button-${themeMode.value}`],
                type: 'button',
                title: themeToggleLabel.value,
                'aria-label': themeToggleLabel.value,
                onClick: toggleThemeMode
              })
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
          h('div', { class: 'conversation-list-heading' }, [
            h('p', { class: 'conversation-section-label' }, text('conversationHistory')),
            conversationLoadMessage.value
              ? h('p', { class: ['empty-copy', `empty-copy-${conversationLoadState.value}`] }, conversationLoadMessage.value)
              : undefined
          ]),
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
                    `${conversationAgentName(conversation.agentId)} · `,
                    new Date(conversation.updatedAt).toLocaleString()
                  ])
                ]
              )
            )
          )
        ]),
        h('section', { class: 'chat-stage', 'aria-label': text('desktopSession') }, [
          h('header', { class: 'chat-header' }, [
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
              renderActionIcon('menu')
            ),
            h('div', [
              h('p', { class: 'eyebrow' }, [
                selectedConversation.value?.workspaceLabel ?? selectedAgentName.value ?? text('desktopSession'),
                conversationLoadState.value === 'loading' || messageLoadState.value === 'loading'
                  ? h('span', { class: 'header-loading-state' }, ` · ${text('loadingConversations')}`)
                  : undefined
              ]),
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
              })
            ])
          ]),
          h('div', { class: 'message-stack', 'aria-live': 'polite', ref: messageStack, onScroll: updateMessageScrollState }, [
            olderMessagesCursor.value
              ? h(
                  'button',
                  {
                    class: 'load-older-button',
                    type: 'button',
                    disabled: olderMessagesLoading.value,
                    onClick: () => void loadOlderMessages()
                  },
                  olderMessagesLoading.value ? text('loadingOlder') : text('loadOlder')
                )
              : undefined,
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
                            onClick: () => void copyText(message.content)
                          },
                          text('copy')
                        )
                      : undefined
                  ]),
                  renderProcessDetails(message),
                  message.attachments?.length
                    ? h(
                        'div',
                        { class: 'message-attachments' },
                        message.attachments.map((attachment) =>
                          h('span', { class: 'message-attachment', title: attachment.mediaType }, attachment.name)
                        )
                      )
                    : undefined,
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
          showScrollToBottom.value
            ? h(
                'button',
                {
                  class: 'scroll-bottom-button',
                  type: 'button',
                  style: { bottom: `${composerHeight.value + (attachments.value.length ? 104 : 72)}px` },
                  title: text('backToBottom'),
                  'aria-label': text('backToBottom'),
                  onClick: () => scrollMessagesToEnd('smooth')
                },
                renderActionIcon('down')
              )
            : undefined,
          h('footer', { class: 'composer' }, [
            h('div', { class: 'composer-surface' }, [
              h('input', {
                class: 'attachment-input',
                ref: attachmentInput,
                type: 'file',
                multiple: true,
                onChange: (event: Event) => {
                  const input = event.target as HTMLInputElement
                  addAttachments(input.files)
                  input.value = ''
                }
              }),
              attachments.value.length
                ? h(
                    'div',
                    { class: 'attachment-strip' },
                    attachments.value.map((attachment) =>
                      h('span', { class: 'attachment-chip', key: attachment.id }, [
                        h('span', { class: 'attachment-chip-name', title: attachment.file.name }, attachment.file.name),
                        h(
                          'button',
                          {
                            type: 'button',
                            title: text('removeAttachment'),
                            'aria-label': `${text('removeAttachment')}: ${attachment.file.name}`,
                            onClick: () => {
                              attachments.value = attachments.value.filter((item) => item.id !== attachment.id)
                            }
                          },
                          '×'
                        )
                      ])
                    )
                  )
                : undefined,
              h('textarea', {
                ref: composerTextarea,
                disabled: !selectedConversation.value || activeRunConversationId.value === selectedConversationId.value,
                value: composerText.value,
                placeholder: selectedConversation.value ? text('sendPlaceholder') : text('selectFirst'),
                rows: 3,
                style: { height: `${composerHeight.value}px` },
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
              h(
                'button',
                {
                  class: 'composer-resize-handle',
                  type: 'button',
                  title: text('resizeComposer'),
                  'aria-label': text('resizeComposer'),
                  onPointerdown: beginComposerResize,
                  onDblclick: () => {
                    composerHeight.value = 92
                  }
                },
                renderActionIcon('resize')
              ),
              h('div', { class: 'composer-toolbar' }, [
                h('div', { class: 'composer-tools' }, [
                  h(
                    'button',
                    {
                      class: 'composer-tool-button',
                      type: 'button',
                      title: text('newConversationTool'),
                      'aria-label': text('newConversationTool'),
                      onClick: () => void openNewConversation()
                    },
                    renderComposerToolIcon('newConversation')
                  ),
                  h(
                    'button',
                    {
                      class: 'composer-tool-button',
                      type: 'button',
                      title: text('attachmentPending'),
                      'aria-label': text('attachmentPending'),
                      disabled: attachments.value.length >= maxAttachmentCount,
                      onClick: () => attachmentInput.value?.click()
                    },
                    renderComposerToolIcon('attachment')
                  ),
                  h(
                    'button',
                    {
                      class: ['composer-tool-button', { 'composer-tool-button-active': reasoningEffort.value !== 'default' }],
                      type: 'button',
                      disabled: !reasoningConfigurable.value,
                      title: reasoningConfigurable.value
                        ? `${text('thinkingPending')}: ${reasoningLabel.value}`
                        : text('thinkingUnavailable'),
                      'aria-label': text('thinkingPending'),
                      'aria-expanded': reasoningPickerOpen.value,
                      onClick: () => {
                        reasoningPickerOpen.value = !reasoningPickerOpen.value
                        modelPickerOpen.value = false
                      }
                    },
                    renderComposerToolIcon('thinking')
                  ),
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
                        reasoningPickerOpen.value = false
                      }
                    },
                    modelUpdateState.value === 'updating' ? text('generating') : modelPickerLabel.value
                  )
                ]),
                h(
                  'button',
                  {
                    class: ['send-button', { 'send-button-is-stop': activeRunConversationId.value === selectedConversationId.value }],
                    type: 'button',
                    disabled:
                      !selectedConversation.value ||
                      (!composerText.value.trim() &&
                        attachments.value.length === 0 &&
                        activeRunConversationId.value !== selectedConversationId.value),
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
                  renderActionIcon(activeRunConversationId.value === selectedConversationId.value ? 'stop' : 'send')
                )
              ]),
            reasoningPickerOpen.value
              ? h(
                  'div',
                  { class: 'reasoning-picker-menu', role: 'listbox' },
                  reasoningOptions.value.map((option) =>
                    h(
                      'button',
                      {
                        class: ['reasoning-picker-option', { 'reasoning-picker-option-selected': option === reasoningEffort.value }],
                        key: option,
                        type: 'button',
                        role: 'option',
                        'aria-selected': option === reasoningEffort.value,
                        onClick: () => {
                          reasoningEffort.value = option
                          reasoningPickerOpen.value = false
                        }
                      },
                      text(
                        ({
                          default: 'reasoningDefault',
                          none: 'reasoningNone',
                          minimal: 'reasoningMinimal',
                          low: 'reasoningLow',
                          medium: 'reasoningMedium',
                          high: 'reasoningHigh',
                          xhigh: 'reasoningXhigh',
                          auto: 'reasoningAuto'
                        } as Record<string, TextKey>)[option] ?? 'reasoningDefault'
                      )
                    )
                  )
                )
              : undefined,
            modelPickerOpen.value
              ? h(
                  'div',
                  { class: 'model-picker-menu', role: 'listbox' },
                  modelGroups.value.flatMap((group) => [
                    h('p', { class: 'model-picker-group', key: `group-${group.id}` }, group.name),
                    ...group.models.map((model) =>
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
                          h('span', { class: 'model-picker-provider' }, model.group ?? model.providerId)
                        ]
                      )
                    )
                  ])
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
            'aria-live': 'polite',
            title: bridgeDetail.value,
            'aria-label': bridgeDetail.value
          }),
          ...statusItems.value.map((item) =>
            h('dl', { class: 'status-row', key: item.label }, [
              h('dt', item.label),
              h('dd', item.value)
            ])
          ),
          h('div', { class: 'version-block' }, [
            ...versionItems.value.map((item) =>
              h('dl', { class: 'status-row version-row', key: item.label }, [
                h('dt', item.label),
                h('dd', item.value)
              ])
            ),
            h(
              'a',
              {
                class: 'status-github-link',
                href: projectRepositoryUrl,
                target: '_blank',
                rel: 'noreferrer',
                title: text('githubProject'),
                'aria-label': text('githubProject')
              },
              renderGithubIcon()
            )
          ])
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
                      class: 'primary-button',
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
    --webui-divider: #e5e7eb;
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

  .auth-field-row {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 42px;
    gap: 8px;
    align-items: center;
  }

  .auth-submit-button {
    display: grid;
    width: 42px;
    height: 42px;
    padding: 0;
    place-items: center;
    color: #ffffff;
    font-size: 21px;
    line-height: 1;
    background: #111827;
    border: 0;
    border-radius: 50%;
    cursor: pointer;
  }

  .conversation-list,
  .status-panel {
    min-height: 0;
    padding: 20px;
    background: #ffffff;
    border-color: #e5e7eb;
  }

  .conversation-list {
    display: grid;
    grid-template-rows: auto auto auto minmax(0, 1fr);
    overflow: hidden;
    border-right: 1px solid #e5e7eb;
  }

  .status-panel {
    overflow-y: auto;
    padding-top: 20px;
    border-left: 1px solid #e5e7eb;
  }

  .panel-header {
    display: flex;
    gap: 12px;
    align-items: center;
    margin-bottom: 14px;
  }

  .panel-header > div:not(.panel-actions) {
    min-width: 0;
  }

  .panel-actions {
    display: flex;
    gap: 6px;
    align-items: center;
    margin-left: auto;
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

  .panel-icon-button,
  .theme-toggle-button {
    display: grid;
    width: 32px;
    height: 32px;
    padding: 0;
    place-items: center;
    color: #475569;
    background: #ffffff;
    border: 1px solid #d1d5db;
    border-radius: 6px;
    cursor: pointer;
  }

  .panel-icon-button:hover,
  .panel-icon-button:focus-visible,
  .theme-toggle-button:hover,
  .theme-toggle-button:focus-visible {
    color: #111827;
    background: #f1f5f9;
    outline: 0;
  }

  .theme-toggle-button::after {
    font-size: 17px;
    line-height: 1;
    content: '\\263c';
  }

  .theme-toggle-button-dark::after {
    content: '\\263e';
  }

  .language-menu-wrap {
    position: relative;
  }

  .language-picker-menu {
    position: absolute;
    top: calc(100% + 6px);
    right: 0;
    display: grid;
    min-width: 112px;
    padding: 4px;
    background: #ffffff;
    border: 1px solid #d1d5db;
    border-radius: 6px;
    box-shadow: 0 10px 24px rgb(15 23 42 / 14%);
  }

  .language-picker-option {
    padding: 7px 8px;
    color: #1f2937;
    font-size: 13px;
    text-align: left;
    background: transparent;
    border: 0;
    border-radius: 4px;
    cursor: pointer;
  }

  .language-picker-option:hover,
  .language-picker-option:focus-visible,
  .language-picker-option-selected {
    background: #eef2ff;
    outline: 0;
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

  .conversation-section-label {
    margin: 10px 2px 0;
    color: #94a3b8;
    font-size: 11px;
    font-weight: 500;
  }

  .header-loading-state {
    color: #94a3b8;
    font-weight: 400;
  }

  .conversation-nav {
    display: grid;
    gap: 8px;
    min-height: 0;
    margin-top: 8px;
    overflow-y: auto;
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
    position: relative;
    display: grid;
    grid-template-rows: auto minmax(0, 1fr) auto;
    height: 100vh;
    height: 100dvh;
    min-width: 0;
    overflow: hidden;
    padding: 20px 20px 10px;
  }

  .message-stack {
    display: flex;
    flex-direction: column;
    gap: 14px;
    min-height: 0;
    overflow-y: auto;
    padding: 12px 4px 8px;
  }

  .load-older-button {
    align-self: center;
    min-height: 30px;
    padding: 0 12px;
    color: #64748b;
    font-size: 12px;
    background: transparent;
    border: 1px solid var(--webui-divider);
    border-radius: 6px;
    cursor: pointer;
  }

  .scroll-bottom-button {
    position: absolute;
    z-index: 4;
    right: 30px;
    bottom: 148px;
    display: grid;
    width: 36px;
    height: 36px;
    padding: 0;
    place-items: center;
    color: #475569;
    background: #ffffff;
    border: 1px solid var(--webui-divider);
    border-radius: 50%;
    box-shadow: 0 5px 18px rgb(15 23 42 / 12%);
    cursor: pointer;
  }

  .chat-header {
    display: flex;
    gap: 12px;
    align-items: center;
    justify-content: space-between;
    padding-bottom: 16px;
    border-bottom: 1px solid var(--webui-divider);
  }

  .chat-header h2 {
    margin-bottom: 0;
  }

  .chat-header > div:not(.mobile-chat-actions) {
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

  .process-block {
    margin-bottom: 12px;
    color: #4b5563;
    background: #f3f4f6;
    border: 1px solid #e5e7eb;
    border-left: 3px solid #9ca3af;
    border-radius: 7px;
  }

  .process-block summary {
    display: flex;
    gap: 8px;
    align-items: center;
    min-height: 36px;
    padding: 0 12px;
    cursor: pointer;
    list-style: none;
  }

  .process-block summary::-webkit-details-marker {
    display: none;
  }

  .process-block[open] summary {
    border-bottom: 1px solid #e5e7eb;
  }

  .process-state-indicator {
    width: 8px;
    height: 8px;
    flex: 0 0 auto;
    background: #9ca3af;
    border-radius: 999px;
  }

  .process-block-pending .process-state-indicator {
    background: #d97706;
    animation: pulse 1s ease-in-out infinite;
  }

  .process-summary {
    overflow: hidden;
    font-size: 13px;
    font-weight: 600;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .process-section {
    padding: 10px 12px;
  }

  .process-section + .process-section {
    border-top: 1px solid #e5e7eb;
  }

  .process-section-title {
    margin: 0 0 8px;
    color: #6b7280;
    font-size: 12px;
    font-weight: 700;
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

  .message-attachments,
  .attachment-strip {
    display: flex;
    gap: 6px;
    flex-wrap: wrap;
  }

  .message-attachments {
    margin-bottom: 8px;
  }

  .message-attachment,
  .attachment-chip {
    display: inline-flex;
    min-width: 0;
    max-width: 220px;
    align-items: center;
    color: inherit;
    font-size: 12px;
    background: rgb(148 163 184 / 16%);
    border: 1px solid rgb(148 163 184 / 28%);
    border-radius: 6px;
  }

  .message-attachment {
    padding: 4px 8px;
  }

  .composer {
    margin-top: 8px;
    padding-top: 8px;
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

  .attachment-input {
    display: none;
  }

  .attachment-strip {
    padding: 10px 42px 0 12px;
  }

  .attachment-chip {
    height: 28px;
    padding-left: 8px;
  }

  .attachment-chip-name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .attachment-chip button {
    width: 26px;
    height: 26px;
    padding: 0;
    color: inherit;
    background: transparent;
    border: 0;
    cursor: pointer;
  }

  .composer-surface textarea {
    display: block;
    min-height: 100px;
    padding: 14px 14px 8px;
    resize: none;
    border: 0;
    border-radius: 18px 18px 0 0;
    outline: 0;
  }

  .composer-resize-handle {
    position: absolute;
    z-index: 2;
    top: 8px;
    right: 9px;
    display: grid;
    width: 28px;
    height: 28px;
    padding: 0;
    place-items: center;
    color: #94a3b8;
    background: transparent;
    border: 0;
    border-radius: 6px;
    cursor: ns-resize;
    touch-action: none;
  }

  .composer-resize-handle svg {
    width: 16px;
    height: 16px;
  }

  .composer-toolbar {
    display: flex;
    min-height: 48px;
    gap: 8px;
    align-items: center;
    justify-content: space-between;
    padding: 5px 8px 6px;
  }

  .composer-toolbar::before {
    position: absolute;
    right: 12px;
    bottom: 51px;
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

  .composer-tools {
    display: flex;
    min-width: 0;
    gap: 4px;
    align-items: center;
    overflow-x: auto;
    scrollbar-width: none;
  }

  .composer-tools::-webkit-scrollbar {
    display: none;
  }

  .composer-tool-button {
    display: grid;
    width: 30px;
    min-width: 30px;
    height: 30px;
    padding: 0;
    place-items: center;
    color: #64748b;
    background: transparent;
    border: 0;
    border-radius: 6px;
    cursor: pointer;
  }

  .composer-tool-button:hover,
  .composer-tool-button:focus-visible {
    color: #0f172a;
    background: #f1f5f9;
    outline: 0;
  }

  .composer-tool-button-pending {
    color: #94a3b8;
  }

  .composer-tool-button-active {
    color: #2563eb;
    background: #eff6ff;
  }

  .send-button {
    display: grid;
    width: 40px;
    min-width: 40px;
    min-height: 40px;
    height: 40px;
    padding: 0;
    place-items: center;
    color: #ffffff;
    border-radius: 50%;
    cursor: pointer;
  }

  .send-button svg {
    display: block;
    width: 20px;
    height: 20px;
  }

  .send-button-is-stop {
    color: #ffffff;
    background: #dc2626;
  }

  .model-picker-menu,
  .reasoning-picker-menu {
    position: absolute;
    z-index: 6;
    right: 8px;
    bottom: calc(100% + 8px);
    width: clamp(220px, 32%, 300px);
    display: grid;
    max-height: min(276px, 42dvh);
    overflow-y: auto;
    padding: 6px;
    background: #ffffff;
    border: 1px solid #dbe1ea;
    border-radius: 12px;
    box-shadow: 0 12px 32px rgb(15 23 42 / 14%);
  }

  .model-picker-menu {
    right: auto;
    bottom: 56px;
    left: 112px;
    width: min(460px, calc(100% - 128px));
    max-height: min(360px, 48dvh);
    transform-origin: bottom left;
    animation: model-drawer-up 140ms ease-out;
  }

  .reasoning-picker-menu {
    z-index: 7;
    right: auto;
    left: 8px;
    max-height: min(276px, 42dvh);
  }

  @keyframes model-drawer-up {
    from {
      opacity: 0;
      transform: translateY(8px) scale(0.98);
    }

    to {
      opacity: 1;
      transform: translateY(0) scale(1);
    }
  }

  .model-picker-group {
    margin: 6px 6px 4px;
    color: #64748b;
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0;
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

  .reasoning-picker-option {
    width: 100%;
    min-height: 34px;
    padding: 0 10px;
    color: #1f2937;
    text-align: left;
    background: transparent;
    border: 0;
    border-radius: 6px;
    cursor: pointer;
  }

  .reasoning-picker-option:hover,
  .reasoning-picker-option-selected {
    background: #eef2ff;
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
    max-height: 220px;
    resize: none;
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

  .primary-button {
    min-height: 40px;
    padding: 0 16px;
    color: #ffffff;
    background: #111827;
    border: 0;
    border-radius: 8px;
    cursor: pointer;
  }

  .status-row {
    margin: 0 0 16px;
    padding-bottom: 14px;
    border-bottom: 1px solid var(--webui-divider);
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

  .version-block {
    margin-top: 0;
    padding-top: 12px;
    border-top: 1px solid var(--webui-divider);
  }

  .status-panel > .status-row:last-of-type {
    margin-bottom: 0;
    padding-bottom: 12px;
    border-bottom: 0;
  }

  .version-row {
    margin-bottom: 10px;
    padding-bottom: 10px;
  }

  .status-github-link {
    display: grid;
    width: 34px;
    height: 34px;
    place-items: center;
    color: #475569;
    background: #ffffff;
    border: 1px solid #d1d5db;
    border-radius: 6px;
    text-decoration: none;
  }

  .status-github-link:hover,
  .status-github-link:focus-visible {
    color: #111827;
    background: #f1f5f9;
    outline: 0;
  }

  @media (prefers-color-scheme: dark) {
    :root {
      --webui-divider: #334155;
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

    .composer-tool-button {
      color: #cbd5e1;
    }

    .composer-tool-button:hover,
    .composer-tool-button:focus-visible {
      color: #ffffff;
      background: #334155;
    }

    .composer-tool-button-pending {
      color: #64748b;
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
    .model-picker-menu,
    .reasoning-picker-menu,
    .scroll-bottom-button {
      color: #e5e7eb;
      background: #273449;
      border-color: #475569;
    }

    .panel-icon-button,
    .status-github-link {
      color: #e5e7eb;
      background: #273449;
      border-color: #475569;
    }

    .slash-command-option {
      color: #e5e7eb;
    }

    .model-picker-option,
    .reasoning-picker-option {
      color: #e5e7eb;
    }

    .slash-command-option:hover,
    .slash-command-option:focus-visible {
      background: #334155;
    }

    .model-picker-option:hover,
    .model-picker-option:focus-visible,
    .model-picker-option-selected,
    .reasoning-picker-option:hover,
    .reasoning-picker-option-selected {
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

  :root[data-webui-theme='dark'] {
    --webui-divider: #334155;
    color: #e5e7eb;
    background: #111827;
    color-scheme: dark;
  }

  :root[data-webui-theme='dark'] .conversation-list,
  :root[data-webui-theme='dark'] .status-panel,
  :root[data-webui-theme='dark'] .message,
  :root[data-webui-theme='dark'] .auth-panel,
  :root[data-webui-theme='dark'] .new-conversation-dialog,
  :root[data-webui-theme='dark'] textarea,
  :root[data-webui-theme='dark'] input,
  :root[data-webui-theme='dark'] select,
  :root[data-webui-theme='dark'] .tool-call-data {
    color: #e5e7eb;
    background: #1f2937;
    border-color: #374151;
  }

  :root[data-webui-theme='dark'] .chat-stage,
  :root[data-webui-theme='dark'] .composer {
    background: #111827;
    border-color: #374151;
  }

  :root[data-webui-theme='dark'] .composer-surface {
    background: #1f2937;
    border-color: #475569;
  }

  :root[data-webui-theme='dark'] .composer-toolbar::before {
    background: #334155;
  }

  :root[data-webui-theme='dark'] .conversation-item,
  :root[data-webui-theme='dark'] .process-block,
  :root[data-webui-theme='dark'] .tool-call,
  :root[data-webui-theme='dark'] .reasoning-block,
  :root[data-webui-theme='dark'] .markdown-content th,
  :root[data-webui-theme='dark'] .secondary-button,
  :root[data-webui-theme='dark'] .icon-button,
  :root[data-webui-theme='dark'] .slash-command-menu,
  :root[data-webui-theme='dark'] .model-picker-menu,
  :root[data-webui-theme='dark'] .reasoning-picker-menu,
  :root[data-webui-theme='dark'] .scroll-bottom-button,
  :root[data-webui-theme='dark'] .theme-toggle-button,
  :root[data-webui-theme='dark'] .panel-icon-button,
  :root[data-webui-theme='dark'] .status-github-link,
  :root[data-webui-theme='dark'] .language-picker-menu {
    color: #e5e7eb;
    background: #273449;
    border-color: #475569;
  }

  :root[data-webui-theme='dark'] .conversation-item:hover,
  :root[data-webui-theme='dark'] .conversation-item-selected,
  :root[data-webui-theme='dark'] .model-picker-option:hover,
  :root[data-webui-theme='dark'] .model-picker-option-selected,
  :root[data-webui-theme='dark'] .reasoning-picker-option:hover,
  :root[data-webui-theme='dark'] .reasoning-picker-option-selected,
  :root[data-webui-theme='dark'] .slash-command-option:hover,
  :root[data-webui-theme='dark'] .theme-toggle-button:hover {
    background: #334155;
  }

  :root[data-webui-theme='dark'] .conversation-title,
  :root[data-webui-theme='dark'] .process-block,
  :root[data-webui-theme='dark'] .tool-call,
  :root[data-webui-theme='dark'] .tool-call-data,
  :root[data-webui-theme='dark'] .slash-command-option,
  :root[data-webui-theme='dark'] .model-picker-option,
  :root[data-webui-theme='dark'] .reasoning-picker-option,
  :root[data-webui-theme='dark'] .composer-tool-button {
    color: #e5e7eb;
  }

  :root[data-webui-theme='dark'] .composer-tool-button-pending,
  :root[data-webui-theme='dark'] .slash-command-description,
  :root[data-webui-theme='dark'] .model-picker-provider {
    color: #94a3b8;
  }

  :root[data-webui-theme='dark'] .language-picker-option {
    color: #e5e7eb;
  }

  :root[data-webui-theme='dark'] .language-picker-option:hover,
  :root[data-webui-theme='dark'] .language-picker-option-selected {
    background: #334155;
  }

  :root[data-webui-theme='light'] {
    --webui-divider: #e5e7eb;
    color: #1f2937;
    background: #f6f7fb;
    color-scheme: light;
  }

  :root[data-webui-theme='light'] .conversation-list,
  :root[data-webui-theme='light'] .status-panel,
  :root[data-webui-theme='light'] .message,
  :root[data-webui-theme='light'] .auth-panel,
  :root[data-webui-theme='light'] .new-conversation-dialog,
  :root[data-webui-theme='light'] textarea,
  :root[data-webui-theme='light'] input,
  :root[data-webui-theme='light'] select,
  :root[data-webui-theme='light'] .tool-call-data {
    color: #111827;
    background: #ffffff;
    border-color: #e5e7eb;
  }

  :root[data-webui-theme='light'] .chat-stage,
  :root[data-webui-theme='light'] .composer {
    background: #f6f7fb;
    border-color: #e5e7eb;
  }

  :root[data-webui-theme='light'] .composer-surface {
    background: #ffffff;
    border-color: #dbe1ea;
  }

  :root[data-webui-theme='light'] .conversation-item,
  :root[data-webui-theme='light'] .process-block,
  :root[data-webui-theme='light'] .tool-call,
  :root[data-webui-theme='light'] .reasoning-block,
  :root[data-webui-theme='light'] .markdown-content th,
  :root[data-webui-theme='light'] .secondary-button,
  :root[data-webui-theme='light'] .icon-button,
  :root[data-webui-theme='light'] .slash-command-menu,
  :root[data-webui-theme='light'] .model-picker-menu,
  :root[data-webui-theme='light'] .reasoning-picker-menu,
  :root[data-webui-theme='light'] .scroll-bottom-button,
  :root[data-webui-theme='light'] .theme-toggle-button,
  :root[data-webui-theme='light'] .panel-icon-button,
  :root[data-webui-theme='light'] .status-github-link,
  :root[data-webui-theme='light'] .language-picker-menu {
    color: #1f2937;
    background: #ffffff;
    border-color: #d1d5db;
  }

  :root[data-webui-theme='light'] .conversation-item:hover,
  :root[data-webui-theme='light'] .conversation-item-selected,
  :root[data-webui-theme='light'] .model-picker-option:hover,
  :root[data-webui-theme='light'] .model-picker-option-selected,
  :root[data-webui-theme='light'] .reasoning-picker-option:hover,
  :root[data-webui-theme='light'] .reasoning-picker-option-selected,
  :root[data-webui-theme='light'] .slash-command-option:hover,
  :root[data-webui-theme='light'] .theme-toggle-button:hover {
    background: #eef2ff;
  }

  :root[data-webui-theme='light'] .conversation-title,
  :root[data-webui-theme='light'] .process-block,
  :root[data-webui-theme='light'] .tool-call,
  :root[data-webui-theme='light'] .tool-call-data,
  :root[data-webui-theme='light'] .slash-command-option,
  :root[data-webui-theme='light'] .model-picker-option,
  :root[data-webui-theme='light'] .reasoning-picker-option,
  :root[data-webui-theme='light'] .composer-tool-button {
    color: #1f2937;
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
      margin-left: 0;
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
      padding: 10px 12px 4px;
    }

    .chat-header {
      display: grid;
      grid-template-columns: 36px minmax(0, 1fr) auto;
      gap: 8px;
      align-items: center;
      padding-bottom: 8px;
    }

    .mobile-chat-actions {
      display: flex;
      gap: 10px;
      align-items: center;
      padding-top: 2px;
    }

    .mobile-chat-actions .mobile-sidebar-button {
      display: none;
    }

    .mobile-bridge-indicator {
      order: 1;
    }

    .mobile-chat-actions .context-orb {
      order: 2;
    }

    .mobile-sidebar-button {
      display: grid;
      width: 36px;
      height: 36px;
      padding: 0;
      place-items: center;
      color: #374151;
      background: #ffffff;
      border: 1px solid #d1d5db;
      border-radius: 6px;
      line-height: 0;
    }

    .mobile-sidebar-button svg {
      display: block;
      width: 20px;
      height: 20px;
      margin: auto;
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
      margin: 2px 0 max(2px, env(safe-area-inset-bottom));
      padding: 4px;
      background: #ffffff;
      border: 1px solid #dbe1ea;
      border-radius: 22px;
      box-shadow: 0 8px 28px rgb(15 23 42 / 10%);
    }

    .scroll-bottom-button {
      right: 20px;
      bottom: 132px;
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
      padding: 8px 10px 4px;
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

    .model-picker-menu,
    .reasoning-picker-menu {
      right: 0;
      bottom: calc(100% + 10px);
      width: min(280px, calc(100% - 8px));
      max-height: min(256px, 36dvh);
    }

    .model-picker-menu {
      right: auto;
      bottom: 58px;
      left: 0;
      width: min(100%, 320px);
      max-height: min(300px, 44dvh);
    }

    .reasoning-picker-menu {
      right: auto;
      left: 0;
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

    }
  }
  :root[data-webui-theme='dark'] .context-orb {
    color: #cbd5e1;
    background: radial-gradient(circle at center, #111827 62%, transparent 64%),
      conic-gradient(var(--context-color) var(--context-usage), #475569 0);
  }

  :root[data-webui-theme='light'] .composer,
  :root[data-webui-theme='light'] .composer-surface,
  :root[data-webui-theme='light'] .composer-surface textarea {
    background: #ffffff;
    border-color: #dbe1ea;
  }

  :root[data-webui-theme='light'] .mobile-sidebar-button,
  :root[data-webui-theme='light'] .theme-toggle-button,
  :root[data-webui-theme='light'] .panel-icon-button {
    color: #374151;
    background: #ffffff;
    border-color: #d1d5db;
  }

  :root[data-webui-theme='light'] .context-orb {
    color: #334155;
    background: radial-gradient(circle at center, #ffffff 62%, transparent 64%),
      conic-gradient(var(--context-color) var(--context-usage), #e2e8f0 0);
  }
`
document.head.appendChild(style)

createApp(App).use(createPinia()).mount('#app')
