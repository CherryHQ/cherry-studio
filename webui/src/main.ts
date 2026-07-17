import { createPinia, storeToRefs } from 'pinia'
import {
  computed,
  createApp,
  defineComponent,
  h,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  type VNode,
  watch
} from 'vue'

import { createWebUiHttpClient, WebUiHttpError } from './service/httpClient'
import { createWebUiSseClient } from './service/sseClient'
import { useWebUiChatStore } from './stores/chatStore'
import type {
  WebUiAgentEntity,
  WebUiAgentSessionEntity,
  WebUiAgentSessionMessageEntity,
  WebUiAgentStatusEvent,
  WebUiAuthStatusResponse,
  WebUiChunkPayload,
  WebUiContextUsage,
  WebUiContextUsageResponse,
  WebUiConversationSummary,
  WebUiCursorResponse,
  WebUiHealthResponse,
  WebUiMessagePart,
  WebUiMessageSnapshot,
  WebUiModel,
  WebUiModelGroup,
  WebUiModelsResponse,
  WebUiOffsetResponse,
  WebUiRole,
  WebUiSendAttachment,
  WebUiSlashCommand,
  WebUiSlashCommandsResponse,
  WebUiToolCallSnapshot,
  WebUiToolCallState,
  WebUiWorkspaceFileEntry,
  WebUiWorkspaceFilesResponse,
  WebUiWorkspaceTextPreview
} from './types/api'
import {
  buildWebUiAgentStatus,
  isWebUiAgentTaskEventData,
  type WebUiAgentArtifact,
  type WebUiAgentStatus,
  type WebUiAgentSubagent,
  type WebUiAgentTask
} from './utils/agentStatus'
import { renderDocxPreviewHtml } from './utils/docxPreview'
import { mountPptxPreview } from './utils/pptxPreview'
import { renderCode, renderMarkdown } from './utils/renderMarkdown'
import {
  createSpeechSynthesisController,
  DEFAULT_SPEECH_PREFERENCES,
  listSpeechVoices,
  loadSpeechPreferences,
  saveSpeechPreferences,
  SPEECH_RATE_MAX,
  type SpeechPreferences,
  type SpeechSynthesisControllerState,
  type SpeechVoiceOption
} from './utils/speechSynthesis'
import {
  buildWorkspaceSearchTree,
  getWorkspaceCodeLanguage,
  getWorkspaceFilePreviewKind,
  getWorkspacePathBasename,
  resolveWorkspaceRelativeArtifactPath,
  resolveWorkspaceRequestPath,
  type WebUiWorkspaceTreeNode
} from './utils/workspaceFiles'

type WebuiStatus = {
  readonly label: string
  readonly value: string
}

type WebUiDraftAttachment = {
  readonly id: string
  readonly file: File
}

type WorkspaceFilePreviewState =
  | { readonly status: 'idle' }
  | { readonly status: 'loading'; readonly path: string }
  | { readonly status: 'error'; readonly path: string; readonly message: string }
  | { readonly status: 'binary'; readonly path: string; readonly name: string }
  | { readonly status: 'text'; readonly path: string; readonly name: string; readonly content: string }
  | { readonly status: 'image'; readonly path: string; readonly name: string; readonly url: string }
  | { readonly status: 'pdf'; readonly path: string; readonly name: string; readonly url: string }
  | {
      readonly status: 'docx'
      readonly path: string
      readonly name: string
      readonly bodyHtml: string
      readonly styleHtml: string
    }
  | { readonly status: 'pptx'; readonly path: string; readonly name: string; readonly data: ArrayBuffer }

const fallbackLanguage = 'en-US'
const webUiLogoPath = './icon.png'
const webUiVersion = '0.1.0'
const projectRepositoryUrl = 'https://github.com/EasongChung/cherry-studio'
const messagePageSize = 50
const maxAttachmentCount = 5
const maxAttachmentBytes = 10 * 1024 * 1024
const maxAttachmentsBytes = 25 * 1024 * 1024
const composerDefaultHeight = 92
const composerMinHeight = 76
const composerMaxHeight = 220
const composerKeyboardStep = 12
const webUiLanguages = [
  { id: 'en-US', label: 'English' },
  { id: 'zh-CN', label: '中文' },
  { id: 'zh-TW', label: '繁體中文' }
] as const

const normalizeLanguage = (language?: string | null) => {
  if (!language) return fallbackLanguage
  const lower = language.toLowerCase()

  return (
    (
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
  )
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
    copyMarkdown: 'Copy Markdown',
    copyPlainText: 'Copy plain text',
    copyCode: 'Copy code',
    copied: 'Copied',
    openPath: 'Open path',
    pathInputPlaceholder: 'Enter a folder path to browse read-only',
    readAloud: 'Read aloud',
    stopReading: 'Stop reading',
    speechUnavailable: 'Speech is not available in this browser.',
    speechPanel: 'Speech',
    speechRate: 'Rate',
    speechPitch: 'Pitch',
    speechVolume: 'Volume',
    speechVoice: 'Voice',
    speechVoiceDefault: 'System default',
    speechPreview: 'Preview',
    speechPreviewSample: 'Hello, this is a speech preview from Cherry Studio WebUI.',
    speechReset: 'Reset defaults',
    speechEmptyContent: 'This message has no readable text.',
    speechGeneratingBlocked: 'Speech is unavailable while the message is generating.',
    deleteConversation: 'Delete conversation',
    deleteConversationDescription:
      'This conversation and its messages will be removed from the desktop app and cannot be restored.',
    delete: 'Delete',
    editTitle: 'Edit title',
    generateTopicName: 'Generate topic name',
    generatingTopicName: 'Generating title...',
    help: 'Help',
    helpGuide: 'Usage guide',
    helpGuideIntro: 'Use the WebUI to continue desktop Agent sessions from this browser.',
    helpGuideSessions: 'Sessions: create, rename, generate topic names, or delete records from the left sidebar.',
    helpGuideFiles: 'Files: preview workspace files from the Files tab when an access key is configured.',
    helpGuideSpeech: 'Speech: adjust browser speech settings from the Speech tab.',
    renameTitle: 'Rename conversation',
    save: 'Save',
    saving: 'Saving...',
    titleRequired: 'Title cannot be empty.',
    deleteMessage: 'Delete this message?',
    deleteMessageDescription: 'This message will be removed from the desktop conversation and cannot be restored.',
    deleting: 'Deleting...',
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
    status: 'Status',
    tasks: 'Tasks',
    subagents: 'Sub-agents',
    artifacts: 'Artifacts',
    contextUsage: 'Context usage',
    runtimeDetails: 'WebUI connection',
    filePreviewPending: 'File preview will be available in a later update.',
    files: 'Files',
    searchFiles: 'Search files',
    refreshFiles: 'Refresh files',
    loadingFiles: 'Loading files',
    filesEmpty: 'No workspace files',
    noSearchResults: 'No matching files',
    selectFile: 'Select a file to preview',
    backToFiles: 'Back to files',
    fileUnavailable: 'This file is unavailable.',
    fileAuthRequired: 'Configure a WebUI access key to browse workspace files.',
    fileTooLarge: 'This file is too large to preview.',
    binaryUnavailable: 'This binary format is not available in the basic preview.',
    statusPending: 'Pending',
    statusRunning: 'In progress',
    statusCompleted: 'Completed',
    statusError: 'Error',
    contextAutocompactBuffer: 'Autocompact buffer',
    contextCustomAgents: 'Custom agents',
    contextFreeSpace: 'Free space',
    contextMcpTools: 'MCP tools',
    contextMemoryFiles: 'Memory files',
    contextMessages: 'Messages',
    contextPlugins: 'Plugins',
    contextSkills: 'Skills',
    contextSystemPrompt: 'System prompt',
    contextSystemTools: 'System tools',
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
    sendPlaceholder: 'Type a message. Enter to send, Shift+Enter for a new line. Type / to search skills or commands.',
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
    copyMarkdown: '复制 Markdown',
    copyPlainText: '复制纯文本',
    copyCode: '复制代码',
    copied: '已复制',
    openPath: '打开路径',
    pathInputPlaceholder: '输入文件夹路径进行只读浏览',
    readAloud: '朗读',
    stopReading: '停止朗读',
    speechUnavailable: '当前浏览器不支持朗读。',
    speechPanel: '朗读',
    speechRate: '语速',
    speechPitch: '音调',
    speechVolume: '音量',
    speechVoice: '音色',
    speechVoiceDefault: '系统默认',
    speechPreview: '试听',
    speechPreviewSample: '你好，这是 Cherry Studio WebUI 的朗读试听。',
    speechReset: '恢复默认',
    speechEmptyContent: '这条消息没有可朗读的正文。',
    speechGeneratingBlocked: '消息生成中，暂不可朗读。',
    deleteConversation: '删除会话',
    deleteConversationDescription: '此会话及其消息将从桌面端删除，且无法恢复。',
    delete: '删除',
    editTitle: '编辑标题',
    generateTopicName: '生成话题名',
    generatingTopicName: '正在生成题名...',
    help: '帮助',
    helpGuide: '使用说明',
    helpGuideIntro: '通过 WebUI 在浏览器中继续使用桌面端 Agent 会话。',
    helpGuideSessions: '会话：可在左侧栏新建、重命名、生成话题名或删除会话记录。',
    helpGuideFiles: '文件：配置访问密钥后，可在“文件”分组预览工作区文件。',
    helpGuideSpeech: '朗读：可在“朗读”分组调整浏览器朗读偏好。',
    renameTitle: '重命名会话',
    save: '保存',
    saving: '保存中...',
    titleRequired: '标题不能为空。',
    deleteMessage: '删除这条消息？',
    deleteMessageDescription: '此消息将从桌面会话中删除，且无法恢复。',
    deleting: '删除中...',
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
    status: '状态',
    tasks: '任务',
    subagents: '子代理',
    artifacts: '产物',
    contextUsage: '上下文用量',
    runtimeDetails: 'WebUI 连接',
    filePreviewPending: '文件预览将在后续版本中提供。',
    files: '文件',
    searchFiles: '搜索文件',
    refreshFiles: '刷新文件',
    loadingFiles: '正在加载文件',
    filesEmpty: '工作区中暂无文件',
    noSearchResults: '没有匹配的文件',
    selectFile: '选择文件进行预览',
    backToFiles: '返回文件列表',
    fileUnavailable: '无法读取此文件。',
    fileAuthRequired: '请先配置 WebUI 访问密钥再浏览工作区文件。',
    fileTooLarge: '文件过大，无法预览。',
    binaryUnavailable: '基础预览暂不支持此二进制格式。',
    statusPending: '等待中',
    statusRunning: '进行中',
    statusCompleted: '已完成',
    statusError: '错误',
    contextAutocompactBuffer: '自动压缩缓冲区',
    contextCustomAgents: '自定义代理',
    contextFreeSpace: '可用空间',
    contextMcpTools: 'MCP 工具',
    contextMemoryFiles: '记忆文件',
    contextMessages: '消息',
    contextPlugins: '插件',
    contextSkills: '技能',
    contextSystemPrompt: '系统提示词',
    contextSystemTools: '系统工具',
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
    sendPlaceholder: '输入消息，Enter 发送，Shift+Enter 换行，输入 / 搜索技能或命令。',
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
    copyMarkdown: '複製 Markdown',
    copyPlainText: '複製純文字',
    copyCode: '複製程式碼',
    copied: '已複製',
    openPath: '開啟路徑',
    pathInputPlaceholder: '輸入資料夾路徑進行唯讀瀏覽',
    readAloud: '朗讀',
    stopReading: '停止朗讀',
    speechUnavailable: '目前瀏覽器不支援朗讀。',
    speechPanel: '朗讀',
    speechRate: '語速',
    speechPitch: '音調',
    speechVolume: '音量',
    speechVoice: '音色',
    speechVoiceDefault: '系統預設',
    speechPreview: '試聽',
    speechPreviewSample: '你好，這是 Cherry Studio WebUI 的朗讀試聽。',
    speechReset: '恢復預設',
    speechEmptyContent: '這則訊息沒有可朗讀的正文。',
    speechGeneratingBlocked: '訊息生成中，暫不可朗讀。',
    deleteConversation: '刪除會話',
    deleteConversationDescription: '此會話及其訊息將從桌面端刪除，且無法復原。',
    delete: '刪除',
    editTitle: '編輯標題',
    generateTopicName: '生成話題名',
    generatingTopicName: '正在生成題名...',
    help: '說明',
    helpGuide: '使用說明',
    helpGuideIntro: '透過 WebUI 在瀏覽器中繼續使用桌面端 Agent 會話。',
    helpGuideSessions: '會話：可在左側欄新增、重新命名、生成話題名或刪除會話記錄。',
    helpGuideFiles: '檔案：設定存取金鑰後，可在「檔案」分組預覽工作區檔案。',
    helpGuideSpeech: '朗讀：可在「朗讀」分組調整瀏覽器朗讀偏好。',
    renameTitle: '重新命名會話',
    save: '儲存',
    saving: '儲存中...',
    titleRequired: '標題不能為空。',
    deleteMessage: '刪除這則訊息？',
    deleteMessageDescription: '此訊息將從桌面會話中刪除，且無法復原。',
    deleting: '刪除中...',
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
    status: '狀態',
    tasks: '任務',
    subagents: '子代理',
    artifacts: '產物',
    contextUsage: '上下文用量',
    runtimeDetails: 'WebUI 連線',
    filePreviewPending: '檔案預覽將在後續版本中提供。',
    files: '檔案',
    searchFiles: '搜尋檔案',
    refreshFiles: '重新整理檔案',
    loadingFiles: '正在載入檔案',
    filesEmpty: '工作區中暫無檔案',
    noSearchResults: '沒有符合的檔案',
    selectFile: '選擇檔案進行預覽',
    backToFiles: '返回檔案清單',
    fileUnavailable: '無法讀取此檔案。',
    fileAuthRequired: '請先設定 WebUI 存取金鑰再瀏覽工作區檔案。',
    fileTooLarge: '檔案過大，無法預覽。',
    binaryUnavailable: '基礎預覽暫不支援此二進位格式。',
    statusPending: '等待中',
    statusRunning: '進行中',
    statusCompleted: '已完成',
    statusError: '錯誤',
    contextAutocompactBuffer: '自動壓縮緩衝區',
    contextCustomAgents: '自訂代理',
    contextFreeSpace: '可用空間',
    contextMcpTools: 'MCP 工具',
    contextMemoryFiles: '記憶檔案',
    contextMessages: '訊息',
    contextPlugins: '外掛',
    contextSkills: '技能',
    contextSystemPrompt: '系統提示詞',
    contextSystemTools: '系統工具',
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
    sendPlaceholder: '輸入訊息，Enter 傳送，Shift+Enter 換行，輸入 / 搜尋技能或命令。',
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

const contextCategoryTextKeys: Readonly<Record<string, TextKey>> = {
  'Autocompact buffer': 'contextAutocompactBuffer',
  'Custom agents': 'contextCustomAgents',
  'Free space': 'contextFreeSpace',
  'MCP tools': 'contextMcpTools',
  'Memory files': 'contextMemoryFiles',
  Messages: 'contextMessages',
  Plugins: 'contextPlugins',
  Skills: 'contextSkills',
  'System prompt': 'contextSystemPrompt',
  'System tools': 'contextSystemTools'
}

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
  workspaceLabel: session.workspace?.name ?? session.workspace?.path,
  ...(session.workspace?.path ? { workspacePath: session.workspace.path } : {})
})

const terminalToolStates: ReadonlySet<WebUiToolCallState> = new Set([
  'output-available',
  'output-error',
  'output-denied'
])

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
    return h(
      'svg',
      baseProps,
      h('path', {
        d: 'm21.4 11.6-8.9 8.9a6 6 0 0 1-8.5-8.5l9.2-9.2a4 4 0 0 1 5.7 5.7l-9.2 9.2a2 2 0 0 1-2.8-2.8l8.5-8.5'
      })
    )
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

const renderThemeIcon = (theme: 'light' | 'dark') => {
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

  return theme === 'light'
    ? h('svg', props, [
        h('circle', { cx: 12, cy: 12, r: 4 }),
        h('path', { d: 'M12 2v2' }),
        h('path', { d: 'M12 20v2' }),
        h('path', { d: 'm4.93 4.93 1.41 1.41' }),
        h('path', { d: 'm17.66 17.66 1.41 1.41' }),
        h('path', { d: 'M2 12h2' }),
        h('path', { d: 'M20 12h2' }),
        h('path', { d: 'm6.34 17.66-1.41 1.41' }),
        h('path', { d: 'm19.07 4.93-1.41 1.41' })
      ])
    : h('svg', props, h('path', { d: 'M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z' }))
}

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

type ActionIconName =
  | 'send'
  | 'stop'
  | 'menu'
  | 'down'
  | 'resize'
  | 'activity'
  | 'close'
  | 'folder'
  | 'edit'
  | 'sparkles'
  | 'trash'
  | 'more'
  | 'help'
  | 'refresh'
  | 'back'
  | 'search'
  | 'volume'

const renderActionIcon = (name: ActionIconName, restore = false) => {
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
  if (name === 'stop')
    return h(
      'svg',
      { ...props, fill: 'currentColor', stroke: 'none' },
      h('rect', { x: 6, y: 6, width: 12, height: 12, rx: 1.5 })
    )
  if (name === 'menu')
    return h('svg', props, [h('path', { d: 'M4 7h16' }), h('path', { d: 'M4 12h16' }), h('path', { d: 'M4 17h16' })])
  if (name === 'down') return h('svg', props, [h('path', { d: 'm6 9 6 6 6-6' })])
  if (name === 'resize') {
    return restore
      ? h('svg', props, [
          h('path', { d: 'm14 10 7-7' }),
          h('path', { d: 'M20 10h-6V4' }),
          h('path', { d: 'm3 21 7-7' }),
          h('path', { d: 'M4 14v6h6' })
        ])
      : h('svg', props, [
          h('path', { d: 'M15 3h6v6' }),
          h('path', { d: 'm21 3-7 7' }),
          h('path', { d: 'M9 21H3v-6' }),
          h('path', { d: 'm3 21 7-7' })
        ])
  }
  if (name === 'activity') return h('svg', props, h('path', { d: 'M3 12h4l2.5-7 5 14 2.5-7h4' }))
  if (name === 'close') return h('svg', props, [h('path', { d: 'm6 6 12 12' }), h('path', { d: 'm18 6-12 12' })])
  if (name === 'folder')
    return h(
      'svg',
      props,
      h('path', { d: 'M3 6a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z' })
    )
  if (name === 'edit')
    return h('svg', props, [
      h('path', { d: 'M12 20h9' }),
      h('path', { d: 'M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z' })
    ])
  if (name === 'sparkles')
    return h('svg', props, [
      h('path', { d: 'm12 3 1.8 4.2L18 9l-4.2 1.8L12 15l-1.8-4.2L6 9l4.2-1.8Z' }),
      h('path', { d: 'm5 14 .9 2.1L8 17l-2.1.9L5 20l-.9-2.1L2 17l2.1-.9Z' }),
      h('path', { d: 'm19 14 .7 1.6 1.6.7-1.6.7L19 19l-.7-1.6-1.6-.7 1.6-.7Z' })
    ])
  if (name === 'trash')
    return h('svg', props, [
      h('path', { d: 'M3 6h18' }),
      h('path', { d: 'M8 6V4h8v2' }),
      h('path', { d: 'm19 6-1 14H6L5 6' }),
      h('path', { d: 'M10 11v5' }),
      h('path', { d: 'M14 11v5' })
    ])
  if (name === 'more')
    return h('svg', props, [
      h('circle', { cx: 5, cy: 12, r: 1 }),
      h('circle', { cx: 12, cy: 12, r: 1 }),
      h('circle', { cx: 19, cy: 12, r: 1 })
    ])
  if (name === 'help')
    return h('svg', props, [
      h('circle', { cx: 12, cy: 12, r: 9 }),
      h('path', { d: 'M9.1 9a3 3 0 1 1 5.8 1c-.5 1.1-1.7 1.5-2.2 2.4-.2.3-.2.7-.2 1.1' }),
      h('path', { d: 'M12 17h.01' })
    ])
  if (name === 'refresh')
    return h('svg', props, [
      h('path', { d: 'M20 6v5h-5' }),
      h('path', { d: 'M4 18v-5h5' }),
      h('path', { d: 'M6.1 9A7 7 0 0 1 18 6l2 5' }),
      h('path', { d: 'm4 13 2 5a7 7 0 0 0 11.9-3' })
    ])
  if (name === 'back') return h('svg', props, [h('path', { d: 'm15 18-6-6 6-6' }), h('path', { d: 'M9 12h10' })])
  if (name === 'search') return h('svg', props, [h('circle', { cx: 11, cy: 11, r: 7 }), h('path', { d: 'm20 20-4-4' })])
  if (name === 'volume')
    return h('svg', props, [
      h('path', { d: 'M11 5 6 9H3v6h3l5 4V5Z' }),
      h('path', { d: 'M15.5 8.5a5 5 0 0 1 0 7' }),
      h('path', { d: 'M18.5 5.5a9 9 0 0 1 0 13' })
    ])
  return h('svg', props)
}

type AgentStatusIconName = 'pending' | 'in_progress' | 'completed' | 'error' | 'subagent' | 'artifact'

const renderAgentStatusIcon = (name: AgentStatusIconName) => {
  const props = {
    width: 15,
    height: 15,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    'stroke-width': 2,
    'stroke-linecap': 'round',
    'stroke-linejoin': 'round',
    'aria-hidden': 'true'
  }

  if (name === 'completed')
    return h('svg', props, [h('circle', { cx: 12, cy: 12, r: 9 }), h('path', { d: 'm8 12 2.5 2.5L16 9' })])
  if (name === 'in_progress')
    return h('svg', props, [h('path', { d: 'M21 12a9 9 0 1 1-3-6.7' }), h('path', { d: 'M21 3v6h-6' })])
  if (name === 'error')
    return h('svg', props, [
      h('circle', { cx: 12, cy: 12, r: 9 }),
      h('path', { d: 'M12 8v5' }),
      h('path', { d: 'M12 16h.01' })
    ])
  if (name === 'subagent')
    return h('svg', props, [
      h('rect', { x: 4, y: 7, width: 16, height: 12, rx: 2 }),
      h('path', { d: 'M12 3v4' }),
      h('path', { d: 'M8 12h.01' }),
      h('path', { d: 'M16 12h.01' }),
      h('path', { d: 'M9 16h6' })
    ])
  if (name === 'artifact')
    return h('svg', props, [
      h('path', { d: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z' }),
      h('path', { d: 'M14 2v6h6' })
    ])
  return h('svg', props, h('circle', { cx: 12, cy: 12, r: 8 }))
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

const toAgentStatusEvents = (parts: readonly WebUiMessagePart[]): readonly WebUiAgentStatusEvent[] => {
  const events: WebUiAgentStatusEvent[] = []

  for (const part of parts) {
    if (part.type === 'data-agent-task-event' && isWebUiAgentTaskEventData(part.data)) {
      events.push({
        kind: 'task-event',
        id: part.id ?? `${part.data.taskId}:${part.data.event}:${events.length}`,
        data: part.data
      })
      continue
    }
    if (!part.type.startsWith('tool-') && part.type !== 'dynamic-tool') continue
    if (!part.toolCallId) continue
    events.push({
      kind: 'tool',
      id: part.toolCallId,
      name: toToolName(part.type, part.toolName),
      state: toToolState(part.state),
      ...(part.input !== undefined ? { input: part.input } : {}),
      ...(part.output !== undefined ? { output: part.output } : {})
    })
  }

  return events
}

const upsertAgentStatusEvent = (
  events: readonly WebUiAgentStatusEvent[],
  event: WebUiAgentStatusEvent
): readonly WebUiAgentStatusEvent[] => {
  const index = events.findIndex((item) => item.kind === event.kind && item.id === event.id)
  if (index < 0) return [...events, event]
  const next = [...events]
  next[index] = event
  return next
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
  const agentStatusEvents = toAgentStatusEvents(parts)
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
    ...(agentStatusEvents.length ? { agentStatusEvents } : {}),
    ...(attachments.length ? { attachments } : {}),
    status: message.status,
    ...(processingTimeMs ? { processingTimeMs } : {}),
    createdAt: message.createdAt
  }
}

const readFileAsDataUrl = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.addEventListener('load', () =>
      typeof reader.result === 'string' ? resolve(reader.result) : reject(new Error('Invalid file data'))
    )
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
    // Pinia store inside Vue setup; not a React Hook.
    // eslint-disable-next-line react-hooks/rules-of-hooks -- Vue Pinia store used in defineComponent setup
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
    const statusPreviewOpen = ref(false)
    const statusPanelOpen = ref(false)
    const rightPanelTab = ref<'status' | 'files' | 'speech' | 'help'>('status')
    const statusPanelWidth = ref(Number(window.localStorage.getItem('cherry-webui.right-panel-width')) || 380)
    const statusPanelResizing = ref(false)
    const openConversationMenuId = ref<string>()
    const editingConversationId = ref<string>()
    const editingConversationTitle = ref('')
    const conversationActionId = ref<string>()
    const conversationActionState = ref<'idle' | 'saving' | 'generating' | 'deleting' | 'error'>('idle')
    const conversationActionError = ref('')
    const deleteConversationId = ref<string>()
    const speechPreferences = ref<SpeechPreferences>(loadSpeechPreferences())
    const speechVoices = ref<readonly SpeechVoiceOption[]>([])
    const speechNotice = ref<{ readonly message: string; readonly messageId: string } | null>(null)
    const workspaceDirectoryEntries = ref<Readonly<Record<string, readonly WebUiWorkspaceFileEntry[]>>>({})
    const workspaceExpandedDirectories = ref<ReadonlySet<string>>(new Set())
    const workspaceFileSearch = ref('')
    const workspacePathDraft = ref('')
    const copiedHint = ref<string>()
    const workspaceSearchEntries = ref<readonly WebUiWorkspaceFileEntry[]>([])
    const workspaceFilesLoading = ref(false)
    const workspaceFilesError = ref('')
    const selectedWorkspaceFile = ref('')
    const workspaceFilePreview = ref<WorkspaceFilePreviewState>({ status: 'idle' })
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
    const composerHeight = ref(composerDefaultHeight)
    const deleteMessageId = ref<string>()
    const messageDeleteState = ref<'idle' | 'deleting' | 'error'>('idle')
    const messageDeleteError = ref('')
    const speechState = ref<SpeechSynthesisControllerState>({ isSpeaking: false })
    const speechController = createSpeechSynthesisController({
      onStateChange: (state) => {
        speechState.value = state
      },
      getPreferences: () => speechPreferences.value
    })
    const pendingChunks = new Map<string, WebUiChunkPayload[]>()
    const pendingChunkRetries = new Map<string, number>()
    let healthTimer: number | undefined
    let contextUsageTimer: number | undefined
    let syncTimer: number | undefined
    let chunkFrame: number | undefined
    let latestMessageRequest = 0
    let statusPreviewOpenTimer: number | undefined
    let statusPreviewCloseTimer: number | undefined
    let workspaceFileSearchTimer: number | undefined
    let workspaceFileRequestGeneration = 0
    let workspacePreviewRequestGeneration = 0
    let workspacePptxPreviewController: AbortController | undefined
    let workspacePptxPreviewDestroy: (() => void) | undefined

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
    const modelPickerLabel = computed(
      () => selectedModel.value?.name ?? selectedAgent.value?.modelName ?? selectedAgent.value?.model ?? text('agent')
    )
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
    const contextUsageColor = computed(() => {
      const percentage = contextUsagePercentage.value
      if (percentage === undefined) return undefined
      if (percentage <= 50) {
        const warningWeight = percentage * 2
        return `color-mix(in oklch, #22c55e ${100 - warningWeight}%, #f59e0b ${warningWeight}%)`
      }
      const errorWeight = (percentage - 50) * 2
      return `color-mix(in oklch, #f59e0b ${100 - errorWeight}%, #ef4444 ${errorWeight}%)`
    })
    const renderContextOrb = () =>
      h(
        'span',
        {
          class: [
            'context-orb',
            contextUsagePercentage.value === undefined ? 'context-orb-empty' : `context-orb-${contextUsageTone.value}`
          ],
          style: {
            '--context-usage':
              contextUsagePercentage.value === undefined
                ? '0deg'
                : `${Math.round((contextUsagePercentage.value / 100) * 360)}deg`
          },
          'aria-hidden': 'true'
        },
        contextUsagePercentage.value === undefined ? '--' : String(contextUsagePercentage.value)
      )
    const agentStatus = computed(() => buildWebUiAgentStatus(messages.value))
    const incompleteTaskCount = computed(
      () => agentStatus.value.tasks.filter((task) => task.status !== 'completed').length
    )
    const contextUsageCategories = computed(() =>
      (contextUsage.value?.categories ?? []).filter((category) => category.tokens > 0).slice(0, 4)
    )
    const workspaceSearchTree = computed(() => buildWorkspaceSearchTree(workspaceSearchEntries.value))
    const workspaceRootKey = computed(() => workspacePathDraft.value.trim())
    const workspaceRootPath = computed(
      () => workspacePathDraft.value.trim() || selectedConversation.value?.workspacePath || ''
    )
    const workspaceRootLabel = computed(
      () => workspacePathDraft.value.trim() || selectedConversation.value?.workspaceLabel || text('files')
    )
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
    const deletingConversation = computed(() =>
      conversations.value.find((conversation) => conversation.id === deleteConversationId.value)
    )

    const text = (key: TextKey) => {
      const pack = textPacks[language.value as keyof typeof textPacks] ?? textPacks[fallbackLanguage]
      return pack[key] ?? textPacks[fallbackLanguage][key]
    }

    const localizedErrorMessage = (error: unknown) =>
      isAbortError(error) ? text('requestAborted') : toErrorMessage(error)
    const showCopiedHint = (label: string) => {
      copiedHint.value = label
      window.setTimeout(() => {
        if (copiedHint.value === label) copiedHint.value = undefined
      }, 1400)
    }
    const markdownToPlainText = (value: string) => {
      const container = document.createElement('div')
      container.innerHTML = renderMarkdown(value, { copyCodeLabel: text('copyCode') })
      return (container.textContent ?? value).trim()
    }
    const isReadingMessage = (messageId: string) =>
      speechState.value.isSpeaking && speechState.value.messageId === messageId
    const refreshSpeechVoices = () => {
      speechVoices.value = listSpeechVoices()
      speechController.refreshSupport()
    }
    const persistSpeechPreferences = (next: SpeechPreferences) => {
      speechPreferences.value = next
      saveSpeechPreferences(next)
      speechController.applyLivePreferences(next)
    }
    const updateSpeechPreference = <K extends keyof SpeechPreferences>(key: K, value: SpeechPreferences[K]) => {
      persistSpeechPreferences({ ...speechPreferences.value, [key]: value })
    }
    const resetSpeechPreferences = () => {
      persistSpeechPreferences({ ...DEFAULT_SPEECH_PREFERENCES })
    }
    const showSpeechNotice = (message: string, messageId?: string) => {
      const targetMessageId = messageId ?? ''
      speechNotice.value = { message, messageId: targetMessageId }
      window.setTimeout(() => {
        const current = speechNotice.value
        if (current?.message === message && current.messageId === targetMessageId) speechNotice.value = null
      }, 2600)
    }
    const openSpeechPanel = () => {
      clearStatusPreviewTimers()
      statusPreviewOpen.value = false
      statusPanelOpen.value = true
      rightPanelTab.value = 'speech'
      refreshSpeechVoices()
    }
    const previewSpeechSettings = () => {
      if (!speechController.refreshSupport()) {
        showSpeechNotice(text('speechUnavailable'))
        return
      }
      speechController.preview(text('speechPreviewSample'), language.value)
    }
    const renderSpeechPanel = () =>
      h('div', { class: 'speech-settings-panel' }, [
        !speechController.isSupported
          ? h('p', { class: 'speech-settings-warning', role: 'status' }, text('speechUnavailable'))
          : undefined,
        h('label', { class: 'speech-setting-row' }, [
          h('span', text('speechRate')),
          h('div', { class: 'speech-setting-control' }, [
            h('input', {
              type: 'range',
              min: '0.5',
              max: String(SPEECH_RATE_MAX),
              step: '0.1',
              value: String(speechPreferences.value.rate),
              disabled: !speechController.isSupported,
              'aria-label': text('speechRate'),
              onInput: (event: Event) => {
                updateSpeechPreference('rate', Number((event.target as HTMLInputElement).value))
              }
            }),
            h('span', { class: 'speech-setting-value' }, speechPreferences.value.rate.toFixed(1))
          ])
        ]),
        h('label', { class: 'speech-setting-row' }, [
          h('span', text('speechPitch')),
          h('div', { class: 'speech-setting-control' }, [
            h('input', {
              type: 'range',
              min: '0',
              max: '2',
              step: '0.1',
              value: String(speechPreferences.value.pitch),
              disabled: !speechController.isSupported,
              'aria-label': text('speechPitch'),
              onInput: (event: Event) => {
                updateSpeechPreference('pitch', Number((event.target as HTMLInputElement).value))
              }
            }),
            h('span', { class: 'speech-setting-value' }, speechPreferences.value.pitch.toFixed(1))
          ])
        ]),
        h('label', { class: 'speech-setting-row' }, [
          h('span', text('speechVolume')),
          h('div', { class: 'speech-setting-control' }, [
            h('input', {
              type: 'range',
              min: '0',
              max: '1',
              step: '0.05',
              value: String(speechPreferences.value.volume),
              disabled: !speechController.isSupported,
              'aria-label': text('speechVolume'),
              onInput: (event: Event) => {
                updateSpeechPreference('volume', Number((event.target as HTMLInputElement).value))
              }
            }),
            h('span', { class: 'speech-setting-value' }, `${Math.round(speechPreferences.value.volume * 100)}%`)
          ])
        ]),
        h('label', { class: 'speech-setting-row speech-setting-row-select' }, [
          h('span', text('speechVoice')),
          h(
            'select',
            {
              class: 'speech-voice-select',
              value: speechPreferences.value.voiceURI,
              disabled: !speechController.isSupported,
              'aria-label': text('speechVoice'),
              onChange: (event: Event) => {
                updateSpeechPreference('voiceURI', (event.target as HTMLSelectElement).value)
              },
              onFocus: refreshSpeechVoices
            },
            [
              h('option', { value: '' }, text('speechVoiceDefault')),
              ...speechVoices.value.map((voice) =>
                h('option', { value: voice.voiceURI, key: voice.voiceURI }, `${voice.name} (${voice.lang})`)
              )
            ]
          )
        ]),
        h('div', { class: 'speech-settings-actions' }, [
          h(
            'button',
            {
              class: 'speech-settings-button',
              type: 'button',
              disabled: !speechController.isSupported,
              onClick: previewSpeechSettings
            },
            text('speechPreview')
          ),
          h(
            'button',
            {
              class: ['speech-settings-button', 'speech-settings-button-secondary'],
              type: 'button',
              onClick: resetSpeechPreferences
            },
            text('speechReset')
          )
        ])
      ])
    const localizedSseErrorMessage = (message?: string) =>
      message && isAbortError(message) ? text('requestAborted') : message || text('disconnected')
    const isAbortSseMessage = (message?: string) => Boolean(message && isAbortError(message))

    const hasProcessDetails = (message: WebUiMessageSnapshot) => Boolean(message.reasoning || message.toolCalls?.length)
    const getProcessSummary = (message: WebUiMessageSnapshot) => {
      if (message.status !== 'pending' && message.processingTimeMs) {
        return `${text('processingTime')} ${formatDuration(message.processingTimeMs)}`
      }
      if (message.toolCalls?.length)
        return `${text('processDetails')} · ${message.toolCalls.length} ${text('toolCalls')}`
      return text('reasoning')
    }
    const renderToolCall = (tool: WebUiToolCallSnapshot, message: WebUiMessageSnapshot) =>
      h(
        'details',
        {
          class: ['tool-call', `tool-call-${tool.state}`],
          open: message.status === 'pending' && !terminalToolStates.has(tool.state)
        },
        [
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
        ]
      )
    const renderProcessDetails = (message: WebUiMessageSnapshot) =>
      hasProcessDetails(message)
        ? h('details', { class: ['process-block', { 'process-block-pending': message.status === 'pending' }] }, [
            h('summary', [
              h('span', { class: 'process-state-indicator', 'aria-hidden': 'true' }),
              h('span', { class: 'process-summary' }, getProcessSummary(message))
            ]),
            message.reasoning
              ? h('section', { class: 'process-section' }, [
                  h('details', { class: 'reasoning-block' }, [
                    h('summary', text('reasoning')),
                    h('div', {
                      class: 'markdown-content',
                      onClick: handleMarkdownContentClick,
                      innerHTML: renderMarkdown(message.reasoning, { copyCodeLabel: text('copyCode') })
                    })
                  ])
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

    const workspaceApiPath = (route: 'files' | 'file' | 'preview', requestPath = '', search = '') => {
      const conversationId = selectedConversationId.value
      if (!conversationId) return undefined
      const query = new URLSearchParams()
      if (requestPath) query.set('path', requestPath)
      if (search) query.set('search', search)
      const suffix = query.size ? `?${query.toString()}` : ''
      return `/api/agent-sessions/${encodeURIComponent(conversationId)}/workspace/${route}${suffix}`
    }

    const getWorkspaceFileErrorMessage = (error: unknown) => {
      if (error instanceof WebUiHttpError) {
        if (error.payload?.code === 'WEBUI_WORKSPACE_AUTH_REQUIRED') return text('fileAuthRequired')
        if (error.payload?.code === 'WEBUI_WORKSPACE_FILE_TOO_LARGE') return text('fileTooLarge')
        if (error.payload?.code === 'WEBUI_WORKSPACE_PREVIEW_UNSUPPORTED') return text('binaryUnavailable')
        if (error.payload?.code?.startsWith('WEBUI_WORKSPACE_')) return text('fileUnavailable')
      }
      return localizedErrorMessage(error)
    }

    const releaseWorkspacePptxPreview = () => {
      workspacePptxPreviewController?.abort()
      workspacePptxPreviewDestroy?.()
      workspacePptxPreviewController = undefined
      workspacePptxPreviewDestroy = undefined
    }

    const releaseWorkspacePreview = () => {
      releaseWorkspacePptxPreview()
      if (workspaceFilePreview.value.status === 'image' || workspaceFilePreview.value.status === 'pdf') {
        URL.revokeObjectURL(workspaceFilePreview.value.url)
      }
    }

    const mountWorkspacePptxPreview = async (container: HTMLElement, data: ArrayBuffer, requestPath: string) => {
      releaseWorkspacePptxPreview()
      const controller = new AbortController()
      workspacePptxPreviewController = controller
      try {
        const handle = await mountPptxPreview(container, data, controller.signal)
        if (
          controller.signal.aborted ||
          workspacePptxPreviewController !== controller ||
          workspaceFilePreview.value.status !== 'pptx' ||
          workspaceFilePreview.value.path !== requestPath
        ) {
          handle.destroy()
          return
        }
        workspacePptxPreviewDestroy = handle.destroy
      } catch (error) {
        if (controller.signal.aborted || workspacePptxPreviewController !== controller) return
        if (workspaceFilePreview.value.status === 'pptx' && workspaceFilePreview.value.path === requestPath) {
          workspaceFilePreview.value = { status: 'error', path: requestPath, message: text('fileUnavailable') }
        }
      }
    }

    const resetWorkspaceFiles = () => {
      workspaceFileRequestGeneration += 1
      workspacePreviewRequestGeneration += 1
      if (workspaceFileSearchTimer !== undefined) window.clearTimeout(workspaceFileSearchTimer)
      workspaceFileSearchTimer = undefined
      releaseWorkspacePreview()
      workspaceDirectoryEntries.value = {}
      workspaceExpandedDirectories.value = new Set()
      workspaceFileSearch.value = ''
      workspacePathDraft.value = ''
      workspaceSearchEntries.value = []
      workspaceFilesLoading.value = false
      workspaceFilesError.value = ''
      selectedWorkspaceFile.value = ''
      workspaceFilePreview.value = { status: 'idle' }
    }

    const loadWorkspaceDirectory = async (directory = workspaceRootKey.value, force = false) => {
      if (!selectedConversationId.value) {
        workspaceFilesError.value = text('filesEmpty')
        return
      }
      if (!authRequired.value) {
        workspaceFilesError.value = text('fileAuthRequired')
        return
      }
      if (!force && workspaceDirectoryEntries.value[directory]) return
      const apiPath = workspaceApiPath('files', directory)
      if (!apiPath) return

      const generation = workspaceFileRequestGeneration
      const conversationId = selectedConversationId.value
      workspaceFilesLoading.value = true
      workspaceFilesError.value = ''
      try {
        const response = await httpClient.getJson<WebUiWorkspaceFilesResponse>(apiPath)
        if (generation !== workspaceFileRequestGeneration || conversationId !== selectedConversationId.value) return
        workspaceDirectoryEntries.value = { ...workspaceDirectoryEntries.value, [directory]: response.entries }
      } catch (error) {
        if (generation !== workspaceFileRequestGeneration || conversationId !== selectedConversationId.value) return
        workspaceFilesError.value = getWorkspaceFileErrorMessage(error)
      } finally {
        if (generation === workspaceFileRequestGeneration) workspaceFilesLoading.value = false
      }
    }

    const loadWorkspaceSearch = async (query: string) => {
      const apiPath = workspaceApiPath('files', workspaceRootKey.value, query)
      if (!apiPath || !selectedConversationId.value || !authRequired.value) {
        workspaceSearchEntries.value = []
        if (!authRequired.value) workspaceFilesError.value = text('fileAuthRequired')
        return
      }

      const generation = workspaceFileRequestGeneration
      const conversationId = selectedConversationId.value
      workspaceFilesLoading.value = true
      workspaceFilesError.value = ''
      try {
        const response = await httpClient.getJson<WebUiWorkspaceFilesResponse>(apiPath)
        if (
          generation !== workspaceFileRequestGeneration ||
          conversationId !== selectedConversationId.value ||
          query !== workspaceFileSearch.value.trim()
        ) {
          return
        }
        workspaceSearchEntries.value = response.entries
      } catch (error) {
        if (generation !== workspaceFileRequestGeneration || conversationId !== selectedConversationId.value) return
        workspaceFilesError.value = getWorkspaceFileErrorMessage(error)
      } finally {
        if (generation === workspaceFileRequestGeneration) workspaceFilesLoading.value = false
      }
    }

    const refreshWorkspaceFiles = () => {
      const search = workspaceFileSearch.value.trim()
      workspaceDirectoryEntries.value = {}
      workspaceSearchEntries.value = []
      if (search) void loadWorkspaceSearch(search)
      else void loadWorkspaceDirectory(workspaceRootKey.value, true)
    }

    const openWorkspaceRootPath = () => {
      workspaceFileSearch.value = ''
      workspaceExpandedDirectories.value = new Set()
      closeWorkspaceFilePreview()
      workspaceDirectoryEntries.value = {}
      void loadWorkspaceDirectory(workspaceRootKey.value, true)
    }

    const toggleWorkspaceDirectory = (directory: string) => {
      const next = new Set(workspaceExpandedDirectories.value)
      if (next.has(directory)) {
        next.delete(directory)
      } else {
        next.add(directory)
        void loadWorkspaceDirectory(directory)
      }
      workspaceExpandedDirectories.value = next
    }

    const closeWorkspaceFilePreview = () => {
      workspacePreviewRequestGeneration += 1
      releaseWorkspacePreview()
      selectedWorkspaceFile.value = ''
      workspaceFilePreview.value = { status: 'idle' }
    }

    const openWorkspaceFile = async (filePath: string) => {
      const requestPath = resolveWorkspaceRequestPath(selectedConversation.value?.workspacePath, filePath)
      if (!requestPath) return
      const previewKind = getWorkspaceFilePreviewKind(requestPath)
      const isBinaryPreview =
        previewKind === 'image' || previewKind === 'pdf' || previewKind === 'docx' || previewKind === 'pptx'
      const apiPath = workspaceApiPath(isBinaryPreview ? 'preview' : 'file', requestPath)
      if (!apiPath) return

      releaseWorkspacePreview()
      selectedWorkspaceFile.value = requestPath
      workspaceFilePreview.value = { status: 'loading', path: requestPath }
      const requestGeneration = ++workspacePreviewRequestGeneration
      const conversationId = selectedConversationId.value
      try {
        if (isBinaryPreview) {
          const blob = await httpClient.getBlob(apiPath)
          if (
            requestGeneration !== workspacePreviewRequestGeneration ||
            conversationId !== selectedConversationId.value
          )
            return
          if (previewKind === 'docx') {
            const rendered = await renderDocxPreviewHtml(blob)
            if (
              requestGeneration !== workspacePreviewRequestGeneration ||
              conversationId !== selectedConversationId.value
            )
              return
            workspaceFilePreview.value = {
              status: 'docx',
              path: requestPath,
              name: getWorkspacePathBasename(requestPath),
              ...rendered
            }
            return
          }
          if (previewKind === 'pptx') {
            const data = await blob.arrayBuffer()
            if (
              requestGeneration !== workspacePreviewRequestGeneration ||
              conversationId !== selectedConversationId.value
            )
              return
            workspaceFilePreview.value = {
              status: 'pptx',
              path: requestPath,
              name: getWorkspacePathBasename(requestPath),
              data
            }
            return
          }
          workspaceFilePreview.value = {
            status: previewKind,
            path: requestPath,
            name: getWorkspacePathBasename(requestPath),
            url: URL.createObjectURL(blob)
          }
          return
        }

        const response = await httpClient.getJson<WebUiWorkspaceTextPreview>(apiPath)
        if (requestGeneration !== workspacePreviewRequestGeneration || conversationId !== selectedConversationId.value)
          return
        workspaceFilePreview.value =
          response.kind === 'text'
            ? { status: 'text', path: requestPath, name: response.name, content: response.content ?? '' }
            : { status: 'binary', path: requestPath, name: response.name }
      } catch (error) {
        if (requestGeneration !== workspacePreviewRequestGeneration || conversationId !== selectedConversationId.value)
          return
        workspaceFilePreview.value = {
          status: 'error',
          path: requestPath,
          message: getWorkspaceFileErrorMessage(error)
        }
      }
    }

    const handleMarkdownContentClick = (event: MouseEvent) => {
      const target =
        event.target instanceof Element
          ? event.target.closest<HTMLElement>('[data-webui-copy-code], [data-webui-file-path]')
          : null
      if (!target) return
      if (target.dataset.webuiCopyCode !== undefined) {
        const code = target.closest('.markdown-code-block')?.querySelector('pre code')?.textContent ?? ''
        if (code) void copyText(code).then(() => showCopiedHint(text('copyCode')))
        return
      }
      const filePath = target.dataset.webuiFilePath
      if (filePath) {
        event.preventDefault()
        openFilesPanel()
        void openWorkspaceFile(filePath)
      }
    }

    const openFilesPanel = () => {
      clearStatusPreviewTimers()
      statusPreviewOpen.value = false
      statusPanelOpen.value = true
      rightPanelTab.value = 'files'
      if (!workspaceDirectoryEntries.value[workspaceRootKey.value]) void loadWorkspaceDirectory(workspaceRootKey.value)
    }

    const openWorkspaceArtifact = (artifact: WebUiAgentArtifact) => {
      const relativePath = resolveWorkspaceRelativeArtifactPath(
        selectedConversation.value?.workspacePath,
        artifact.path
      )
      if (!relativePath) return
      openFilesPanel()
      void openWorkspaceFile(relativePath)
    }

    const getAgentStatusLabel = (status: WebUiAgentTask['status'] | WebUiAgentSubagent['status']) => {
      if (status === 'in_progress' || status === 'running') return text('statusRunning')
      if (status === 'completed' || status === 'done') return text('statusCompleted')
      if (status === 'error') return text('statusError')
      return text('statusPending')
    }

    const getContextCategoryLabel = (name: string) => {
      const key = contextCategoryTextKeys[name]
      return key ? text(key) : name
    }

    const renderContextUsageSummary = (compact = false) => {
      const percentage = contextUsagePercentage.value
      const usage = contextUsage.value
      return h(
        'section',
        { class: ['agent-status-section', 'context-usage-summary', { 'agent-status-section-compact': compact }] },
        [
          h('h3', text('contextUsage')),
          usage && percentage !== undefined
            ? h('div', { class: 'context-usage-content' }, [
                h(
                  'div',
                  { class: 'context-progress-track' },
                  h('span', {
                    class: ['context-progress-value', `context-progress-value-${contextUsageTone.value}`],
                    style: { width: `${percentage}%`, background: contextUsageColor.value }
                  })
                ),
                h('div', { class: 'context-usage-meta' }, [
                  h(
                    'span',
                    `${usage.totalTokens.toLocaleString()} / ${usage.maxTokens.toLocaleString()} (${percentage}%)`
                  ),
                  h('span', { title: usage.model }, usage.model)
                ]),
                contextUsageCategories.value.length
                  ? h(
                      'dl',
                      { class: 'context-category-list' },
                      contextUsageCategories.value.flatMap((category) => [
                        h('dt', { key: `${category.name}-name` }, getContextCategoryLabel(category.name)),
                        h('dd', { key: `${category.name}-tokens` }, category.tokens.toLocaleString())
                      ])
                    )
                  : undefined
              ])
            : h('p', { class: 'agent-status-empty' }, text('noContext'))
        ]
      )
    }

    const renderTaskList = (tasks: readonly WebUiAgentTask[], compact = false) =>
      tasks.length
        ? h('section', { class: ['agent-status-section', { 'agent-status-section-compact': compact }] }, [
            h('div', { class: 'agent-status-section-heading' }, [
              h('h3', text('tasks')),
              h(
                'span',
                { class: 'agent-status-count-badge' },
                `${agentStatus.value.completedTaskCount}/${agentStatus.value.totalTaskCount}`
              )
            ]),
            h(
              'ul',
              { class: 'agent-status-list' },
              tasks.map((task) =>
                h('li', { class: ['agent-status-item', `agent-status-item-${task.status}`], key: task.id }, [
                  h(
                    'span',
                    { class: ['agent-status-item-icon', `agent-status-item-icon-${task.status}`] },
                    renderAgentStatusIcon(task.status)
                  ),
                  h('span', { class: 'agent-status-item-copy' }, [
                    h(
                      'span',
                      {
                        class: [
                          'agent-status-item-title',
                          { 'agent-status-item-title-completed': task.status === 'completed' }
                        ]
                      },
                      task.status === 'in_progress' && task.activeText ? task.activeText : task.title
                    ),
                    compact
                      ? undefined
                      : h('span', { class: 'agent-status-item-state' }, getAgentStatusLabel(task.status))
                  ])
                ])
              )
            )
          ])
        : undefined

    const renderSubagentList = (subagents: readonly WebUiAgentSubagent[], compact = false) =>
      subagents.length
        ? h('section', { class: ['agent-status-section', { 'agent-status-section-compact': compact }] }, [
            h('div', { class: 'agent-status-section-heading agent-status-section-heading-icon' }, [
              renderAgentStatusIcon('subagent'),
              h('h3', text('subagents'))
            ]),
            h(
              'ul',
              { class: 'agent-status-list' },
              subagents.map((subagent) => {
                const iconName =
                  subagent.status === 'running' ? 'in_progress' : subagent.status === 'done' ? 'completed' : 'error'
                return h('li', { class: 'agent-status-item', key: subagent.id }, [
                  h(
                    'span',
                    { class: ['agent-status-item-icon', `agent-status-item-icon-${iconName}`] },
                    renderAgentStatusIcon(iconName)
                  ),
                  h('span', { class: 'agent-status-item-copy' }, [
                    h('span', { class: 'agent-status-item-title' }, subagent.name),
                    compact
                      ? undefined
                      : h('span', { class: 'agent-status-item-state' }, getAgentStatusLabel(subagent.status))
                  ])
                ])
              })
            )
          ])
        : undefined

    const renderArtifactList = (artifacts: readonly WebUiAgentArtifact[], compact = false) =>
      artifacts.length
        ? h('section', { class: ['agent-status-section', { 'agent-status-section-compact': compact }] }, [
            h('div', { class: 'agent-status-section-heading agent-status-section-heading-icon' }, [
              renderAgentStatusIcon('artifact'),
              h('h3', text('artifacts'))
            ]),
            h(
              'ul',
              { class: 'agent-status-list agent-artifact-list' },
              artifacts.map((artifact) => {
                const canPreview = Boolean(
                  resolveWorkspaceRelativeArtifactPath(selectedConversation.value?.workspacePath, artifact.path)
                )
                return h(
                  'li',
                  { key: artifact.id },
                  h(
                    'button',
                    {
                      class: 'agent-status-item agent-artifact-item',
                      type: 'button',
                      disabled: !canPreview,
                      title: canPreview ? artifact.path : text('filePreviewPending'),
                      onClick: () => openWorkspaceArtifact(artifact)
                    },
                    [
                      h(
                        'span',
                        { class: 'agent-status-item-icon agent-status-item-icon-artifact' },
                        renderAgentStatusIcon('artifact')
                      ),
                      h('span', { class: 'agent-status-item-copy' }, [
                        h('span', { class: 'agent-status-item-title' }, artifact.name),
                        compact
                          ? undefined
                          : h(
                              'span',
                              { class: 'agent-status-item-state', title: artifact.path },
                              artifact.description ?? artifact.path
                            )
                      ])
                    ]
                  )
                )
              })
            )
          ])
        : undefined

    function renderWorkspaceTreeNodes(
      nodes: readonly WebUiWorkspaceTreeNode[],
      depth = 0,
      searchMode = false
    ): ReturnType<typeof h>[] {
      return nodes.flatMap((node) => {
        const expanded = searchMode || workspaceExpandedDirectories.value.has(node.path)
        const children = searchMode
          ? (node.children ?? [])
          : (workspaceDirectoryEntries.value[node.path] ?? []).map((entry) => ({ ...entry }))
        const row = h(
          'button',
          {
            class: ['workspace-file-row', { 'workspace-file-row-selected': selectedWorkspaceFile.value === node.path }],
            key: node.path,
            type: 'button',
            style: { '--workspace-file-depth': String(depth) },
            title: node.path,
            onClick: () => {
              if (node.isDirectory) toggleWorkspaceDirectory(node.path)
              else void openWorkspaceFile(node.path)
            }
          },
          [
            node.isDirectory
              ? h('span', { class: ['workspace-file-chevron', { 'workspace-file-chevron-expanded': expanded }] }, '›')
              : h('span', { class: 'workspace-file-chevron workspace-file-chevron-spacer' }),
            h(
              'span',
              {
                class: [
                  'workspace-file-kind-icon',
                  node.isDirectory ? 'workspace-file-kind-folder' : 'workspace-file-kind-file'
                ]
              },
              node.isDirectory ? renderActionIcon('folder') : renderAgentStatusIcon('artifact')
            ),
            h('span', { class: 'workspace-file-name' }, node.name)
          ]
        )
        return expanded && children.length ? [row, ...renderWorkspaceTreeNodes(children, depth + 1, searchMode)] : [row]
      })
    }

    const renderWorkspaceFilePreview = () => {
      const preview = workspaceFilePreview.value
      if (preview.status === 'idle') return undefined
      const previewKind = getWorkspaceFilePreviewKind(preview.path)
      return h('section', { class: 'workspace-file-preview' }, [
        h('header', { class: 'workspace-file-preview-header' }, [
          h(
            'button',
            {
              class: 'workspace-file-preview-back',
              type: 'button',
              title: text('backToFiles'),
              'aria-label': text('backToFiles'),
              onClick: closeWorkspaceFilePreview
            },
            renderActionIcon('back')
          ),
          h('span', { class: 'workspace-file-preview-title' }, getWorkspacePathBasename(preview.path))
        ]),
        h('div', { class: ['workspace-file-preview-content', `workspace-file-preview-${preview.status}`] }, [
          preview.status === 'loading'
            ? h('p', { class: 'workspace-files-state' }, text('loadingFiles'))
            : preview.status === 'error'
              ? h('p', { class: 'workspace-files-state workspace-files-state-error' }, preview.message)
              : preview.status === 'binary'
                ? h('p', { class: 'workspace-files-state' }, text('binaryUnavailable'))
                : preview.status === 'pptx'
                  ? h(
                      'div',
                      {
                        class: 'workspace-pptx-preview-stage',
                        role: 'document',
                        tabindex: 0,
                        'aria-label': preview.name,
                        onVnodeMounted: (vnode: VNode) => {
                          if (vnode.el instanceof HTMLElement) {
                            void mountWorkspacePptxPreview(vnode.el, preview.data, preview.path)
                          }
                        },
                        onVnodeBeforeUnmount: releaseWorkspacePptxPreview
                      },
                      h(
                        'p',
                        { class: 'workspace-pptx-preview-loading', 'data-pptx-preview-loading': '', role: 'status' },
                        text('loadingFiles')
                      )
                    )
                  : preview.status === 'docx'
                    ? h('div', { class: 'workspace-docx-preview-scroll' }, [
                        h('div', { class: 'workspace-docx-preview-style', innerHTML: preview.styleHtml }),
                        h('div', { class: 'workspace-docx-preview', innerHTML: preview.bodyHtml })
                      ])
                    : preview.status === 'pdf'
                      ? h('iframe', {
                          class: 'workspace-pdf-preview',
                          src: preview.url,
                          title: preview.name
                        })
                      : preview.status === 'image'
                        ? h('img', {
                            class: 'workspace-image-preview',
                            src: preview.url,
                            alt: preview.name,
                            onError: () => {
                              URL.revokeObjectURL(preview.url)
                              workspaceFilePreview.value = {
                                status: 'error',
                                path: preview.path,
                                message: text('fileUnavailable')
                              }
                            }
                          })
                        : previewKind === 'markdown'
                          ? h('div', {
                              class: 'workspace-markdown-preview markdown-content',
                              onClick: handleMarkdownContentClick,
                              innerHTML: renderMarkdown(preview.content, { copyCodeLabel: text('copyCode') })
                            })
                          : h(
                              'pre',
                              { class: 'workspace-code-preview hljs' },
                              h('code', {
                                innerHTML: renderCode(preview.content, getWorkspaceCodeLanguage(preview.path))
                              })
                            )
        ])
      ])
    }

    const renderWorkspaceFilesPanel = () => {
      const search = workspaceFileSearch.value.trim()
      const rootEntries = (workspaceDirectoryEntries.value[workspaceRootKey.value] ?? []).map((entry) => ({ ...entry }))
      const nodes = search ? workspaceSearchTree.value : rootEntries
      return h('div', { class: 'workspace-files-panel' }, [
        renderWorkspaceFilePreview() ??
          h('div', { class: 'workspace-files-browser' }, [
            h('div', { class: 'workspace-files-toolbar' }, [
              h('div', { class: 'workspace-file-path-wrap' }, [
                h('input', {
                  class: 'workspace-file-path-input',
                  type: 'text',
                  value: workspacePathDraft.value,
                  placeholder: workspaceRootPath.value || text('pathInputPlaceholder'),
                  'aria-label': text('pathInputPlaceholder'),
                  onInput: (event: Event) => {
                    workspacePathDraft.value = (event.target as HTMLInputElement).value
                  },
                  onKeydown: (event: KeyboardEvent) => {
                    if (event.key === 'Enter') {
                      event.preventDefault()
                      openWorkspaceRootPath()
                    }
                  }
                }),
                h(
                  'button',
                  {
                    class: 'workspace-files-refresh',
                    type: 'button',
                    title: text('openPath'),
                    'aria-label': text('openPath'),
                    onClick: openWorkspaceRootPath
                  },
                  renderActionIcon('folder')
                )
              ]),
              h('div', { class: 'workspace-file-search-wrap' }, [
                h('span', { class: 'workspace-file-search-icon', 'aria-hidden': 'true' }, renderActionIcon('search')),
                h('input', {
                  class: 'workspace-file-search',
                  type: 'search',
                  value: workspaceFileSearch.value,
                  placeholder: text('searchFiles'),
                  'aria-label': text('searchFiles'),
                  onInput: (event: Event) => {
                    workspaceFileSearch.value = (event.target as HTMLInputElement).value
                  }
                })
              ]),
              h(
                'button',
                {
                  class: 'workspace-files-refresh',
                  type: 'button',
                  title: text('refreshFiles'),
                  'aria-label': text('refreshFiles'),
                  onClick: refreshWorkspaceFiles
                },
                renderActionIcon('refresh')
              )
            ]),
            h('div', { class: 'workspace-files-root-label' }, [
              renderActionIcon('folder'),
              h('span', workspaceRootLabel.value)
            ]),
            h('div', { class: 'workspace-file-tree' }, [
              workspaceFilesLoading.value && !nodes.length
                ? h('p', { class: 'workspace-files-state' }, text('loadingFiles'))
                : workspaceFilesError.value
                  ? h('p', { class: 'workspace-files-state workspace-files-state-error' }, workspaceFilesError.value)
                  : !nodes.length
                    ? h('p', { class: 'workspace-files-state' }, search ? text('noSearchResults') : text('filesEmpty'))
                    : renderWorkspaceTreeNodes(nodes, 0, Boolean(search))
            ])
          ])
      ])
    }

    const renderAgentStatusBody = (status: WebUiAgentStatus, compact = false) => [
      compact ? undefined : renderTaskList(status.tasks, false),
      renderContextUsageSummary(compact),
      compact ? renderTaskList(status.tasks, true) : undefined,
      renderSubagentList(status.subagents, compact),
      renderArtifactList(status.artifacts, compact)
    ]

    const clearStatusPreviewTimers = () => {
      if (statusPreviewOpenTimer !== undefined) window.clearTimeout(statusPreviewOpenTimer)
      if (statusPreviewCloseTimer !== undefined) window.clearTimeout(statusPreviewCloseTimer)
      statusPreviewOpenTimer = undefined
      statusPreviewCloseTimer = undefined
    }

    const scheduleStatusPreviewOpen = () => {
      if (statusPanelOpen.value) return
      if (statusPreviewCloseTimer !== undefined) window.clearTimeout(statusPreviewCloseTimer)
      statusPreviewCloseTimer = undefined
      if (statusPreviewOpen.value || statusPreviewOpenTimer !== undefined) return
      statusPreviewOpenTimer = window.setTimeout(() => {
        statusPreviewOpenTimer = undefined
        statusPreviewOpen.value = true
        refreshComposerInfo()
      }, 150)
    }

    const scheduleStatusPreviewClose = () => {
      if (statusPreviewOpenTimer !== undefined) window.clearTimeout(statusPreviewOpenTimer)
      statusPreviewOpenTimer = undefined
      if (statusPreviewCloseTimer !== undefined) window.clearTimeout(statusPreviewCloseTimer)
      statusPreviewCloseTimer = window.setTimeout(() => {
        statusPreviewCloseTimer = undefined
        statusPreviewOpen.value = false
      }, 100)
    }

    const toggleStatusPanel = () => {
      clearStatusPreviewTimers()
      statusPreviewOpen.value = false
      if (statusPanelOpen.value && rightPanelTab.value === 'status') {
        statusPanelOpen.value = false
        return
      }
      statusPanelOpen.value = true
      rightPanelTab.value = 'status'
      refreshComposerInfo()
    }

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
          resetWorkspaceFiles()
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
        await httpClient.patchJson(`/api/agent-sessions/${encodeURIComponent(conversationId)}/model`, {
          model: model.id
        })
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
      clearStatusPreviewTimers()
      closeConversationMenu()
      statusPreviewOpen.value = false
      if (conversationId === selectedConversationId.value) {
        mobileSidebarOpen.value = false
        void loadConversationMessages(conversationId, 'refresh')
        refreshComposerInfo(conversationId)
        refreshSlashCommands(conversationId)
        if (statusPanelOpen.value && rightPanelTab.value === 'files') refreshWorkspaceFiles()
        return
      }

      resetWorkspaceFiles()
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

    const toggleConversationMenu = (conversationId: string) => {
      openConversationMenuId.value = openConversationMenuId.value === conversationId ? undefined : conversationId
    }

    const closeConversationMenu = () => {
      openConversationMenuId.value = undefined
    }

    const openEditConversation = (conversation: WebUiConversationSummary) => {
      closeConversationMenu()
      editingConversationId.value = conversation.id
      editingConversationTitle.value = conversation.title
      conversationActionId.value = conversation.id
      conversationActionState.value = 'idle'
      conversationActionError.value = ''
    }

    const closeEditConversation = () => {
      if (conversationActionState.value === 'saving' || conversationActionState.value === 'generating') return
      editingConversationId.value = undefined
      editingConversationTitle.value = ''
      conversationActionId.value = undefined
      conversationActionState.value = 'idle'
      conversationActionError.value = ''
    }

    const saveConversationTitle = async () => {
      const conversationId = editingConversationId.value
      if (
        !conversationId ||
        conversationActionState.value === 'saving' ||
        conversationActionState.value === 'generating'
      )
        return
      const nextTitle = editingConversationTitle.value.trim()
      if (!nextTitle) {
        conversationActionError.value = text('titleRequired')
        return
      }
      conversationActionState.value = 'saving'
      conversationActionError.value = ''
      try {
        await httpClient.patchJson(`/api/data/agent-sessions/${encodeURIComponent(conversationId)}`, {
          name: nextTitle,
          isNameManuallyEdited: true
        })
        editingConversationId.value = undefined
        editingConversationTitle.value = ''
        conversationActionState.value = 'idle'
        await loadConversations()
      } catch (error) {
        conversationActionState.value = 'error'
        conversationActionError.value = localizedErrorMessage(error)
      }
    }

    const generateConversationTitle = async (conversationId: string) => {
      if (
        !conversationId ||
        conversationActionState.value === 'saving' ||
        conversationActionState.value === 'generating'
      )
        return
      closeConversationMenu()
      conversationActionId.value = conversationId
      conversationActionState.value = 'generating'
      conversationActionError.value = ''
      try {
        await httpClient.postJson(`/api/agent-sessions/${encodeURIComponent(conversationId)}/generate-title`, {})
        await loadConversations()
        if (selectedConversationId.value === conversationId) {
          await loadConversationMessages(conversationId, 'refresh')
        }
        conversationActionState.value = 'idle'
      } catch (error) {
        conversationActionState.value = 'error'
        conversationActionError.value = localizedErrorMessage(error)
      }
    }

    const openDeleteConversation = (conversationId: string) => {
      if (conversationActionState.value === 'saving' || conversationActionState.value === 'generating') return
      closeConversationMenu()
      deleteConversationId.value = conversationId
      conversationActionId.value = conversationId
      conversationActionState.value = 'idle'
      conversationActionError.value = ''
    }

    const closeDeleteConversation = () => {
      if (conversationActionState.value === 'deleting') return
      deleteConversationId.value = undefined
      conversationActionId.value = undefined
      conversationActionState.value = 'idle'
      conversationActionError.value = ''
    }

    const confirmDeleteConversation = async () => {
      const conversationId = deleteConversationId.value
      if (!conversationId || conversationActionState.value === 'deleting') return
      conversationActionState.value = 'deleting'
      conversationActionError.value = ''
      try {
        await httpClient.deleteJson(`/api/data/agent-sessions/${encodeURIComponent(conversationId)}`)
        deleteConversationId.value = undefined
        conversationActionId.value = undefined
        conversationActionState.value = 'idle'
        if (selectedConversationId.value === conversationId) {
          selectedConversationId.value = undefined
          messages.value = []
          contextUsage.value = null
          slashCommands.value = []
          olderMessagesCursor.value = undefined
          messageLoadState.value = 'idle'
          messageLoadMessage.value = text('sessionsChanged')
        }
        await loadConversations()
      } catch (error) {
        conversationActionState.value = 'error'
        conversationActionError.value = localizedErrorMessage(error)
      }
    }

    const beginPanelResize = (event: PointerEvent) => {
      if (!statusPanelOpen.value) return
      const host = event.currentTarget as HTMLElement | null
      const pointerId = event.pointerId
      const startX = event.clientX
      const startWidth = statusPanelWidth.value
      const minWidth = 300
      const maxWidth = 520
      statusPanelResizing.value = true
      host?.setPointerCapture(pointerId)
      const onMove = (moveEvent: PointerEvent) => {
        const delta = startX - moveEvent.clientX
        statusPanelWidth.value = Math.min(maxWidth, Math.max(minWidth, Math.round(startWidth + delta)))
      }
      const onUp = () => {
        statusPanelResizing.value = false
        window.localStorage.setItem('cherry-webui.right-panel-width', String(statusPanelWidth.value))
        window.removeEventListener('pointermove', onMove)
        window.removeEventListener('pointerup', onUp)
        window.removeEventListener('pointercancel', onUp)
      }
      window.addEventListener('pointermove', onMove)
      window.addEventListener('pointerup', onUp)
      window.addEventListener('pointercancel', onUp)
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
          if (reason === 'stream-terminal' || reason === 'message-submitted' || reason === 'message-deleted') {
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
      } else if (chunk.type === 'data-agent-task-event' && isWebUiAgentTaskEventData(chunk.data)) {
        const statusEvent: WebUiAgentStatusEvent = {
          kind: 'task-event',
          id: chunk.id ?? `${chunk.data.taskId}:${chunk.data.event}`,
          data: chunk.data
        }
        nextMessages[messageIndex] = {
          ...message,
          agentStatusEvents: upsertAgentStatusEvent(message.agentStatusEvents ?? [], statusEvent)
        }
      } else if (chunk.toolCallId) {
        const previousTools = message.toolCalls ?? []
        const previousTool = previousTools.find((tool) => tool.id === chunk.toolCallId)
        const previousStatusEvents = message.agentStatusEvents ?? []
        const previousStatusEvent = previousStatusEvents.find(
          (event): event is Extract<WebUiAgentStatusEvent, { kind: 'tool' }> =>
            event.kind === 'tool' && event.id === chunk.toolCallId
        )
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
                        : (previousTool?.state ?? 'input-streaming'),
          ...(chunk.type === 'tool-input-delta'
            ? { input: `${previousTool?.input ?? ''}${chunk.inputTextDelta ?? ''}` }
            : input
              ? { input }
              : previousTool?.input
                ? { input: previousTool.input }
                : {}),
          ...(output ? { output } : previousTool?.output ? { output: previousTool.output } : {}),
          ...(chunk.errorText
            ? { errorText: chunk.errorText }
            : previousTool?.errorText
              ? { errorText: previousTool.errorText }
              : {})
        }
        nextMessages[messageIndex] = {
          ...message,
          toolCalls: [...previousTools.filter((tool) => tool.id !== chunk.toolCallId), nextTool],
          agentStatusEvents: upsertAgentStatusEvent(previousStatusEvents, {
            kind: 'tool',
            id: chunk.toolCallId,
            name: chunk.toolName ?? previousStatusEvent?.name ?? previousTool?.name ?? 'Tool',
            state: nextTool.state,
            ...(chunk.type === 'tool-input-delta'
              ? {
                  input: `${typeof previousStatusEvent?.input === 'string' ? previousStatusEvent.input : ''}${chunk.inputTextDelta ?? ''}`
                }
              : chunk.input !== undefined
                ? { input: chunk.input }
                : previousStatusEvent?.input !== undefined
                  ? { input: previousStatusEvent.input }
                  : {}),
            ...(chunk.output !== undefined
              ? { output: chunk.output }
              : previousStatusEvent?.output !== undefined
                ? { output: previousStatusEvent.output }
                : {})
          })
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
      if (event.button !== 0) return
      event.preventDefault()
      const startY = event.clientY
      const startHeight = composerHeight.value
      const onMove = (moveEvent: PointerEvent) => {
        composerHeight.value = Math.max(
          composerMinHeight,
          Math.min(composerMaxHeight, startHeight + startY - moveEvent.clientY)
        )
      }
      const onEnd = () => {
        window.removeEventListener('pointermove', onMove)
        window.removeEventListener('pointerup', onEnd)
      }
      window.addEventListener('pointermove', onMove)
      window.addEventListener('pointerup', onEnd, { once: true })
    }

    const handleComposerResizeKeydown = (event: KeyboardEvent) => {
      if (!['ArrowUp', 'ArrowDown', 'Home'].includes(event.key)) return
      event.preventDefault()
      if (event.key === 'Home') {
        composerHeight.value = composerDefaultHeight
        return
      }
      const delta = event.key === 'ArrowUp' ? composerKeyboardStep : -composerKeyboardStep
      composerHeight.value = Math.max(composerMinHeight, Math.min(composerMaxHeight, composerHeight.value + delta))
    }

    const toggleComposerHeight = () => {
      composerHeight.value = composerHeight.value === composerDefaultHeight ? composerMaxHeight : composerDefaultHeight
    }

    const addAttachments = (selectedFiles: FileList | null) => {
      if (!selectedFiles?.length) return
      const next = [...attachments.value]
      let totalBytes = next.reduce((sum, attachment) => sum + attachment.file.size, 0)
      for (const file of Array.from(selectedFiles)) {
        if (
          next.length >= maxAttachmentCount ||
          file.size > maxAttachmentBytes ||
          totalBytes + file.size > maxAttachmentsBytes
        ) {
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

    const toggleReadMessageAloud = (message: WebUiMessageSnapshot) => {
      if (!speechController.refreshSupport()) {
        showSpeechNotice(text('speechUnavailable'), message.id)
        return
      }
      if (message.status === 'pending') {
        showSpeechNotice(text('speechGeneratingBlocked'), message.id)
        return
      }
      if (!message.content.trim()) {
        showSpeechNotice(text('speechEmptyContent'), message.id)
        return
      }
      speechController.speak(message.id, message.content, language.value)
    }

    const renderMessageActions = (message: WebUiMessageSnapshot) =>
      h('div', { class: 'message-actions' }, [
        message.content
          ? h(
              'button',
              {
                class: 'message-action-chip',
                type: 'button',
                title: text('copyMarkdown'),
                'aria-label': text('copyMarkdown'),
                onClick: () => {
                  void copyText(message.content).then(() => showCopiedHint(text('copyMarkdown')))
                }
              },
              'MD'
            )
          : undefined,
        message.content
          ? h(
              'button',
              {
                class: 'message-action-chip',
                type: 'button',
                title: text('copyPlainText'),
                'aria-label': text('copyPlainText'),
                onClick: () => {
                  void copyText(markdownToPlainText(message.content)).then(() => showCopiedHint(text('copyPlainText')))
                }
              },
              'TXT'
            )
          : undefined,
        message.content
          ? h('span', { class: 'message-action-wrap' }, [
              speechNotice.value?.messageId === message.id
                ? h('span', { class: 'speech-notice', role: 'status' }, speechNotice.value.message)
                : undefined,
              h(
                'button',
                {
                  class: [
                    'message-action-button',
                    {
                      'message-action-button-active': isReadingMessage(message.id),
                      'message-action-button-unsupported': !speechController.isSupported
                    }
                  ],
                  type: 'button',
                  disabled: message.status === 'pending' || !message.content.trim(),
                  title: speechController.isSupported
                    ? isReadingMessage(message.id)
                      ? text('stopReading')
                      : text('readAloud')
                    : text('speechUnavailable'),
                  'aria-label': isReadingMessage(message.id) ? text('stopReading') : text('readAloud'),
                  'aria-pressed': isReadingMessage(message.id) ? 'true' : 'false',
                  onClick: () => toggleReadMessageAloud(message)
                },
                renderActionIcon(isReadingMessage(message.id) ? 'stop' : 'volume')
              )
            ])
          : undefined,
        h(
          'button',
          {
            class: ['message-action-button', 'message-delete-button'],
            type: 'button',
            disabled: activeRunConversationId.value === selectedConversationId.value,
            title: text('delete'),
            'aria-label': text('delete'),
            onClick: () => openDeleteMessage(message.id)
          },
          h('svg', { viewBox: '0 0 24 24', 'aria-hidden': 'true' }, [
            h('path', { d: 'M3 6h18' }),
            h('path', { d: 'M8 6V4h8v2' }),
            h('path', { d: 'm19 6-1 14H6L5 6' }),
            h('path', { d: 'M10 11v5' }),
            h('path', { d: 'M14 11v5' })
          ])
        ),
        copiedHint.value ? h('span', { class: 'message-copy-hint', role: 'status' }, text('copied')) : undefined
      ])

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

    const openDeleteMessage = (messageId: string) => {
      if (activeRunConversationId.value === selectedConversationId.value) return
      deleteMessageId.value = messageId
      messageDeleteState.value = 'idle'
      messageDeleteError.value = ''
    }

    const closeDeleteMessage = () => {
      if (messageDeleteState.value === 'deleting') return
      deleteMessageId.value = undefined
      messageDeleteState.value = 'idle'
      messageDeleteError.value = ''
    }

    const confirmDeleteMessage = async () => {
      const conversationId = selectedConversationId.value
      const messageId = deleteMessageId.value
      if (!conversationId || !messageId || messageDeleteState.value === 'deleting') return
      if (activeRunConversationId.value === conversationId) return

      messageDeleteState.value = 'deleting'
      messageDeleteError.value = ''
      try {
        await httpClient.deleteJson(
          `/api/data/agent-sessions/${encodeURIComponent(conversationId)}/messages/${encodeURIComponent(messageId)}`
        )
        messages.value = messages.value.filter((message) => message.id !== messageId)
        contextUsage.value = null
        deleteMessageId.value = undefined
        messageDeleteState.value = 'idle'
        messageLoadMessage.value = messages.value.length ? '' : text('emptyConversation')
        await Promise.all([loadConversationMessages(conversationId, 'refresh'), loadConversations()])
        refreshComposerInfo(conversationId)
      } catch (error) {
        messageDeleteState.value = 'error'
        messageDeleteError.value = localizedErrorMessage(error)
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
        if (statusPanelOpen.value && rightPanelTab.value === 'files') refreshWorkspaceFiles()
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
      refreshSpeechVoices()
      if (typeof window !== 'undefined' && window.speechSynthesis) {
        window.speechSynthesis.addEventListener('voiceschanged', refreshSpeechVoices)
      }
    })

    watch(selectedModel, () => {
      if (!reasoningOptions.value.includes(reasoningEffort.value)) reasoningEffort.value = 'default'
      reasoningPickerOpen.value = false
    })

    watch(selectedConversationId, () => {
      speechController.stop()
    })

    watch(workspaceFileSearch, (value) => {
      if (workspaceFileSearchTimer !== undefined) window.clearTimeout(workspaceFileSearchTimer)
      workspaceFileSearchTimer = undefined
      workspaceSearchEntries.value = []
      if (!statusPanelOpen.value || rightPanelTab.value !== 'files') return
      const query = value.trim()
      if (!query) {
        void loadWorkspaceDirectory()
        return
      }
      workspaceFileSearchTimer = window.setTimeout(() => {
        workspaceFileSearchTimer = undefined
        void loadWorkspaceSearch(query)
      }, 200)
    })

    watch([statusPreviewOpen, statusPanelOpen, activeRunConversationId, selectedConversationId], () => {
      if (contextUsageTimer !== undefined) window.clearInterval(contextUsageTimer)
      contextUsageTimer = undefined
      const conversationId = selectedConversationId.value
      if (
        !conversationId ||
        activeRunConversationId.value !== conversationId ||
        (!statusPreviewOpen.value && !statusPanelOpen.value)
      ) {
        return
      }
      refreshComposerInfo(conversationId)
      contextUsageTimer = window.setInterval(() => refreshComposerInfo(conversationId), 1200)
    })

    onBeforeUnmount(() => {
      clearStatusPreviewTimers()
      if (workspaceFileSearchTimer !== undefined) window.clearTimeout(workspaceFileSearchTimer)
      releaseWorkspacePreview()
      if (healthTimer) window.clearInterval(healthTimer)
      if (contextUsageTimer) window.clearInterval(contextUsageTimer)
      if (syncTimer) window.clearTimeout(syncTimer)
      if (chunkFrame !== undefined) window.cancelAnimationFrame(chunkFrame)
      pendingChunks.clear()
      pendingChunkRetries.clear()
      speechController.stop()
      unsubscribeSync()
      unsubscribeChunk()
      unsubscribeDone()
      unsubscribeError()
      sseClient.close()
      delete document.documentElement.dataset.webuiTheme
      if (typeof window !== 'undefined' && window.speechSynthesis) {
        window.speechSynthesis.removeEventListener('voiceschanged', refreshSpeechVoices)
      }
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
              authError.value ? h('p', { class: 'composer-error', role: 'alert' }, authError.value) : undefined
            ])
          ])
        : h(
            'main',
            {
              class: [
                'webui-shell',
                {
                  'webui-shell-status-open': statusPanelOpen.value,
                  'webui-shell-files-open': statusPanelOpen.value && rightPanelTab.value === 'files',
                  'webui-shell-resizing': statusPanelResizing.value
                }
              ],
              style: statusPanelOpen.value ? { '--webui-right-panel-width': `${statusPanelWidth.value}px` } : undefined
            },
            [
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
              h(
                'section',
                {
                  class: ['conversation-list', { 'conversation-list-open': mobileSidebarOpen.value }],
                  'aria-label': text('newConversation')
                },
                [
                  h('header', { class: 'panel-header' }, [
                    h('img', { class: 'brand-logo', src: webUiLogoPath, alt: 'Cherry Studio' }),
                    h('div', [h('p', { class: 'eyebrow' }, 'Cherry Studio'), h('h1', text('webui'))]),
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
                                    class: [
                                      'language-picker-option',
                                      { 'language-picker-option-selected': language.value === item.id }
                                    ],
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
                      h(
                        'button',
                        {
                          class: ['panel-icon-button', 'theme-toggle-button', `theme-toggle-button-${themeMode.value}`],
                          type: 'button',
                          title: themeToggleLabel.value,
                          'aria-label': themeToggleLabel.value,
                          onClick: toggleThemeMode
                        },
                        renderThemeIcon(themeMode.value)
                      )
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
                      ? h(
                          'p',
                          { class: ['empty-copy', `empty-copy-${conversationLoadState.value}`] },
                          conversationLoadMessage.value
                        )
                      : undefined
                  ]),
                  h(
                    'nav',
                    { class: 'conversation-nav', 'aria-label': text('desktopSession') },
                    conversations.value.map((conversation) =>
                      h(
                        'div',
                        {
                          key: conversation.id,
                          class: [
                            'conversation-item-wrap',
                            { 'conversation-item-wrap-selected': conversation.id === selectedConversationId.value }
                          ]
                        },
                        [
                          editingConversationId.value === conversation.id
                            ? h('div', { class: ['conversation-item', 'conversation-item-editing'] }, [
                                h('input', {
                                  class: 'conversation-title-input',
                                  value: editingConversationTitle.value,
                                  autofocus: true,
                                  onInput: (event: Event) => {
                                    editingConversationTitle.value = (event.target as HTMLInputElement).value
                                  },
                                  onKeydown: (event: KeyboardEvent) => {
                                    if (event.key === 'Enter') {
                                      event.preventDefault()
                                      void saveConversationTitle()
                                    }
                                    if (event.key === 'Escape') {
                                      event.preventDefault()
                                      closeEditConversation()
                                    }
                                  }
                                }),
                                h('span', { class: 'conversation-meta' }, [
                                  `${conversationAgentName(conversation.agentId)} · `,
                                  new Date(conversation.updatedAt).toLocaleString()
                                ])
                              ])
                            : h(
                                'button',
                                {
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
                              ),
                          h('div', { class: 'conversation-actions' }, [
                            h(
                              'button',
                              {
                                class: 'conversation-action-button',
                                type: 'button',
                                title: text('editTitle'),
                                'aria-label': text('editTitle'),
                                'aria-expanded': openConversationMenuId.value === conversation.id,
                                disabled: conversationActionState.value === 'deleting',
                                onClick: () => toggleConversationMenu(conversation.id)
                              },
                              conversationActionState.value === 'generating' &&
                                conversationActionId.value === conversation.id
                                ? h('span', { class: 'mini-spinner', 'aria-hidden': 'true' })
                                : renderActionIcon('more')
                            ),
                            openConversationMenuId.value === conversation.id
                              ? h('div', { class: 'conversation-action-menu', role: 'menu' }, [
                                  h(
                                    'button',
                                    {
                                      class: 'conversation-action-menu-item',
                                      type: 'button',
                                      role: 'menuitem',
                                      disabled: conversationActionState.value === 'deleting',
                                      onClick: () => openEditConversation(conversation)
                                    },
                                    [renderActionIcon('edit'), h('span', text('editTitle'))]
                                  ),
                                  h(
                                    'button',
                                    {
                                      class: 'conversation-action-menu-item',
                                      type: 'button',
                                      role: 'menuitem',
                                      disabled:
                                        conversationActionState.value === 'generating' &&
                                        conversationActionId.value === conversation.id,
                                      onClick: () => void generateConversationTitle(conversation.id)
                                    },
                                    [renderActionIcon('sparkles'), h('span', text('generateTopicName'))]
                                  ),
                                  h(
                                    'button',
                                    {
                                      class: ['conversation-action-menu-item', 'conversation-action-menu-danger'],
                                      type: 'button',
                                      role: 'menuitem',
                                      disabled: activeRunConversationId.value === conversation.id,
                                      onClick: () => openDeleteConversation(conversation.id)
                                    },
                                    [renderActionIcon('trash'), h('span', text('deleteConversation'))]
                                  )
                                ])
                              : undefined
                          ])
                        ]
                      )
                    )
                  ),
                  conversationActionError.value
                    ? h(
                        'p',
                        { class: 'composer-error conversation-action-error', role: 'alert' },
                        conversationActionError.value
                      )
                    : undefined
                ]
              ),
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
                      'button',
                      {
                        class: [
                          'agent-status-shortcut',
                          'workspace-files-shortcut',
                          { 'agent-status-shortcut-active': statusPanelOpen.value && rightPanelTab.value === 'files' }
                        ],
                        type: 'button',
                        disabled: !selectedConversation.value,
                        title: text('files'),
                        'aria-label': text('files'),
                        'aria-expanded': statusPanelOpen.value && rightPanelTab.value === 'files',
                        onClick: () => {
                          if (statusPanelOpen.value && rightPanelTab.value === 'files') {
                            statusPanelOpen.value = false
                            return
                          }
                          openFilesPanel()
                        }
                      },
                      renderActionIcon('folder')
                    ),
                    h(
                      'div',
                      {
                        class: 'agent-status-shortcut-wrap',
                        onMouseenter: scheduleStatusPreviewOpen,
                        onMouseleave: scheduleStatusPreviewClose,
                        onFocusin: scheduleStatusPreviewOpen,
                        onFocusout: (event: FocusEvent) => {
                          if (!(event.currentTarget as HTMLElement).contains(event.relatedTarget as Node | null)) {
                            scheduleStatusPreviewClose()
                          }
                        }
                      },
                      [
                        h(
                          'button',
                          {
                            class: [
                              'agent-status-shortcut',
                              'agent-status-context-shortcut',
                              { 'agent-status-shortcut-active': statusPanelOpen.value }
                            ],
                            type: 'button',
                            disabled: !selectedConversation.value,
                            title: `${text('status')} · ${contextUsageLabel.value}`,
                            'aria-label': text('status'),
                            'aria-expanded': statusPanelOpen.value,
                            onClick: toggleStatusPanel
                          },
                          [
                            renderContextOrb(),
                            incompleteTaskCount.value > 0
                              ? h('span', { class: 'agent-status-shortcut-badge' }, String(incompleteTaskCount.value))
                              : undefined
                          ]
                        ),
                        statusPreviewOpen.value && !statusPanelOpen.value
                          ? h(
                              'section',
                              { class: 'agent-status-hover-card', role: 'dialog', 'aria-label': text('status') },
                              renderAgentStatusBody(agentStatus.value, true)
                            )
                          : undefined
                      ]
                    )
                  ])
                ]),
                h(
                  'div',
                  {
                    class: 'message-stack',
                    'aria-live': 'polite',
                    ref: messageStack,
                    onScroll: updateMessageScrollState
                  },
                  [
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
                            h('p', { class: 'message-role' }, messageAuthorName(message.role))
                          ]),
                          renderProcessDetails(message),
                          message.attachments?.length
                            ? h(
                                'div',
                                { class: 'message-attachments' },
                                message.attachments.map((attachment) =>
                                  h(
                                    'span',
                                    { class: 'message-attachment', title: attachment.mediaType },
                                    attachment.name
                                  )
                                )
                              )
                            : undefined,
                          message.content
                            ? h('div', {
                                class: 'markdown-content',
                                onClick: handleMarkdownContentClick,
                                innerHTML: renderMarkdown(message.content, { copyCodeLabel: text('copyCode') })
                              })
                            : message.toolCalls?.length
                              ? undefined
                              : h('span', { class: 'streaming-placeholder', 'aria-label': text('generating') }),
                          h('footer', { class: 'message-footer' }, [
                            h(
                              'time',
                              { class: 'message-time', datetime: message.createdAt },
                              new Date(message.createdAt).toLocaleString()
                            ),
                            renderMessageActions(message)
                          ])
                        ]
                      )
                    )
                  ]
                ),
                showScrollToBottom.value
                  ? h(
                      'button',
                      {
                        class: 'scroll-bottom-button',
                        type: 'button',
                        style: { bottom: `${composerHeight.value + (attachments.value.length ? 116 : 84)}px` },
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
                              h(
                                'span',
                                { class: 'attachment-chip-name', title: attachment.file.name },
                                attachment.file.name
                              ),
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
                      disabled:
                        !selectedConversation.value || activeRunConversationId.value === selectedConversationId.value,
                      value: composerText.value,
                      placeholder: selectedConversation.value ? text('sendPlaceholder') : text('selectFirst'),
                      rows: 3,
                      style: { height: `${composerHeight.value}px` },
                      onInput: (event: Event) => {
                        composerText.value = (event.target as HTMLTextAreaElement).value
                      },
                      onKeydown: (event: KeyboardEvent) => {
                        if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
                          event.preventDefault()
                          void submitMessage()
                        }
                      }
                    }),
                    h('div', {
                      class: 'composer-resize-handle',
                      role: 'separator',
                      tabindex: 0,
                      title: text('resizeComposer'),
                      'aria-label': text('resizeComposer'),
                      'aria-orientation': 'horizontal',
                      'aria-valuemin': composerMinHeight,
                      'aria-valuemax': composerMaxHeight,
                      'aria-valuenow': composerHeight.value,
                      onPointerdown: beginComposerResize,
                      onKeydown: handleComposerResizeKeydown,
                      onDblclick: () => {
                        composerHeight.value = composerDefaultHeight
                      }
                    }),
                    h(
                      'button',
                      {
                        class: 'composer-expand-control',
                        type: 'button',
                        title: text('resizeComposer'),
                        'aria-label': text('resizeComposer'),
                        'aria-pressed': composerHeight.value !== composerDefaultHeight,
                        onClick: toggleComposerHeight
                      },
                      renderActionIcon('resize', composerHeight.value !== composerDefaultHeight)
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
                            class: [
                              'composer-tool-button',
                              { 'composer-tool-button-active': reasoningEffort.value !== 'default' }
                            ],
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
                            disabled:
                              !selectedConversation.value ||
                              !models.value.length ||
                              modelUpdateState.value === 'updating',
                            title: selectedAgentName.value
                              ? `${selectedAgentName.value}: ${modelPickerLabel.value}`
                              : modelPickerLabel.value,
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
                          class: [
                            'send-button',
                            { 'send-button-is-stop': activeRunConversationId.value === selectedConversationId.value }
                          ],
                          type: 'button',
                          disabled:
                            !selectedConversation.value ||
                            (!composerText.value.trim() &&
                              attachments.value.length === 0 &&
                              activeRunConversationId.value !== selectedConversationId.value),
                          'aria-label':
                            activeRunConversationId.value === selectedConversationId.value
                              ? text('stop')
                              : text('send'),
                          title:
                            activeRunConversationId.value === selectedConversationId.value
                              ? text('stop')
                              : text('send'),
                          onClick: () => {
                            if (activeRunConversationId.value === selectedConversationId.value) {
                              void abortMessage()
                              return
                            }
                            void submitMessage()
                          }
                        },
                        renderActionIcon(
                          activeRunConversationId.value === selectedConversationId.value ? 'stop' : 'send'
                        )
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
                                class: [
                                  'reasoning-picker-option',
                                  { 'reasoning-picker-option-selected': option === reasoningEffort.value }
                                ],
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
                                (
                                  {
                                    default: 'reasoningDefault',
                                    none: 'reasoningNone',
                                    minimal: 'reasoningMinimal',
                                    low: 'reasoningLow',
                                    medium: 'reasoningMedium',
                                    high: 'reasoningHigh',
                                    xhigh: 'reasoningXhigh',
                                    auto: 'reasoningAuto'
                                  } as Record<string, TextKey>
                                )[option] ?? 'reasoningDefault'
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
                                  class: [
                                    'model-picker-option',
                                    { 'model-picker-option-selected': model.id === selectedAgent.value?.model }
                                  ],
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
                                command.description
                                  ? h('span', { class: 'slash-command-description' }, command.description)
                                  : undefined
                              ]
                            )
                          )
                        )
                      : undefined
                  ])
                ]),
                submitError.value ? h('p', { class: 'composer-error', role: 'alert' }, submitError.value) : undefined
              ]),
              statusPanelOpen.value
                ? h('button', {
                    class: 'agent-status-panel-backdrop',
                    type: 'button',
                    'aria-label': text('close'),
                    onClick: () => {
                      statusPanelOpen.value = false
                    }
                  })
                : undefined,
              statusPanelOpen.value
                ? h(
                    'aside',
                    {
                      class: 'status-panel agent-status-panel',
                      'aria-label': text(rightPanelTab.value === 'help' ? 'help' : 'status')
                    },
                    [
                      h('div', {
                        class: 'status-panel-resize-handle',
                        role: 'separator',
                        'aria-orientation': 'vertical',
                        'aria-label': text('resizeComposer'),
                        onPointerdown: beginPanelResize
                      }),
                      h('header', { class: 'agent-status-panel-header' }, [
                        h('div', { class: 'agent-status-panel-tabs' }, [
                          h(
                            'button',
                            {
                              class: [
                                'agent-status-panel-tab',
                                { 'agent-status-panel-tab-active': rightPanelTab.value === 'status' }
                              ],
                              type: 'button',
                              onClick: () => {
                                rightPanelTab.value = 'status'
                                refreshComposerInfo()
                              }
                            },
                            [
                              renderActionIcon('activity'),
                              h('span', text('status')),
                              incompleteTaskCount.value > 0
                                ? h(
                                    'span',
                                    { class: 'agent-status-panel-tab-badge' },
                                    String(incompleteTaskCount.value)
                                  )
                                : undefined
                            ]
                          ),
                          h(
                            'button',
                            {
                              class: [
                                'agent-status-panel-tab',
                                { 'agent-status-panel-tab-active': rightPanelTab.value === 'files' }
                              ],
                              type: 'button',
                              onClick: openFilesPanel
                            },
                            [renderActionIcon('folder'), h('span', text('files'))]
                          ),
                          h(
                            'button',
                            {
                              class: [
                                'agent-status-panel-tab',
                                { 'agent-status-panel-tab-active': rightPanelTab.value === 'speech' }
                              ],
                              type: 'button',
                              onClick: openSpeechPanel
                            },
                            [renderActionIcon('volume'), h('span', text('speechPanel'))]
                          ),
                          h(
                            'button',
                            {
                              class: [
                                'agent-status-panel-tab',
                                { 'agent-status-panel-tab-active': rightPanelTab.value === 'help' }
                              ],
                              type: 'button',
                              onClick: () => {
                                clearStatusPreviewTimers()
                                statusPreviewOpen.value = false
                                statusPanelOpen.value = true
                                rightPanelTab.value = 'help'
                              }
                            },
                            [renderActionIcon('help'), h('span', text('help'))]
                          )
                        ]),
                        h(
                          'button',
                          {
                            class: 'agent-status-panel-close',
                            type: 'button',
                            title: text('close'),
                            'aria-label': text('close'),
                            onClick: () => {
                              statusPanelOpen.value = false
                            }
                          },
                          renderActionIcon('close')
                        )
                      ]),
                      rightPanelTab.value === 'files'
                        ? renderWorkspaceFilesPanel()
                        : rightPanelTab.value === 'speech'
                          ? h('div', { class: 'agent-status-panel-scroll' }, [renderSpeechPanel()])
                          : rightPanelTab.value === 'help'
                            ? h('div', { class: 'agent-status-panel-scroll help-panel' }, [
                                h('details', { class: 'help-guide-tree' }, [
                                  h('summary', [renderActionIcon('help'), h('span', text('helpGuide'))]),
                                  h('ul', [
                                    h('li', text('helpGuideIntro')),
                                    h('li', text('helpGuideSessions')),
                                    h('li', text('helpGuideFiles')),
                                    h('li', text('helpGuideSpeech'))
                                  ])
                                ]),
                                h('section', { class: 'help-runtime-section' }, [
                                  h('h3', text('runtimeDetails')),
                                  h('div', { class: 'status-runtime-body' }, [
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
                                  ])
                                ])
                              ])
                            : h(
                                'div',
                                { class: 'agent-status-panel-scroll' },
                                renderAgentStatusBody(agentStatus.value, false)
                              )
                    ]
                  )
                : undefined,
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
                          h(
                            'option',
                            { key: agent.id, value: agent.id },
                            `${agent.name} · ${agent.modelName ?? agent.model}`
                          )
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
                : undefined,
              deleteMessageId.value
                ? h('div', { class: 'modal-backdrop', onClick: closeDeleteMessage }, [
                    h(
                      'section',
                      {
                        class: 'new-conversation-dialog delete-message-dialog',
                        role: 'dialog',
                        'aria-modal': 'true',
                        'aria-labelledby': 'delete-message-title',
                        'aria-describedby': 'delete-message-description',
                        onClick: (event: MouseEvent) => event.stopPropagation(),
                        onKeydown: (event: KeyboardEvent) => {
                          if (event.key === 'Escape') closeDeleteMessage()
                        }
                      },
                      [
                        h('header', { class: 'dialog-header' }, [
                          h('h2', { id: 'delete-message-title' }, text('deleteMessage')),
                          h(
                            'button',
                            {
                              class: 'icon-button',
                              type: 'button',
                              disabled: messageDeleteState.value === 'deleting',
                              title: text('close'),
                              'aria-label': text('close'),
                              onClick: closeDeleteMessage
                            },
                            renderActionIcon('close')
                          )
                        ]),
                        h(
                          'p',
                          { id: 'delete-message-description', class: 'dialog-description' },
                          text('deleteMessageDescription')
                        ),
                        messageDeleteError.value
                          ? h('p', { class: 'composer-error', role: 'alert' }, messageDeleteError.value)
                          : undefined,
                        h('footer', { class: 'dialog-actions' }, [
                          h(
                            'button',
                            {
                              class: 'secondary-button',
                              type: 'button',
                              disabled: messageDeleteState.value === 'deleting',
                              autofocus: true,
                              onClick: closeDeleteMessage
                            },
                            text('cancel')
                          ),
                          h(
                            'button',
                            {
                              class: 'primary-button danger-button',
                              type: 'button',
                              disabled:
                                messageDeleteState.value === 'deleting' ||
                                activeRunConversationId.value === selectedConversationId.value,
                              onClick: () => void confirmDeleteMessage()
                            },
                            messageDeleteState.value === 'deleting' ? text('deleting') : text('delete')
                          )
                        ])
                      ]
                    )
                  ])
                : undefined,
              deleteConversationId.value
                ? h('div', { class: 'modal-backdrop', onClick: closeDeleteConversation }, [
                    h(
                      'section',
                      {
                        class: 'new-conversation-dialog delete-message-dialog',
                        role: 'dialog',
                        'aria-modal': 'true',
                        'aria-labelledby': 'delete-conversation-title',
                        'aria-describedby': 'delete-conversation-description',
                        onClick: (event: MouseEvent) => event.stopPropagation(),
                        onKeydown: (event: KeyboardEvent) => {
                          if (event.key === 'Escape') closeDeleteConversation()
                        }
                      },
                      [
                        h('header', { class: 'dialog-header' }, [
                          h('h2', { id: 'delete-conversation-title' }, text('deleteConversation')),
                          h(
                            'button',
                            {
                              class: 'icon-button',
                              type: 'button',
                              disabled: conversationActionState.value === 'deleting',
                              title: text('close'),
                              'aria-label': text('close'),
                              onClick: closeDeleteConversation
                            },
                            renderActionIcon('close')
                          )
                        ]),
                        h('p', { id: 'delete-conversation-description', class: 'dialog-description' }, [
                          text('deleteConversationDescription'),
                          deletingConversation.value ? h('strong', `\n${deletingConversation.value.title}`) : undefined
                        ]),
                        conversationActionError.value
                          ? h('p', { class: 'composer-error', role: 'alert' }, conversationActionError.value)
                          : undefined,
                        h('footer', { class: 'dialog-actions' }, [
                          h(
                            'button',
                            {
                              class: 'secondary-button',
                              type: 'button',
                              disabled: conversationActionState.value === 'deleting',
                              autofocus: true,
                              onClick: closeDeleteConversation
                            },
                            text('cancel')
                          ),
                          h(
                            'button',
                            {
                              class: 'primary-button danger-button',
                              type: 'button',
                              disabled: conversationActionState.value === 'deleting',
                              onClick: () => void confirmDeleteConversation()
                            },
                            conversationActionState.value === 'deleting' ? text('deleting') : text('delete')
                          )
                        ])
                      ]
                    )
                  ])
                : undefined
            ]
          )
  }
})

const style = document.createElement('style')
style.textContent = `
  :root {
    --webui-divider: #e5e7eb;
    --webui-scrollbar-thumb: #cbd5e1;
    --webui-scrollbar-thumb-hover: #94a3b8;
    --webui-scrollbar-track: transparent;
    --webui-code-bg: #f8fafc;
    --webui-code-fg: #24292f;
    --webui-code-border: #e5e7eb;
    --webui-code-comment: #6a737d;
    --webui-code-keyword: #a626a4;
    --webui-code-entity: #4078f2;
    --webui-code-literal: #986801;
    --webui-code-string: #50a14f;
    --webui-code-variable: #e45649;
    --webui-code-meta: #383a42;
    --webui-code-built-in: #c18401;
    --webui-code-addition: #22863a;
    --webui-code-addition-bg: #f0fff4;
    --webui-code-deletion: #b31d28;
    --webui-code-deletion-bg: #ffeef0;
    --webui-inline-code-bg: #fff1f2;
    --webui-inline-code-fg: #9f1239;
    color: #1f2937;
    background: #f6f7fb;
    font-family:
      Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  }

  * {
    box-sizing: border-box;
    scrollbar-color: var(--webui-scrollbar-thumb) var(--webui-scrollbar-track);
    scrollbar-width: thin;
  }

  *::-webkit-scrollbar {
    width: 10px;
    height: 10px;
  }

  *::-webkit-scrollbar-track {
    background: var(--webui-scrollbar-track);
  }

  *::-webkit-scrollbar-thumb {
    min-height: 44px;
    background: var(--webui-scrollbar-thumb);
    background-clip: padding-box;
    border: 3px solid transparent;
    border-radius: 999px;
  }

  *::-webkit-scrollbar-thumb:hover {
    background: var(--webui-scrollbar-thumb-hover);
    background-clip: padding-box;
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
    grid-template-columns: minmax(240px, 280px) minmax(0, 1fr);
    height: 100vh;
    height: 100dvh;
    overflow: hidden;
  }

  .webui-shell-status-open {
    grid-template-columns: minmax(240px, 280px) minmax(0, 1fr) minmax(300px, var(--webui-right-panel-width, 380px));
  }

  .webui-shell-files-open {
    grid-template-columns: minmax(240px, 280px) minmax(0, 1fr) minmax(320px, var(--webui-right-panel-width, 420px));
  }

  .webui-shell-resizing {
    user-select: none;
    cursor: col-resize;
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
    gap: 6px;
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

  .theme-toggle-button svg {
    display: block;
    width: 18px;
    height: 18px;
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

  .icon-button svg {
    display: block;
    width: 18px;
    height: 18px;
    margin: auto;
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

  .conversation-item-wrap {
    position: relative;
    display: grid;
  }

  .conversation-item {
    display: grid;
    width: 100%;
    min-height: 58px;
    padding: 10px 44px 10px 12px;
    text-align: left;
    background: #f9fafb;
    border: 1px solid #e5e7eb;
    border-radius: 8px;
    cursor: pointer;
  }

  .conversation-item:hover,
  .conversation-item-selected,
  .conversation-item-wrap:focus-within .conversation-item {
    background: #eef2ff;
    border-color: #a5b4fc;
  }

  .conversation-actions {
    position: absolute;
    top: 8px;
    right: 8px;
    display: flex;
    gap: 2px;
    opacity: 0;
    transition: opacity 140ms ease;
  }

  .conversation-item-wrap:hover .conversation-actions,
  .conversation-item-wrap:focus-within .conversation-actions,
  .conversation-item-wrap-selected .conversation-actions {
    opacity: 1;
  }

  .conversation-action-button {
    display: grid;
    width: 24px;
    height: 24px;
    padding: 0;
    place-items: center;
    color: #64748b;
    background: rgb(255 255 255 / 78%);
    border: 1px solid #dbe1ea;
    border-radius: 6px;
    cursor: pointer;
  }

  .conversation-action-button:hover,
  .conversation-action-button:focus-visible {
    color: #111827;
    background: #ffffff;
    outline: 0;
  }

  .conversation-action-danger:hover,
  .conversation-action-danger:focus-visible {
    color: #b42318;
  }

  .conversation-action-button svg {
    width: 14px;
    height: 14px;
  }

  .conversation-action-menu {
    position: absolute;
    z-index: 30;
    top: calc(100% + 6px);
    right: 0;
    display: grid;
    min-width: 148px;
    padding: 4px;
    background: #ffffff;
    border: 1px solid #dbe1ea;
    border-radius: 8px;
    box-shadow: 0 14px 32px rgb(15 23 42 / 16%);
  }

  .conversation-action-menu-item {
    display: flex;
    min-height: 32px;
    gap: 8px;
    align-items: center;
    padding: 0 8px;
    color: #334155;
    font-size: 12px;
    text-align: left;
    background: transparent;
    border: 0;
    border-radius: 6px;
    cursor: pointer;
  }

  .conversation-action-menu-item:hover,
  .conversation-action-menu-item:focus-visible {
    color: #111827;
    background: #f1f5f9;
    outline: 0;
  }

  .conversation-action-menu-danger:hover,
  .conversation-action-menu-danger:focus-visible {
    color: #b42318;
  }

  .conversation-action-menu-item svg {
    width: 14px;
    height: 14px;
  }

  .conversation-title-input {
    min-width: 0;
    width: 100%;
    height: 24px;
    padding: 0 6px;
    color: #111827;
    font-size: 13px;
    font-weight: 600;
    background: #ffffff;
    border: 1px solid #a5b4fc;
    border-radius: 5px;
    outline: 0;
  }

  .conversation-action-error {
    margin: 8px 2px 0;
    font-size: 12px;
  }

  .mini-spinner {
    width: 12px;
    height: 12px;
    border: 2px solid currentColor;
    border-top-color: transparent;
    border-radius: 999px;
    animation: spin 700ms linear infinite;
  }

  .conversation-title {
    overflow: hidden;
    color: #111827;
    font-size: 14px;
    font-weight: 600;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
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
    left: 50%;
    bottom: 148px;
    transform: translateX(-50%);
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
    width: 32px;
    height: 32px;
    flex: 0 0 auto;
    place-items: center;
    color: #334155;
    font-size: 10px;
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

  .agent-status-shortcut-wrap {
    position: relative;
    z-index: 12;
    display: grid;
    place-items: center;
  }

  .agent-status-shortcut {
    position: relative;
    display: grid;
    width: 36px;
    height: 36px;
    padding: 0;
    place-items: center;
    color: #64748b;
    background: transparent;
    border: 1px solid transparent;
    border-radius: 7px;
    cursor: pointer;
    transition: color 140ms ease, background 140ms ease, border-color 140ms ease;
  }

  .agent-status-context-shortcut {
    display: flex;
    width: 44px;
    height: 36px;
    gap: 2px;
    justify-content: center;
    border-radius: 18px;
  }

  .agent-status-context-shortcut .context-orb {
    width: 32px;
    height: 32px;
  }

  .agent-status-shortcut:hover,
  .agent-status-shortcut:focus-visible,
  .agent-status-shortcut-active {
    color: #111827;
    background: #ffffff;
    border-color: #dbe1ea;
    outline: 0;
  }

  .agent-status-shortcut-badge,
  .agent-status-panel-tab-badge {
    display: grid;
    min-width: 16px;
    height: 16px;
    padding: 0 4px;
    place-items: center;
    color: #334155;
    font-size: 10px;
    font-weight: 700;
    line-height: 1;
    background: #e2e8f0;
    border-radius: 999px;
  }

  .agent-status-shortcut-badge {
    position: absolute;
    top: -4px;
    right: -5px;
    box-shadow: 0 0 0 2px #f6f7fb;
  }

  .agent-status-context-shortcut .agent-status-shortcut-badge {
    top: -2px;
    right: -2px;
    z-index: 1;
    box-shadow: 0 0 0 2px #f6f7fb;
  }

  .agent-status-hover-card {
    position: absolute;
    z-index: 40;
    top: calc(100% + 8px);
    right: 0;
    width: 320px;
    max-height: min(70dvh, 560px);
    padding: 12px;
    overflow: auto;
    color: #1f2937;
    text-align: left;
    background: #ffffff;
    border: 1px solid #dbe1ea;
    border-radius: 10px;
    box-shadow: 0 18px 44px rgb(15 23 42 / 16%);
    animation: agent-status-card-in 140ms ease-out;
  }

  @keyframes agent-status-card-in {
    from {
      opacity: 0;
      transform: translateY(-4px) scale(0.985);
    }
    to {
      opacity: 1;
      transform: translateY(0) scale(1);
    }
  }

  .agent-status-panel-backdrop {
    display: none;
  }

  .agent-status-panel {
    position: relative;
    display: grid;
    grid-template-rows: auto minmax(0, 1fr);
    padding: 0;
    overflow: hidden;
  }

  .status-panel-resize-handle {
    position: absolute;
    top: 0;
    left: -4px;
    z-index: 5;
    width: 8px;
    height: 100%;
    cursor: col-resize;
  }

  .status-panel-resize-handle::after {
    position: absolute;
    top: 50%;
    left: 3px;
    width: 2px;
    height: 42px;
    background: transparent;
    border-radius: 999px;
    transform: translateY(-50%);
    content: '';
  }

  .status-panel-resize-handle:hover::after,
  .status-panel-resize-handle:focus-visible::after {
    background: #cbd5e1;
  }

  .agent-status-panel-header {
    display: flex;
    min-height: 54px;
    gap: 10px;
    align-items: center;
    justify-content: space-between;
    padding: 8px 10px 8px 12px;
    border-bottom: 1px solid var(--webui-divider);
  }

  .agent-status-panel-tabs {
    display: flex;
    min-width: 0;
    gap: 4px;
    align-items: center;
  }

  .agent-status-panel-tab {
    display: flex;
    min-width: 0;
    height: 34px;
    gap: 7px;
    align-items: center;
    padding: 0 10px;
    color: #64748b;
    font-size: 13px;
    background: transparent;
    border: 0;
    border-radius: 6px;
    cursor: pointer;
  }

  .agent-status-panel-tab-active {
    color: #111827;
    background: #f1f5f9;
  }

  .agent-status-panel-close {
    display: grid;
    width: 32px;
    height: 32px;
    flex: 0 0 auto;
    padding: 0;
    place-items: center;
    color: #64748b;
    background: transparent;
    border: 0;
    border-radius: 6px;
    cursor: pointer;
  }

  .agent-status-panel-close:hover,
  .agent-status-panel-close:focus-visible {
    color: #111827;
    background: #f1f5f9;
    outline: 0;
  }

  .agent-status-panel-scroll {
    display: flex;
    flex-direction: column;
    min-height: 0;
    gap: 16px;
    padding: 14px;
    overflow-y: auto;
  }

  .workspace-files-panel,
  .workspace-files-browser,
  .workspace-file-preview {
    min-width: 0;
    min-height: 0;
    height: 100%;
  }

  .workspace-files-browser {
    display: grid;
    grid-template-rows: auto auto minmax(0, 1fr);
  }

  .workspace-files-toolbar {
    display: flex;
    gap: 6px;
    align-items: center;
    padding: 9px 10px;
    border-bottom: 1px solid var(--webui-divider);
  }

  .workspace-file-path-wrap {
    display: flex;
    min-width: 0;
    flex: 1.15;
    gap: 6px;
    align-items: center;
  }

  .workspace-file-path-input,
  .workspace-file-search {
    width: 100%;
    height: 32px;
    color: #334155;
    font-size: 12px;
    background: #f8fafc;
    border: 1px solid #dbe1ea;
    border-radius: 7px;
    outline: 0;
  }

  .workspace-file-path-input {
    min-width: 0;
    padding: 0 9px;
  }

  .workspace-file-search {
    padding: 0 9px 0 28px;
  }

  .workspace-file-path-input:focus,
  .workspace-file-search:focus {
    background: #ffffff;
    border-color: #94a3b8;
  }

  .workspace-file-search-wrap {
    position: relative;
    min-width: 0;
    flex: 1;
  }

  .workspace-file-search-icon {
    position: absolute;
    top: 50%;
    left: 9px;
    color: #94a3b8;
    font-size: 16px;
    line-height: 1;
    transform: translateY(-52%);
    pointer-events: none;
  }

  .workspace-file-search-icon svg {
    width: 14px;
    height: 14px;
  }

  .workspace-files-refresh,
  .workspace-file-preview-back {
    display: grid;
    width: 32px;
    height: 32px;
    flex: 0 0 auto;
    padding: 0;
    place-items: center;
    color: #64748b;
    background: transparent;
    border: 0;
    border-radius: 6px;
    cursor: pointer;
  }

  .workspace-files-refresh:hover,
  .workspace-files-refresh:focus-visible,
  .workspace-file-preview-back:hover,
  .workspace-file-preview-back:focus-visible {
    color: #111827;
    background: #f1f5f9;
    outline: 0;
  }

  .workspace-files-root-label {
    display: flex;
    min-width: 0;
    height: 34px;
    gap: 7px;
    align-items: center;
    padding: 0 12px;
    color: #64748b;
    font-size: 11px;
    border-bottom: 1px solid var(--webui-divider);
  }

  .workspace-files-root-label svg {
    width: 15px;
    height: 15px;
  }

  .workspace-files-root-label span {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .workspace-file-tree {
    min-height: 0;
    padding: 6px;
    overflow: auto;
  }

  .workspace-file-row {
    display: flex;
    width: 100%;
    min-width: 0;
    height: 29px;
    gap: 5px;
    align-items: center;
    padding: 0 7px 0 calc(6px + var(--workspace-file-depth) * 13px);
    color: #64748b;
    font-size: 12px;
    text-align: left;
    background: transparent;
    border: 0;
    border-radius: 5px;
    cursor: pointer;
  }

  .workspace-file-row:hover,
  .workspace-file-row:focus-visible,
  .workspace-file-row-selected {
    color: #1f2937;
    background: #f1f5f9;
    outline: 0;
  }

  .workspace-file-chevron {
    display: grid;
    width: 11px;
    flex: 0 0 auto;
    place-items: center;
    color: #94a3b8;
    font-size: 18px;
    line-height: 1;
    transform: rotate(0deg);
    transition: transform 120ms ease;
  }

  .workspace-file-chevron-expanded {
    transform: rotate(90deg);
  }

  .workspace-file-chevron-spacer {
    visibility: hidden;
  }

  .workspace-file-kind-icon {
    display: grid;
    width: 16px;
    height: 18px;
    flex: 0 0 auto;
    place-items: center;
  }

  .workspace-file-kind-icon svg {
    width: 15px;
    height: 15px;
  }

  .workspace-file-kind-folder {
    color: #64748b;
  }

  .workspace-file-kind-file {
    color: #94a3b8;
  }

  .workspace-file-name {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .workspace-files-state {
    margin: 0;
    padding: 18px 10px;
    color: #94a3b8;
    font-size: 12px;
    line-height: 1.55;
    text-align: center;
  }

  .workspace-files-state-error {
    color: #dc2626;
  }

  .workspace-file-preview {
    display: grid;
    grid-template-rows: auto minmax(0, 1fr);
    background: #ffffff;
  }

  .workspace-file-preview-header {
    display: flex;
    height: 44px;
    gap: 7px;
    align-items: center;
    padding: 6px 10px;
    border-bottom: 1px solid var(--webui-divider);
  }

  .workspace-file-preview-title {
    min-width: 0;
    overflow: hidden;
    color: #334155;
    font-size: 12px;
    font-weight: 600;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .workspace-file-preview-content {
    min-width: 0;
    min-height: 0;
    overflow: auto;
  }

  .workspace-file-preview-loading,
  .workspace-file-preview-error,
  .workspace-file-preview-binary {
    display: grid;
    place-items: center;
  }

  .workspace-image-preview {
    display: block;
    width: 100%;
    height: 100%;
    padding: 14px;
    object-fit: contain;
  }

  .workspace-file-preview-pdf {
    overflow: hidden;
  }

  .workspace-file-preview-docx {
    overflow: hidden;
  }

  .workspace-file-preview-pptx {
    overflow: hidden;
  }

  .workspace-pdf-preview {
    display: block;
    width: 100%;
    height: 100%;
    background: #ffffff;
    border: 0;
  }

  .workspace-docx-preview-scroll {
    width: 100%;
    height: 100%;
    padding: 14px;
    overflow: auto;
    background: #e2e8f0;
  }

  .workspace-docx-preview-style {
    display: none;
  }

  .workspace-docx-preview {
    width: max-content;
    min-width: 100%;
    color: #111827;
    transform-origin: top left;
    zoom: 0.48;
  }

  .workspace-docx-preview .docx-preview-wrapper {
    padding: 0 !important;
    background: transparent !important;
  }

  .workspace-docx-preview section.docx-preview {
    margin: 0 auto 18px !important;
    box-shadow: 0 10px 30px rgb(15 23 42 / 16%);
  }

  .workspace-pptx-preview-stage {
    position: relative;
    width: 100%;
    height: 100%;
    padding: 14px;
    overflow: auto;
    background: #e2e8f0;
    outline: 0;
  }

  .workspace-pptx-preview-stage:focus-visible {
    box-shadow: inset 0 0 0 2px rgb(37 99 235 / 40%);
  }

  .workspace-pptx-preview-loading {
    position: absolute;
    z-index: 2;
    top: 50%;
    left: 50%;
    margin: 0;
    padding: 8px 12px;
    color: #475569;
    font-size: 12px;
    background: #ffffff;
    border: 1px solid #cbd5e1;
    border-radius: 8px;
    box-shadow: 0 8px 24px rgb(15 23 42 / 12%);
    transform: translate(-50%, -50%);
  }

  .workspace-pptx-viewer {
    width: 100%;
    min-height: 100%;
  }

  .workspace-markdown-preview {
    padding: 16px;
    font-size: 13px;
  }

  .workspace-code-preview {
    min-width: 100%;
    min-height: 100%;
    margin: 0;
    padding: 14px;
    color: var(--webui-code-fg);
    font-family: "Cascadia Code", "SFMono-Regular", Consolas, monospace;
    font-size: 11px;
    line-height: 1.65;
    background: var(--webui-code-bg);
    white-space: pre;
    tab-size: 2;
  }

  .workspace-code-preview code {
    font: inherit;
  }

  .agent-status-section {
    display: grid;
    gap: 8px;
    margin: 0;
  }

  .agent-status-section:not(.agent-status-section-compact) {
    padding: 10px;
    background: #f8fafc;
    border: 1px solid #e5e7eb;
    border-radius: 8px;
  }

  .agent-status-section-compact + .agent-status-section-compact {
    padding-top: 10px;
    border-top: 1px solid #e5e7eb;
  }

  .agent-status-section h3 {
    margin: 0;
    color: #1f2937;
    font-size: 12px;
    font-weight: 600;
  }

  .agent-status-section-heading {
    display: flex;
    gap: 8px;
    align-items: center;
    justify-content: space-between;
  }

  .agent-status-section-heading-icon {
    justify-content: flex-start;
    color: #64748b;
  }

  .agent-status-count-badge {
    padding: 2px 6px;
    color: #64748b;
    font-size: 10px;
    font-variant-numeric: tabular-nums;
    border: 1px solid #dbe1ea;
    border-radius: 999px;
  }

  .agent-status-list {
    display: grid;
    gap: 6px;
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .agent-status-item {
    display: flex;
    min-width: 0;
    gap: 8px;
    align-items: flex-start;
    padding: 7px 8px;
    background: #ffffff;
    border: 1px solid #e5e7eb;
    border-radius: 6px;
  }

  .agent-status-section-compact .agent-status-item {
    padding: 2px 0;
    background: transparent;
    border: 0;
  }

  .agent-status-item-icon {
    display: grid;
    width: 16px;
    height: 20px;
    flex: 0 0 auto;
    place-items: center;
    color: #94a3b8;
  }

  .agent-status-item-icon-in_progress {
    color: #3b82f6;
  }

  .agent-status-item-icon-in_progress svg {
    animation: agent-status-spin 1.1s linear infinite;
  }

  .agent-status-item-icon-completed {
    color: #16a34a;
  }

  .agent-status-item-icon-error {
    color: #dc2626;
  }

  .agent-status-item-icon-artifact {
    color: #64748b;
  }

  @keyframes agent-status-spin {
    to { transform: rotate(360deg); }
  }

  .agent-status-item-copy {
    display: grid;
    min-width: 0;
    flex: 1;
    gap: 2px;
  }

  .agent-status-item-title {
    min-width: 0;
    color: #334155;
    font-size: 12px;
    line-height: 1.55;
    overflow-wrap: anywhere;
  }

  .agent-status-item-title-completed {
    color: #94a3b8;
    text-decoration: line-through;
  }

  .agent-status-item-state {
    overflow: hidden;
    color: #94a3b8;
    font-size: 10px;
    line-height: 1.4;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .agent-artifact-item {
    width: 100%;
    font: inherit;
    text-align: left;
    cursor: pointer;
  }

  .context-usage-content {
    display: grid;
    gap: 8px;
  }

  .context-progress-track {
    height: 6px;
    overflow: hidden;
    background: #e2e8f0;
    border-radius: 999px;
  }

  .context-progress-value {
    display: block;
    height: 100%;
    background: #22c55e;
    border-radius: inherit;
    transition: width 180ms ease;
  }

  .context-progress-value-warning {
    background: #f59e0b;
  }

  .context-progress-value-critical {
    background: #ef4444;
  }

  .context-usage-meta {
    display: flex;
    gap: 12px;
    align-items: center;
    justify-content: space-between;
    color: #64748b;
    font-size: 10px;
  }

  .context-usage-meta span:last-child {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .context-category-list {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    gap: 5px 12px;
    margin: 0;
    padding-top: 8px;
    color: #64748b;
    font-size: 10px;
    border-top: 1px solid #e5e7eb;
  }

  .context-category-list dt {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .context-category-list dd {
    margin: 0;
    color: #334155;
    font-variant-numeric: tabular-nums;
  }

  .agent-status-empty {
    margin: 0;
    color: #94a3b8;
    font-size: 11px;
  }

  .status-runtime-details {
    margin-top: auto;
    padding-top: 12px;
    border-top: 1px solid var(--webui-divider);
  }

  .status-runtime-details > summary {
    display: flex;
    gap: 8px;
    align-items: center;
    justify-content: space-between;
    color: #64748b;
    font-size: 12px;
    cursor: pointer;
    list-style: none;
  }

  .status-runtime-details > summary::-webkit-details-marker {
    display: none;
  }

  .status-runtime-body {
    padding-top: 10px;
  }

  .help-panel {
    gap: 14px;
  }

  .help-guide-tree {
    padding: 10px 12px;
    background: #f8fafc;
    border: 1px solid var(--webui-divider);
    border-radius: 8px;
  }

  .help-guide-tree > summary {
    display: flex;
    gap: 8px;
    align-items: center;
    color: #334155;
    font-size: 13px;
    font-weight: 600;
    cursor: pointer;
    list-style: none;
  }

  .help-guide-tree > summary::-webkit-details-marker {
    display: none;
  }

  .help-guide-tree ul {
    display: grid;
    gap: 8px;
    margin: 10px 0 0;
    padding-left: 18px;
    color: #64748b;
    font-size: 12px;
    line-height: 1.5;
  }

  .help-runtime-section {
    padding-top: 12px;
    border-top: 1px solid var(--webui-divider);
  }

  .help-runtime-section h3 {
    margin: 0 0 2px;
    color: #334155;
    font-size: 13px;
  }

  .status-runtime-dot {
    width: 8px;
    height: 8px;
    background: #dc2626;
    border-radius: 999px;
  }

  .status-runtime-dot-connected {
    background: #16a34a;
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

  .message-footer {
    display: flex;
    gap: 10px;
    align-items: center;
    justify-content: space-between;
    margin-top: 10px;
  }

  .message-actions {
    display: flex;
    gap: 4px;
    align-items: center;
    opacity: 0;
    transition: opacity 140ms ease;
  }

  .message:hover .message-actions,
  .message:focus-within .message-actions {
    opacity: 1;
  }

  .message-action-wrap {
    position: relative;
    display: inline-grid;
    place-items: center;
  }

  .message-action-button,
  .message-action-chip {
    display: grid;
    height: 28px;
    padding: 0;
    place-items: center;
    color: currentColor;
    background: transparent;
    border: 0;
    border-radius: 6px;
    cursor: pointer;
    opacity: 0.62;
    transition: background 140ms ease, color 140ms ease, opacity 140ms ease;
  }

  .message-action-button {
    width: 28px;
  }

  .message-action-chip {
    min-width: 34px;
    padding: 0 7px;
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 0.04em;
  }

  .message-action-button svg {
    display: block;
    width: 15px;
    height: 15px;
    fill: none;
    stroke: currentColor;
    stroke-linecap: round;
    stroke-linejoin: round;
    stroke-width: 2;
  }

  .message-action-button:hover,
  .message-action-button:focus-visible,
  .message-action-chip:hover,
  .message-action-chip:focus-visible {
    background: rgb(15 23 42 / 8%);
    outline: 0;
    opacity: 1;
  }

  .message-action-button:disabled {
    cursor: not-allowed;
    opacity: 0.32;
  }

  .message-action-button-unsupported:not(:disabled) {
    opacity: 0.38;
  }

  .message-action-button-active {
    color: #2563eb;
    opacity: 1;
  }

  .user-message .message-action-button:hover,
  .user-message .message-action-button:focus-visible,
  .user-message .message-action-chip:hover,
  .user-message .message-action-chip:focus-visible {
    background: rgb(255 255 255 / 16%);
  }

  .user-message .message-action-button-active {
    color: #bfdbfe;
  }

  .message-copy-hint {
    color: #64748b;
    font-size: 11px;
    white-space: nowrap;
  }


  .user-message .message-delete-button:hover,
  .user-message .message-delete-button:focus-visible {
    color: #fecaca;
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
    color: var(--webui-code-fg);
    background: var(--webui-code-bg);
    border: 1px solid var(--webui-code-border);
    border-radius: 6px;
  }

  .markdown-content pre code,
  .hljs {
    color: var(--webui-code-fg);
    background: transparent;
  }

  .markdown-content code:not(pre code) {
    padding: 2px 5px;
    color: var(--webui-inline-code-fg);
    background: var(--webui-inline-code-bg);
    border-radius: 4px;
  }

  .hljs-comment,
  .hljs-quote {
    color: var(--webui-code-comment);
    font-style: italic;
  }

  .hljs-keyword,
  .hljs-selector-tag,
  .hljs-doctag,
  .hljs-meta .hljs-keyword {
    color: var(--webui-code-keyword);
  }

  .hljs-title,
  .hljs-title.function_,
  .hljs-section,
  .hljs-selector-id {
    color: var(--webui-code-entity);
  }

  .hljs-attribute,
  .hljs-type,
  .hljs-literal,
  .hljs-number,
  .hljs-symbol,
  .hljs-bullet {
    color: var(--webui-code-literal);
  }

  .hljs-string,
  .hljs-regexp,
  .hljs-link {
    color: var(--webui-code-string);
  }

  .hljs-variable,
  .hljs-template-variable,
  .hljs-selector-class,
  .hljs-selector-attr,
  .hljs-selector-pseudo {
    color: var(--webui-code-variable);
  }

  .hljs-subst,
  .hljs-params {
    color: var(--webui-code-fg);
  }

  .hljs-meta,
  .hljs-built_in,
  .hljs-code,
  .hljs-formula {
    color: var(--webui-code-meta);
  }

  .hljs-built_in {
    color: var(--webui-code-built-in);
  }

  .hljs-addition {
    color: var(--webui-code-addition);
    background: var(--webui-code-addition-bg);
  }

  .hljs-deletion {
    color: var(--webui-code-deletion);
    background: var(--webui-code-deletion-bg);
  }

  .hljs-emphasis {
    font-style: italic;
  }

  .hljs-strong {
    font-weight: 700;
  }

  .markdown-code-block {
    position: relative;
    margin: 0.85em 0;
  }

  .markdown-code-block pre {
    margin: 0;
    padding-top: 34px;
  }

  .markdown-code-language {
    position: absolute;
    top: 8px;
    left: 10px;
    z-index: 1;
    color: #94a3b8;
    font-size: 11px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }

  .markdown-code-copy {
    position: absolute;
    top: 6px;
    right: 6px;
    z-index: 1;
    height: 24px;
    padding: 0 8px;
    color: #64748b;
    font-size: 11px;
    background: rgb(255 255 255 / 86%);
    border: 1px solid var(--webui-code-border);
    border-radius: 6px;
    cursor: pointer;
    opacity: 0;
    transition: opacity 140ms ease, background 140ms ease, color 140ms ease;
  }

  .markdown-code-block:hover .markdown-code-copy,
  .markdown-code-copy:focus-visible {
    opacity: 1;
  }

  .markdown-code-copy:hover,
  .markdown-code-copy:focus-visible {
    color: #111827;
    background: #ffffff;
    outline: 0;
  }

  .webui-file-link {
    display: inline-flex;
    max-width: 100%;
    padding: 0;
    color: #1d4ed8;
    font: inherit;
    text-align: left;
    overflow-wrap: anywhere;
    background: transparent;
    border: 0;
    cursor: pointer;
  }

  .webui-file-link:hover,
  .webui-file-link:focus-visible {
    text-decoration: underline;
    outline: 0;
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

  .process-block > summary {
    display: flex;
    gap: 8px;
    align-items: center;
    min-height: 36px;
    padding: 0 12px;
    cursor: pointer;
    list-style: none;
  }

  .process-block > summary::-webkit-details-marker {
    display: none;
  }

  .process-block[open] > summary {
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

  .process-section .reasoning-block {
    margin: 0;
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
    margin-top: 0;
    margin-bottom: 0;
  }

  .speech-notice {
    position: absolute;
    right: 50%;
    bottom: calc(100% + 8px);
    z-index: 20;
    width: max-content;
    max-width: min(240px, 72vw);
    padding: 7px 9px;
    color: #92400e;
    font-size: 12px;
    line-height: 1.35;
    text-align: center;
    background: #fffbeb;
    border: 1px solid #fde68a;
    border-radius: 8px;
    box-shadow: 0 10px 24px rgb(15 23 42 / 14%);
    transform: translateX(50%);
    pointer-events: none;
  }

  .speech-notice::after {
    position: absolute;
    right: 50%;
    bottom: -5px;
    width: 9px;
    height: 9px;
    background: #fffbeb;
    border-right: 1px solid #fde68a;
    border-bottom: 1px solid #fde68a;
    transform: translateX(50%) rotate(45deg);
    content: '';
  }

  .speech-settings-panel {
    display: grid;
    gap: 14px;
    padding: 4px 2px 12px;
  }

  .speech-settings-warning {
    margin: 0;
    padding: 10px 12px;
    color: #92400e;
    font-size: 13px;
    line-height: 1.45;
    background: #fffbeb;
    border: 1px solid #fde68a;
    border-radius: 8px;
  }

  .speech-setting-row {
    display: grid;
    gap: 8px;
    color: #334155;
    font-size: 13px;
  }

  .speech-setting-control {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 42px;
    gap: 10px;
    align-items: center;
  }

  .speech-setting-control input[type='range'] {
    width: 100%;
  }

  .speech-setting-value {
    color: #64748b;
    font-variant-numeric: tabular-nums;
    text-align: right;
  }

  .speech-setting-row-select {
    gap: 6px;
  }

  .speech-voice-select {
    width: 100%;
    min-height: 36px;
    padding: 0 10px;
    color: #0f172a;
    background: #ffffff;
    border: 1px solid #dbe1ea;
    border-radius: 8px;
  }

  .speech-settings-actions {
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
  }

  .speech-settings-button {
    min-height: 34px;
    padding: 0 12px;
    color: #ffffff;
    font-size: 13px;
    background: #111827;
    border: 0;
    border-radius: 8px;
    cursor: pointer;
  }

  .speech-settings-button-secondary {
    color: #1f2937;
    background: #ffffff;
    border: 1px solid #d1d5db;
  }

  .speech-settings-button:disabled {
    cursor: not-allowed;
    opacity: 0.55;
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
    min-height: 76px;
    padding: 14px 14px 8px;
    resize: none;
    border: 0;
    border-radius: 18px 18px 0 0;
    outline: 0;
  }

  .composer-resize-handle {
    position: absolute;
    z-index: 2;
    top: 0;
    right: 16px;
    left: 16px;
    height: 8px;
    cursor: row-resize;
    outline: 0;
    touch-action: none;
  }

  .composer-resize-handle::after {
    position: absolute;
    top: 0;
    right: 0;
    left: 0;
    height: 2px;
    content: '';
    background: rgb(37 99 235 / 20%);
    border-radius: 999px;
    opacity: 0;
    transition: opacity 160ms ease, background 160ms ease;
  }

  .composer-resize-handle:hover::after,
  .composer-resize-handle:focus-visible::after {
    background: rgb(37 99 235 / 35%);
    opacity: 1;
  }

  .composer-expand-control {
    position: absolute;
    z-index: 4;
    top: 4px;
    right: 4px;
    display: grid;
    width: 24px;
    height: 24px;
    padding: 0;
    place-items: center;
    color: #64748b;
    background: transparent;
    border: 0;
    border-radius: 50%;
    cursor: pointer;
    transition: color 180ms ease, background 180ms ease;
  }

  .composer-expand-control::before {
    position: absolute;
    top: -1px;
    right: -1px;
    width: 13px;
    height: 13px;
    content: '';
    border-top: 1.5px solid currentColor;
    border-right: 1.5px solid currentColor;
    border-radius: 0 16px 0 0;
    opacity: 0.7;
    transform-origin: top right;
    transition: opacity 180ms ease, transform 180ms ease;
  }

  .composer-expand-control svg {
    width: 12px;
    height: 12px;
    opacity: 0;
    transform: translate(6px, -6px) rotate(-8deg) scale(0.8);
    transition: opacity 180ms ease, transform 220ms ease;
  }

  .composer-expand-control:hover,
  .composer-expand-control:focus-visible {
    color: #0f172a;
    background: #f1f5f9;
    outline: 0;
  }

  .composer-expand-control:hover::before,
  .composer-expand-control:focus-visible::before {
    opacity: 0;
    transform: scale(0.5);
  }

  .composer-expand-control:hover svg,
  .composer-expand-control:focus-visible svg {
    opacity: 1;
    transform: translate(0, 0) rotate(0) scale(1);
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

  .dialog-description {
    margin: 14px 0 0;
    color: #64748b;
    font-size: 13px;
    line-height: 1.55;
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

  .danger-button {
    color: #ffffff;
    background: #dc2626;
  }

  .danger-button:hover,
  .danger-button:focus-visible {
    background: #b91c1c;
    outline: 0;
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

    .composer-expand-control {
      color: #cbd5e1;
    }

    .composer-tool-button:hover,
    .composer-tool-button:focus-visible {
      color: #ffffff;
      background: #334155;
    }

    .composer-expand-control:hover,
    .composer-expand-control:focus-visible {
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

    .agent-status-hover-card .agent-status-section h3,
    .agent-status-hover-card .agent-status-item-title,
    .agent-status-hover-card .agent-status-item-state,
    .agent-status-hover-card .agent-status-empty,
    .agent-status-hover-card .context-usage-meta,
    .agent-status-hover-card .context-category-list,
    .agent-status-hover-card .context-category-list dd,
    .status-panel .context-usage-meta,
    .status-panel .context-category-list,
    .status-panel .context-category-list dd {
      color: #e5e7eb;
    }

    .workspace-pptx-preview-stage {
      background: #0f172a;
    }

    .workspace-pptx-preview-loading {
      color: #e5e7eb;
      background: #1f2937;
      border-color: #475569;
    }
  }

  :root[data-webui-theme='dark'] {
    --webui-divider: #334155;
    --webui-scrollbar-thumb: #64748b;
    --webui-scrollbar-thumb-hover: #94a3b8;
    --webui-scrollbar-track: transparent;
    --webui-code-bg: #111827;
    --webui-code-fg: #eeffff;
    --webui-code-border: #334155;
    --webui-code-comment: #6f7d9b;
    --webui-code-keyword: #c792ea;
    --webui-code-entity: #82aaff;
    --webui-code-literal: #f78c6c;
    --webui-code-string: #c3e88d;
    --webui-code-variable: #ffcb6b;
    --webui-code-meta: #89ddff;
    --webui-code-built-in: #ffcb6b;
    --webui-code-addition: #c3e88d;
    --webui-code-addition-bg: #17351f;
    --webui-code-deletion: #ff5370;
    --webui-code-deletion-bg: #3f1823;
    --webui-inline-code-bg: #331c33;
    --webui-inline-code-fg: #ffcbf2;
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

  :root[data-webui-theme='dark'] .composer-expand-control {
    color: #cbd5e1;
  }

  :root[data-webui-theme='dark'] .composer-expand-control:hover,
  :root[data-webui-theme='dark'] .composer-expand-control:focus-visible {
    color: #ffffff;
    background: #334155;
  }

  :root[data-webui-theme='dark'] .conversation-item,
  :root[data-webui-theme='dark'] .conversation-action-button,
  :root[data-webui-theme='dark'] .conversation-action-menu,
  :root[data-webui-theme='dark'] .conversation-title-input,
  :root[data-webui-theme='dark'] .help-guide-tree,
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
  :root[data-webui-theme='dark'] .conversation-item-wrap:focus-within .conversation-item,
  :root[data-webui-theme='dark'] .conversation-action-button:hover,
  :root[data-webui-theme='dark'] .conversation-action-button:focus-visible,
  :root[data-webui-theme='dark'] .conversation-action-menu-item:hover,
  :root[data-webui-theme='dark'] .conversation-action-menu-item:focus-visible,
  :root[data-webui-theme='dark'] .model-picker-option:hover,
  :root[data-webui-theme='dark'] .model-picker-option-selected,
  :root[data-webui-theme='dark'] .reasoning-picker-option:hover,
  :root[data-webui-theme='dark'] .reasoning-picker-option-selected,
  :root[data-webui-theme='dark'] .slash-command-option:hover,
  :root[data-webui-theme='dark'] .theme-toggle-button:hover {
    background: #334155;
  }

  :root[data-webui-theme='dark'] .conversation-title,
  :root[data-webui-theme='dark'] .conversation-action-menu-item,
  :root[data-webui-theme='dark'] .help-runtime-section h3,
  :root[data-webui-theme='dark'] .help-guide-tree > summary,
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
  :root[data-webui-theme='dark'] .help-guide-tree ul,
  :root[data-webui-theme='dark'] .conversation-meta,
  :root[data-webui-theme='dark'] .model-picker-provider {
    color: #94a3b8;
  }

  :root[data-webui-theme='dark'] .model-selector-button {
    color: #cbd5e1;
    background: #334155;
  }

  :root[data-webui-theme='dark'] .language-picker-option {
    color: #e5e7eb;
  }

  :root[data-webui-theme='dark'] .language-picker-option:hover,
  :root[data-webui-theme='dark'] .language-picker-option-selected {
    background: #334155;
  }

  :root[data-webui-theme='dark'] .agent-status-hover-card,
  :root[data-webui-theme='dark'] .agent-status-item {
    color: #e5e7eb;
    background: #273449;
    border-color: #475569;
  }

  :root[data-webui-theme='dark'] .agent-status-section:not(.agent-status-section-compact),
  :root[data-webui-theme='dark'] .agent-status-panel-tab-active,
  :root[data-webui-theme='dark'] .agent-status-shortcut:hover,
  :root[data-webui-theme='dark'] .agent-status-shortcut:focus-visible,
  :root[data-webui-theme='dark'] .agent-status-shortcut-active,
  :root[data-webui-theme='dark'] .agent-status-panel-close:hover,
  :root[data-webui-theme='dark'] .agent-status-panel-close:focus-visible {
    color: #f8fafc;
    background: #334155;
    border-color: #475569;
  }

  :root[data-webui-theme='dark'] .agent-status-section h3,
  :root[data-webui-theme='dark'] .agent-status-item-title,
  :root[data-webui-theme='dark'] .agent-status-item-state,
  :root[data-webui-theme='dark'] .agent-status-empty,
  :root[data-webui-theme='dark'] .context-usage-meta,
  :root[data-webui-theme='dark'] .context-category-list,
  :root[data-webui-theme='dark'] .context-category-list dd {
    color: #e5e7eb;
  }

  :root[data-webui-theme='dark'] .agent-status-section-compact + .agent-status-section-compact,
  :root[data-webui-theme='dark'] .context-category-list {
    border-color: #475569;
  }

  :root[data-webui-theme='dark'] .context-progress-track {
    background: #475569;
  }

  :root[data-webui-theme='dark'] .agent-status-shortcut-badge {
    color: #e2e8f0;
    background: #475569;
    box-shadow: 0 0 0 2px #111827;
  }

  :root[data-webui-theme='dark'] .speech-settings-warning {
    color: #fde68a;
    background: #422006;
    border-color: #854d0e;
  }

  :root[data-webui-theme='dark'] .speech-setting-row,
  :root[data-webui-theme='dark'] .speech-setting-value {
    color: #cbd5e1;
  }

  :root[data-webui-theme='dark'] .speech-voice-select {
    color: #e5e7eb;
    background: #1f2937;
    border-color: #475569;
  }

  :root[data-webui-theme='dark'] .speech-settings-button-secondary {
    color: #e5e7eb;
    background: #273449;
    border-color: #475569;
  }

  :root[data-webui-theme='dark'] .speech-notice {
    color: #fde68a;
    background: #422006;
    border-color: #854d0e;
  }

  :root[data-webui-theme='dark'] .speech-notice::after {
    background: #422006;
    border-color: #854d0e;
  }

  :root[data-webui-theme='dark'] .workspace-file-search,
  :root[data-webui-theme='dark'] .workspace-file-preview,
  :root[data-webui-theme='dark'] .workspace-code-preview {
    color: #e5e7eb;
    background: #1f2937;
    border-color: #475569;
  }

  :root[data-webui-theme='dark'] .workspace-docx-preview-scroll {
    background: #0f172a;
  }

  :root[data-webui-theme='dark'] .workspace-pptx-preview-stage {
    background: #0f172a;
  }

  :root[data-webui-theme='dark'] .workspace-pptx-preview-loading {
    color: #e5e7eb;
    background: #1f2937;
    border-color: #475569;
  }

  :root[data-webui-theme='dark'] .workspace-file-search:focus,
  :root[data-webui-theme='dark'] .workspace-file-row:hover,
  :root[data-webui-theme='dark'] .workspace-file-row:focus-visible,
  :root[data-webui-theme='dark'] .workspace-file-row-selected,
  :root[data-webui-theme='dark'] .workspace-files-refresh:hover,
  :root[data-webui-theme='dark'] .workspace-file-preview-back:hover {
    color: #f8fafc;
    background: #334155;
  }

  :root[data-webui-theme='dark'] .workspace-file-preview-title,
  :root[data-webui-theme='dark'] .workspace-file-row {
    color: #cbd5e1;
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
      gap: 6px;
      align-items: center;
      padding-top: 2px;
    }

    .status-panel-resize-handle {
      display: none;
    }

    .webui-shell-status-open,
    .webui-shell-files-open {
      grid-template-columns: 1fr;
    }

    .mobile-chat-actions .mobile-sidebar-button {
      display: none;
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

    .message-actions {
      opacity: 1;
    }

    .message-footer {
      gap: 8px;
      align-items: flex-end;
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
      bottom: 132px;
    }

    .agent-status-panel-backdrop {
      position: fixed;
      z-index: 41;
      inset: 0;
      display: block;
      padding: 0;
      background: rgb(15 23 42 / 42%);
      border: 0;
    }

    .agent-status-panel {
      position: fixed;
      z-index: 42;
      top: 0;
      right: 0;
      bottom: 0;
      display: grid;
      width: min(360px, calc(100vw - 28px));
      border-left: 1px solid var(--webui-divider);
      box-shadow: -16px 0 40px rgb(15 23 42 / 18%);
      animation: agent-status-panel-in 160ms ease-out;
    }

    .agent-status-hover-card {
      position: fixed;
      top: 58px;
      right: 12px;
      width: min(320px, calc(100vw - 24px));
    }

    @keyframes agent-status-panel-in {
      from { transform: translateX(100%); }
      to { transform: translateX(0); }
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

    .workspace-docx-preview {
      zoom: 0.4;
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
