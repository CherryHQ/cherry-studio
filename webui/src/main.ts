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
  WebUiPermissionMode,
  WebUiPermissionModeResponse,
  WebUiRole,
  WebUiSendAttachment,
  WebUiSlashCommand,
  WebUiSlashCommandsResponse,
  WebUiToolApprovalResponse,
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
  loadSpeechPanelPreferences,
  loadSpeechPreferences,
  saveSpeechPanelPreferences,
  saveSpeechPreferences,
  SPEECH_RATE_MAX,
  type SpeechPanelPreferences,
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
/** First page + each older page size. Keep small so multi-turn chats (≈5 rounds) paginate early. */
const messagePageSize = 10
/** Session history sidebar: first page + each older page. */
const conversationPageSize = 25
const maxAttachmentCount = 5
const maxAttachmentBytes = 10 * 1024 * 1024
const maxAttachmentsBytes = 25 * 1024 * 1024
const composerDefaultHeight = 92
const composerMinHeight = 76
const composerMaxHeight = 220
const composerKeyboardStep = 12
// Align with desktop LanguageVarious (src/shared/data/preference/preferenceTypes.ts).
const webUiLanguages = [
  { id: 'en-US', label: 'English' },
  { id: 'zh-CN', label: '中文' },
  { id: 'zh-TW', label: '繁體中文' },
  { id: 'de-DE', label: 'Deutsch' },
  { id: 'el-GR', label: 'Ελληνικά' },
  { id: 'es-ES', label: 'Español' },
  { id: 'fr-FR', label: 'Français' },
  { id: 'ja-JP', label: '日本語' },
  { id: 'pt-PT', label: 'Português' },
  { id: 'ro-RO', label: 'Română' },
  { id: 'ru-RU', label: 'Русский' },
  { id: 'vi-VN', label: 'Tiếng Việt' }
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
    connected: 'Desktop bridge connected',
    context: 'Context',
    copy: 'Copy',
    copyMarkdown: 'Copy Markdown',
    copyPlainText: 'Copy plain text',
    copyCode: 'Copy code',
    copySource: 'Copy source',
    downloadSource: 'Download source',
    previewMode: 'Preview',
    sourceMode: 'Source',
    wrapLines: 'Wrap lines',
    unwrapLines: 'Disable line wrap',
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
    speechPlay: 'Play',
    speechPause: 'Pause',
    speechStop: 'Stop',
    speechPreviousSentence: 'Previous sentence',
    speechNextSentence: 'Next sentence',
    speechPreviousParagraph: 'Previous paragraph',
    speechNextParagraph: 'Next paragraph',
    speechAutoOpenPanel: 'Open Speech panel when reading aloud',
    speechAutoOpenPanelHint: 'When enabled, tapping Read aloud opens the right Speech tab.',
    speechTransport: 'Playback controls',
    speechProgress: 'Progress',
    speechNoActiveReading: 'No active reading session.',
    speechIdleHint: 'Select Read aloud on a message to start.',
    attachmentPreview: 'Preview attachment',
    attachmentPreviewUnavailable: 'This attachment cannot be previewed.',
    attachmentPreviewOpenFailed: 'Unable to open the attachment.',
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
    helpGuideSessions:
      'Sessions: create, switch, rename, generate topic names, or delete records from the left sidebar.',
    helpGuideStatus:
      'Status: review context usage, running tasks, tool calls, sub-agents, and generated artifacts from the right panel.',
    helpGuideFiles:
      'Files: browse and preview workspace or allowed local files in read-only mode when an access key is configured.',
    helpGuidePreview:
      'Preview: Markdown, text, code, and script-like files provide toolbar actions for source/plain-text copy, source view, wrapping, and download.',
    helpGuideSpeech:
      'Speech: adjust browser speech settings from the Speech tab; availability depends on the browser and system voices.',
    helpGuideSecurity:
      'Security: WebUI keeps file previews read-only and does not directly access IPC, databases, or AI core internals.',
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
    loadingOlderConversations: 'Loading earlier conversations...',
    loadOlderConversations: 'Load earlier conversations',
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
    webUiVersion: 'WebUI',
    approveTool: 'Allow',
    denyTool: 'Deny',
    approvalSubmitting: 'Submitting…',
    approvalReadonly: 'Approval required — open the desktop app if buttons are unavailable.',
    approvalFailed: 'Failed to send tool approval.',
    toolPermissionConfirmation: 'Tool permission',
    toolPermissionPending: 'Pending',
    permissionMode: 'Permission mode',
    permissionModeDefault: 'Normal',
    permissionModePlan: 'Plan',
    permissionModeAcceptEdits: 'Auto-edit',
    permissionModeBypass: 'Full auto',
    permissionModeDefaultDesc: 'Read freely. Ask before edits or commands.',
    permissionModePlanDesc: 'Read and plan only. No edits or commands.',
    permissionModeAcceptEditsDesc: 'Read and edit freely. Ask before commands.',
    permissionModeBypassDesc: 'Do everything without asking. Use with caution.'
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
    connected: '桌面桥接已连接',
    context: '上下文',
    copy: '复制',
    copyMarkdown: '复制 Markdown',
    copyPlainText: '复制纯文本',
    copyCode: '复制代码',
    copySource: '复制源码',
    downloadSource: '下载源码',
    previewMode: '预览',
    sourceMode: '源码',
    wrapLines: '自动换行',
    unwrapLines: '关闭换行',
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
    speechPlay: '播放',
    speechPause: '暂停',
    speechStop: '停止',
    speechPreviousSentence: '上一句',
    speechNextSentence: '下一句',
    speechPreviousParagraph: '上一段',
    speechNextParagraph: '下一段',
    speechAutoOpenPanel: '朗读时自动打开朗读分组',
    speechAutoOpenPanelHint: '开启后，点击消息的朗读按钮会自动展开右侧朗读分组。',
    speechTransport: '朗读控制',
    speechProgress: '进度',
    speechNoActiveReading: '当前没有正在朗读的内容。',
    speechIdleHint: '点击消息上的朗读按钮开始。',
    attachmentPreview: '预览附件',
    attachmentPreviewUnavailable: '此附件无法预览。',
    attachmentPreviewOpenFailed: '无法打开附件。',
    deleteConversation: '删除会话',
    deleteConversationDescription: '此会话及其消息将从桌面端删除，且无法恢复。',
    delete: '删除',
    editTitle: '编辑标题',
    generateTopicName: '生成话题名',
    generatingTopicName: '正在生成题名...',
    help: '帮助',
    helpGuide: '使用说明',
    helpGuideIntro: '通过 WebUI 在浏览器中继续使用桌面端 Agent 会话。',
    helpGuideSessions: '会话：可在左侧栏新建、切换、重命名、生成话题名或删除会话记录。',
    helpGuideStatus: '状态：可在右侧栏查看上下文用量、运行任务、工具调用、子代理和产物。',
    helpGuideFiles: '文件：配置访问 KEY 后，可用只读模式浏览并预览工作区或允许访问的本地文件。',
    helpGuidePreview:
      '预览：Markdown、文本、代码和脚本类文件可通过工具栏复制源码/纯文本、切换源码视图、自动换行或下载源码。',
    helpGuideSpeech: '朗读：可在“朗读”分组调整浏览器朗读偏好；可用性取决于浏览器和系统语音。',
    helpGuideSecurity: '安全：WebUI 文件预览保持只读，不直接访问 IPC、数据库或 AI 核心内部逻辑。',
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
    loadingOlderConversations: '正在加载更早会话记录...',
    loadOlderConversations: '加载更早会话记录',
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
    webUiVersion: 'WebUI',
    approveTool: '允许',
    denyTool: '拒绝',
    approvalSubmitting: '提交中…',
    approvalReadonly: '需要授权 — 若无按钮请在桌面端处理。',
    approvalFailed: '工具授权提交失败。',
    toolPermissionConfirmation: '工具权限确认',
    toolPermissionPending: '待处理',
    permissionMode: '权限模式',
    permissionModeDefault: '标准',
    permissionModePlan: '计划',
    permissionModeAcceptEdits: '自动编辑',
    permissionModeBypass: '全自动',
    permissionModeDefaultDesc: '可自由读取；编辑或执行命令前需确认。',
    permissionModePlanDesc: '仅可读取与规划；不可编辑或执行命令。',
    permissionModeAcceptEditsDesc: '可自由读写文件；执行命令前需确认。',
    permissionModeBypassDesc: '无需确认即可执行全部操作，请谨慎使用。'
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
    connected: '桌面橋接已連線',
    context: '上下文',
    copy: '複製',
    copyMarkdown: '複製 Markdown',
    copyPlainText: '複製純文字',
    copyCode: '複製程式碼',
    copySource: '複製原始碼',
    downloadSource: '下載原始碼',
    previewMode: '預覽',
    sourceMode: '原始碼',
    wrapLines: '自動換行',
    unwrapLines: '關閉換行',
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
    speechPlay: '播放',
    speechPause: '暫停',
    speechStop: '停止',
    speechPreviousSentence: '上一句',
    speechNextSentence: '下一句',
    speechPreviousParagraph: '上一段',
    speechNextParagraph: '下一段',
    speechAutoOpenPanel: '朗讀時自動開啟朗讀分組',
    speechAutoOpenPanelHint: '開啟後，點擊訊息的朗讀按鈕會自動展開右側朗讀分組。',
    speechTransport: '朗讀控制',
    speechProgress: '進度',
    speechNoActiveReading: '目前沒有正在朗讀的內容。',
    speechIdleHint: '點擊訊息上的朗讀按鈕開始。',
    attachmentPreview: '預覽附件',
    attachmentPreviewUnavailable: '此附件無法預覽。',
    attachmentPreviewOpenFailed: '無法開啟附件。',
    deleteConversation: '刪除會話',
    deleteConversationDescription: '此會話及其訊息將從桌面端刪除，且無法復原。',
    delete: '刪除',
    editTitle: '編輯標題',
    generateTopicName: '生成話題名',
    generatingTopicName: '正在生成題名...',
    help: '說明',
    helpGuide: '使用說明',
    helpGuideIntro: '透過 WebUI 在瀏覽器中繼續使用桌面端 Agent 會話。',
    helpGuideSessions: '會話：可在左側欄新增、切換、重新命名、生成話題名或刪除會話記錄。',
    helpGuideStatus: '狀態：可在右側欄查看上下文用量、執行任務、工具調用、子代理和產物。',
    helpGuideFiles: '檔案：設定存取 KEY 後，可用唯讀模式瀏覽並預覽工作區或允許存取的本機檔案。',
    helpGuidePreview:
      '預覽：Markdown、文字、程式碼和腳本類檔案可透過工具列複製原始碼/純文字、切換原始碼視圖、自動換行或下載原始碼。',
    helpGuideSpeech: '朗讀：可在「朗讀」分組調整瀏覽器朗讀偏好；可用性取決於瀏覽器和系統語音。',
    helpGuideSecurity: '安全：WebUI 檔案預覽保持唯讀，不直接存取 IPC、資料庫或 AI 核心內部邏輯。',
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
    loadingOlderConversations: '正在載入更早會話記錄...',
    loadOlderConversations: '載入更早會話記錄',
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
    webUiVersion: 'WebUI',
    approveTool: '允許',
    denyTool: '拒絕',
    approvalSubmitting: '提交中…',
    approvalReadonly: '需要授權 — 若無按鈕請在桌面端處理。',
    approvalFailed: '工具授權提交失敗。',
    toolPermissionConfirmation: '工具權限確認',
    toolPermissionPending: '待處理',
    permissionMode: '權限模式',
    permissionModeDefault: '標準',
    permissionModePlan: '計劃',
    permissionModeAcceptEdits: '自動編輯',
    permissionModeBypass: '全自動',
    permissionModeDefaultDesc: '可自由讀取；編輯或執行命令前需確認。',
    permissionModePlanDesc: '僅可讀取與規劃；不可編輯或執行命令。',
    permissionModeAcceptEditsDesc: '可自由讀寫檔案；執行命令前需確認。',
    permissionModeBypassDesc: '無需確認即可執行全部操作，請謹慎使用。'
  },
  'ja-JP': {
    agent: 'エージェント',
    appVersion: 'Cherry Studio',
    authDescription: 'Cherry Studio で設定した WebUI アクセスキーを入力してください。',
    authKey: 'アクセスキー',
    authTitle: 'WebUI 認証',
    bridgeStatus: 'ブリッジ状態',
    changeLanguage: '言語を変更',
    cancel: 'キャンセル',
    checkingBridge: 'デスクトップブリッジを確認中',
    close: '閉じる',
    connected: 'デスクトップブリッジ接続済み',
    context: 'コンテキスト',
    copy: 'コピー',
    copyMarkdown: 'Markdown をコピー',
    copyPlainText: 'プレーンテキストをコピー',
    copyCode: 'コードをコピー',
    copySource: 'ソースをコピー',
    downloadSource: 'ソースをダウンロード',
    previewMode: 'プレビュー',
    sourceMode: 'ソース',
    wrapLines: '折り返し',
    unwrapLines: '折り返し解除',
    copied: 'コピーしました',
    openPath: 'パスを開く',
    pathInputPlaceholder: '読み取り専用で閲覧するフォルダパスを入力',
    readAloud: '読み上げ',
    stopReading: '読み上げを停止',
    speechUnavailable: 'このブラウザでは音声読み上げを利用できません。',
    speechPanel: '音声',
    speechRate: '速度',
    speechPitch: 'ピッチ',
    speechVolume: '音量',
    speechVoice: '音声',
    speechVoiceDefault: 'システム既定',
    speechPreview: 'プレビュー',
    speechPreviewSample: 'こんにちは。これは Cherry Studio WebUI の音声プレビューです。',
    speechReset: '既定に戻す',
    speechEmptyContent: 'このメッセージには読み上げ可能なテキストがありません。',
    speechGeneratingBlocked: 'メッセージ生成中は読み上げできません。',
    speechPlay: '再生',
    speechPause: '一時停止',
    speechStop: '停止',
    speechPreviousSentence: '前の文',
    speechNextSentence: '次の文',
    speechPreviousParagraph: '前の段落',
    speechNextParagraph: '次の段落',
    speechAutoOpenPanel: '読み上げ時に音声パネルを開く',
    speechAutoOpenPanelHint: '有効にすると、読み上げ開始時に右側の音声タブを開きます。',
    speechTransport: '再生コントロール',
    speechProgress: '進捗',
    speechNoActiveReading: '読み上げ中のセッションはありません。',
    speechIdleHint: 'メッセージの「読み上げ」を選んで開始します。',
    attachmentPreview: '添付をプレビュー',
    attachmentPreviewUnavailable: 'この添付はプレビューできません。',
    attachmentPreviewOpenFailed: '添付を開けませんでした。',
    deleteConversation: '会話を削除',
    deleteConversationDescription: 'この会話とそのメッセージはデスクトップアプリから削除され、復元できません。',
    delete: '削除',
    editTitle: 'タイトルを編集',
    generateTopicName: 'トピック名を生成',
    generatingTopicName: 'タイトルを生成中...',
    help: 'ヘルプ',
    helpGuide: '使い方ガイド',
    helpGuideIntro: 'WebUI を使って、このブラウザからデスクトップ Agent セッションを続行できます。',
    helpGuideSessions: 'セッション: 左サイドバーで作成、切り替え、名前変更、トピック名生成、削除ができます。',
    helpGuideStatus:
      'ステータス: 右パネルでコンテキスト使用量、実行中タスク、ツール呼び出し、サブエージェント、成果物を確認できます。',
    helpGuideFiles:
      'ファイル: アクセスキー設定後、ワークスペースや許可されたローカルファイルを読み取り専用で閲覧・プレビューできます。',
    helpGuidePreview:
      'プレビュー: Markdown、テキスト、コード、スクリプト系ファイルは、コピー、ソース表示、折り返し、ダウンロードなどのツールバー操作に対応します。',
    helpGuideSpeech:
      '音声: 音声タブでブラウザの読み上げ設定を調整できます。利用可否はブラウザとシステム音声に依存します。',
    helpGuideSecurity:
      'セキュリティ: WebUI のファイルプレビューは読み取り専用で、IPC・データベース・AI コア内部へ直接アクセスしません。',
    renameTitle: '会話名を変更',
    save: '保存',
    saving: '保存中...',
    titleRequired: 'タイトルは空にできません。',
    deleteMessage: 'このメッセージを削除しますか？',
    deleteMessageDescription: 'このメッセージはデスクトップ会話から削除され、復元できません。',
    deleting: '削除中...',
    create: '作成',
    creating: '作成中...',
    desktopSession: 'デスクトップセッション',
    disconnected: 'デスクトップブリッジ利用不可',
    emptyConversation: 'このデスクトップ会話にはまだメッセージがありません。',
    generating: '生成中',
    githubProject: 'プロジェクトリポジトリを開く',
    invalidKey: 'アクセスキーが無効です',
    loadingConversations: '会話を読み込み中',
    loadingMessages: 'デスクトップメッセージを読み込み中',
    loadingOlder: '以前のメッセージを読み込み中...',
    loadOlder: '以前のメッセージを読み込む',
    loadingOlderConversations: '以前の会話を読み込み中...',
    loadOlderConversations: '以前の会話を読み込む',
    model: 'モデル',
    newConversation: '新しい会話',
    conversationHistory: '会話履歴',
    noAgents: '利用可能なデスクトップ Agent がありません。',
    noContext: 'コンテキスト使用量はありません',
    status: 'ステータス',
    tasks: 'タスク',
    subagents: 'サブエージェント',
    artifacts: '成果物',
    contextUsage: 'コンテキスト使用量',
    runtimeDetails: 'WebUI 接続',
    filePreviewPending: 'ファイルプレビューは今後の更新で提供予定です。',
    files: 'ファイル',
    searchFiles: 'ファイルを検索',
    refreshFiles: 'ファイルを更新',
    loadingFiles: 'ファイルを読み込み中',
    filesEmpty: 'ワークスペースにファイルがありません',
    noSearchResults: '一致するファイルがありません',
    selectFile: 'プレビューするファイルを選択',
    backToFiles: 'ファイル一覧に戻る',
    fileUnavailable: 'このファイルは利用できません。',
    fileAuthRequired: 'ワークスペースファイルを閲覧するには WebUI アクセスキーを設定してください。',
    fileTooLarge: 'ファイルが大きすぎてプレビューできません。',
    binaryUnavailable: 'このバイナリ形式は基本プレビューに対応していません。',
    statusPending: '待機中',
    statusRunning: '進行中',
    statusCompleted: '完了',
    statusError: 'エラー',
    contextAutocompactBuffer: '自動圧縮バッファ',
    contextCustomAgents: 'カスタムエージェント',
    contextFreeSpace: '空き容量',
    contextMcpTools: 'MCP ツール',
    contextMemoryFiles: 'メモリファイル',
    contextMessages: 'メッセージ',
    contextPlugins: 'プラグイン',
    contextSkills: 'スキル',
    contextSystemPrompt: 'システムプロンプト',
    contextSystemTools: 'システムツール',
    noSessions: 'デスクトップセッションはまだありません',
    reasoning: '推論',
    processDetails: '処理の詳細',
    toolCalls: 'ツール呼び出し',
    processingTime: '処理時間',
    requestAborted: '生成が中断されました',
    runtime: 'ランタイム',
    selectConversation: '会話を選択',
    selectFirst: '先にデスクトップ会話を選択してください',
    send: '送信',
    sendPlaceholder: 'メッセージを入力。Enter で送信、Shift+Enter で改行。/ でスキルやコマンドを検索。',
    serviceStarted: '開始済み',
    sessionsChanged: '選択中のデスクトップ会話は利用できなくなりました。',
    sseClients: 'SSE クライアント',
    stop: '停止',
    stopped: '停止済み',
    switchToDark: 'ダークテーマに切り替え',
    switchToLight: 'ライトテーマに切り替え',
    attachmentPending: 'ファイルを追加',
    attachmentLimit: '最大 5 ファイル、各 10 MB、合計 25 MB まで。',
    attachmentReadFailed: '選択したファイルを読み取れませんでした。',
    removeAttachment: '添付を削除',
    backToBottom: '一番下へ',
    resizeComposer: '入力欄の高さを変更',
    newConversationTool: '新しい会話',
    thinkingPending: '推論の長さ',
    thinkingUnavailable: '現在のデスクトップ Agent ランタイムは推論長の制御を公開していません。',
    reasoningDefault: '既定',
    reasoningNone: 'オフ',
    reasoningMinimal: '最小',
    reasoningLow: '低',
    reasoningMedium: '中',
    reasoningHigh: '高',
    reasoningXhigh: '特高',
    reasoningAuto: '自動',
    unavailable: '利用不可',
    verify: '確認',
    webui: 'WebUI',
    webUiVersion: 'WebUI',
    approveTool: '許可',
    denyTool: '拒否',
    approvalSubmitting: '送信中…',
    approvalReadonly: '承認が必要です — ボタンが使えない場合はデスクトップアプリを開いてください。',
    approvalFailed: 'ツール承認の送信に失敗しました。',
    toolPermissionConfirmation: 'ツール権限',
    toolPermissionPending: '保留中',
    permissionMode: '権限モード',
    permissionModeDefault: '通常',
    permissionModePlan: '計画',
    permissionModeAcceptEdits: '自動編集',
    permissionModeBypass: '完全自動',
    permissionModeDefaultDesc: '読み取りは自由。編集やコマンド実行前に確認します。',
    permissionModePlanDesc: '読み取りと計画のみ。編集やコマンドは行いません。',
    permissionModeAcceptEditsDesc: '読み取りと編集は自由。コマンド実行前に確認します。',
    permissionModeBypassDesc: '確認なしで実行します。注意して使用してください。'
  },
  'de-DE': {
    agent: 'Agent',
    appVersion: 'Cherry Studio',
    authDescription: 'Geben Sie den in Cherry Studio konfigurierten WebUI-Zugangsschlüssel ein.',
    authKey: 'Zugangsschlüssel',
    authTitle: 'WebUI-Verifizierung',
    bridgeStatus: 'Brückenstatus',
    changeLanguage: 'Sprache ändern',
    cancel: 'Abbrechen',
    checkingBridge: 'Desktop-Brücke wird geprüft',
    close: 'Schließen',
    connected: 'Desktop-Brücke verbunden',
    context: 'Kontext',
    copy: 'Kopieren',
    copyMarkdown: 'Markdown kopieren',
    copyPlainText: 'Klartext kopieren',
    copyCode: 'Code kopieren',
    copySource: 'Quelle kopieren',
    downloadSource: 'Quelle herunterladen',
    previewMode: 'Vorschau',
    sourceMode: 'Quelle',
    wrapLines: 'Zeilenumbruch',
    unwrapLines: 'Zeilenumbruch aus',
    copied: 'Kopiert',
    openPath: 'Pfad öffnen',
    pathInputPlaceholder: 'Ordnerpfad für schreibgeschützte Ansicht eingeben',
    readAloud: 'Vorlesen',
    stopReading: 'Vorlesen stoppen',
    speechUnavailable: 'Sprachausgabe ist in diesem Browser nicht verfügbar.',
    speechPanel: 'Sprache',
    speechRate: 'Geschwindigkeit',
    speechPitch: 'Tonhöhe',
    speechVolume: 'Lautstärke',
    speechVoice: 'Stimme',
    speechVoiceDefault: 'Systemstandard',
    speechPreview: 'Vorschau',
    speechPreviewSample: 'Hallo, dies ist eine Sprachvorschau von Cherry Studio WebUI.',
    speechReset: 'Standard wiederherstellen',
    speechEmptyContent: 'Diese Nachricht enthält keinen lesbaren Text.',
    speechGeneratingBlocked: 'Während der Nachrichtenerzeugung ist Vorlesen nicht verfügbar.',
    speechPlay: 'Abspielen',
    speechPause: 'Pause',
    speechStop: 'Stopp',
    speechPreviousSentence: 'Vorheriger Satz',
    speechNextSentence: 'Nächster Satz',
    speechPreviousParagraph: 'Vorheriger Absatz',
    speechNextParagraph: 'Nächster Absatz',
    speechAutoOpenPanel: 'Sprachpanel beim Vorlesen öffnen',
    speechAutoOpenPanelHint: 'Wenn aktiviert, öffnet Vorlesen den rechten Sprach-Tab.',
    speechTransport: 'Wiedergabesteuerung',
    speechProgress: 'Fortschritt',
    speechNoActiveReading: 'Keine aktive Vorlesesitzung.',
    speechIdleHint: 'Wählen Sie Vorlesen bei einer Nachricht, um zu starten.',
    attachmentPreview: 'Anhangvorschau',
    attachmentPreviewUnavailable: 'Dieser Anhang kann nicht angezeigt werden.',
    attachmentPreviewOpenFailed: 'Anhang konnte nicht geöffnet werden.',
    deleteConversation: 'Unterhaltung löschen',
    deleteConversationDescription:
      'Diese Unterhaltung und ihre Nachrichten werden aus der Desktop-App entfernt und können nicht wiederhergestellt werden.',
    delete: 'Löschen',
    editTitle: 'Titel bearbeiten',
    generateTopicName: 'Themenname erzeugen',
    generatingTopicName: 'Titel wird erzeugt...',
    help: 'Hilfe',
    helpGuide: 'Anleitung',
    helpGuideIntro: 'Nutzen Sie die WebUI, um Desktop-Agent-Sitzungen in diesem Browser fortzusetzen.',
    helpGuideSessions:
      'Sitzungen: im linken Seitenbereich erstellen, wechseln, umbenennen, Themennamen erzeugen oder löschen.',
    helpGuideStatus:
      'Status: Kontextnutzung, laufende Aufgaben, Tool-Aufrufe, Sub-Agents und Artefakte im rechten Panel prüfen.',
    helpGuideFiles:
      'Dateien: Workspace- oder freigegebene lokale Dateien schreibgeschützt durchsuchen und anzeigen, wenn ein Zugangsschlüssel konfiguriert ist.',
    helpGuidePreview:
      'Vorschau: Markdown, Text, Code und skriptähnliche Dateien bieten Toolbar-Aktionen für Kopieren, Quellansicht, Umbruch und Download.',
    helpGuideSpeech:
      'Sprache: Browser-Spracheneinstellungen im Sprach-Tab anpassen; Verfügbarkeit hängt von Browser und Systemstimmen ab.',
    helpGuideSecurity:
      'Sicherheit: Die WebUI hält Dateivorschauen schreibgeschützt und greift nicht direkt auf IPC, Datenbanken oder AI-Core-Interna zu.',
    renameTitle: 'Unterhaltung umbenennen',
    save: 'Speichern',
    saving: 'Wird gespeichert...',
    titleRequired: 'Titel darf nicht leer sein.',
    deleteMessage: 'Diese Nachricht löschen?',
    deleteMessageDescription:
      'Diese Nachricht wird aus der Desktop-Unterhaltung entfernt und kann nicht wiederhergestellt werden.',
    deleting: 'Wird gelöscht...',
    create: 'Erstellen',
    creating: 'Wird erstellt...',
    desktopSession: 'Desktop-Sitzung',
    disconnected: 'Desktop-Brücke nicht verfügbar',
    emptyConversation: 'Diese Desktop-Unterhaltung enthält noch keine Nachrichten.',
    generating: 'Wird erzeugt',
    githubProject: 'Projekt-Repository öffnen',
    invalidKey: 'Ungültiger Zugangsschlüssel',
    loadingConversations: 'Unterhaltungen werden geladen',
    loadingMessages: 'Desktop-Nachrichten werden geladen',
    loadingOlder: 'Frühere Nachrichten werden geladen...',
    loadOlder: 'Frühere Nachrichten laden',
    loadingOlderConversations: 'Frühere Unterhaltungen werden geladen...',
    loadOlderConversations: 'Frühere Unterhaltungen laden',
    model: 'Modell',
    newConversation: 'Neue Unterhaltung',
    conversationHistory: 'Unterhaltungsverlauf',
    noAgents: 'Keine konfigurierten Desktop-Agents verfügbar.',
    noContext: 'Keine Kontextnutzung verfügbar',
    status: 'Status',
    tasks: 'Aufgaben',
    subagents: 'Sub-Agents',
    artifacts: 'Artefakte',
    contextUsage: 'Kontextnutzung',
    runtimeDetails: 'WebUI-Verbindung',
    filePreviewPending: 'Dateivorschau folgt in einem späteren Update.',
    files: 'Dateien',
    searchFiles: 'Dateien suchen',
    refreshFiles: 'Dateien aktualisieren',
    loadingFiles: 'Dateien werden geladen',
    filesEmpty: 'Keine Workspace-Dateien',
    noSearchResults: 'Keine passenden Dateien',
    selectFile: 'Datei zur Vorschau auswählen',
    backToFiles: 'Zurück zu Dateien',
    fileUnavailable: 'Diese Datei ist nicht verfügbar.',
    fileAuthRequired: 'Konfigurieren Sie einen WebUI-Zugangsschlüssel, um Workspace-Dateien zu durchsuchen.',
    fileTooLarge: 'Diese Datei ist zu groß für die Vorschau.',
    binaryUnavailable: 'Dieses Binärformat ist in der Basisvorschau nicht verfügbar.',
    statusPending: 'Ausstehend',
    statusRunning: 'In Bearbeitung',
    statusCompleted: 'Abgeschlossen',
    statusError: 'Fehler',
    contextAutocompactBuffer: 'Autokompakt-Puffer',
    contextCustomAgents: 'Benutzerdefinierte Agents',
    contextFreeSpace: 'Freier Speicher',
    contextMcpTools: 'MCP-Tools',
    contextMemoryFiles: 'Speicherdateien',
    contextMessages: 'Nachrichten',
    contextPlugins: 'Plugins',
    contextSkills: 'Skills',
    contextSystemPrompt: 'Systemprompt',
    contextSystemTools: 'System-Tools',
    noSessions: 'Noch keine Desktop-Sitzungen',
    reasoning: 'Reasoning',
    processDetails: 'Verarbeitungsdetails',
    toolCalls: 'Tool-Aufrufe',
    processingTime: 'Verarbeitet in',
    requestAborted: 'Erzeugung wurde unterbrochen',
    runtime: 'Laufzeit',
    selectConversation: 'Unterhaltung auswählen',
    selectFirst: 'Zuerst eine Desktop-Unterhaltung auswählen',
    send: 'Senden',
    sendPlaceholder:
      'Nachricht eingeben. Enter zum Senden, Shift+Enter für neue Zeile. / zum Suchen von Skills oder Befehlen.',
    serviceStarted: 'Gestartet',
    sessionsChanged: 'Die ausgewählte Desktop-Unterhaltung ist nicht mehr verfügbar.',
    sseClients: 'SSE-Clients',
    stop: 'Stopp',
    stopped: 'Gestoppt',
    switchToDark: 'Zum dunklen Design wechseln',
    switchToLight: 'Zum hellen Design wechseln',
    attachmentPending: 'Datei hinzufügen',
    attachmentLimit: 'Bis zu 5 Dateien, je 10 MB und insgesamt 25 MB.',
    attachmentReadFailed: 'Ausgewählte Datei konnte nicht gelesen werden.',
    removeAttachment: 'Anhang entfernen',
    backToBottom: 'Nach unten',
    resizeComposer: 'Eingabefeld skalieren',
    newConversationTool: 'Neue Unterhaltung',
    thinkingPending: 'Reasoning-Länge',
    thinkingUnavailable: 'Die aktuelle Desktop-Agent-Laufzeit stellt keine Steuerung der Reasoning-Länge bereit.',
    reasoningDefault: 'Standard',
    reasoningNone: 'Aus',
    reasoningMinimal: 'Minimal',
    reasoningLow: 'Niedrig',
    reasoningMedium: 'Mittel',
    reasoningHigh: 'Hoch',
    reasoningXhigh: 'Sehr hoch',
    reasoningAuto: 'Auto',
    unavailable: 'Nicht verfügbar',
    verify: 'Prüfen',
    webui: 'WebUI',
    webUiVersion: 'WebUI',
    approveTool: 'Erlauben',
    denyTool: 'Ablehnen',
    approvalSubmitting: 'Wird gesendet…',
    approvalReadonly: 'Freigabe erforderlich — öffnen Sie die Desktop-App, falls Schaltflächen nicht verfügbar sind.',
    approvalFailed: 'Tool-Freigabe konnte nicht gesendet werden.',
    toolPermissionConfirmation: 'Tool-Berechtigung',
    toolPermissionPending: 'Ausstehend',
    permissionMode: 'Berechtigungsmodus',
    permissionModeDefault: 'Normal',
    permissionModePlan: 'Planen',
    permissionModeAcceptEdits: 'Auto-Bearbeitung',
    permissionModeBypass: 'Vollautomatisch',
    permissionModeDefaultDesc: 'Frei lesen. Vor Bearbeitungen oder Befehlen nachfragen.',
    permissionModePlanDesc: 'Nur lesen und planen. Keine Bearbeitungen oder Befehle.',
    permissionModeAcceptEditsDesc: 'Frei lesen und bearbeiten. Vor Befehlen nachfragen.',
    permissionModeBypassDesc: 'Alles ohne Nachfrage ausführen. Mit Vorsicht verwenden.'
  },
  'fr-FR': {
    agent: 'Agent',
    appVersion: 'Cherry Studio',
    authDescription: 'Saisissez la clé d’accès WebUI configurée dans Cherry Studio.',
    authKey: 'Clé d’accès',
    authTitle: 'Vérification WebUI',
    bridgeStatus: 'État du pont',
    changeLanguage: 'Changer de langue',
    cancel: 'Annuler',
    checkingBridge: 'Vérification du pont bureau',
    close: 'Fermer',
    connected: 'Pont bureau connecté',
    context: 'Contexte',
    copy: 'Copier',
    copyMarkdown: 'Copier le Markdown',
    copyPlainText: 'Copier le texte brut',
    copyCode: 'Copier le code',
    copySource: 'Copier la source',
    downloadSource: 'Télécharger la source',
    previewMode: 'Aperçu',
    sourceMode: 'Source',
    wrapLines: 'Retour à la ligne',
    unwrapLines: 'Désactiver le retour à la ligne',
    copied: 'Copié',
    openPath: 'Ouvrir le chemin',
    pathInputPlaceholder: 'Saisir un chemin de dossier en lecture seule',
    readAloud: 'Lire à voix haute',
    stopReading: 'Arrêter la lecture',
    speechUnavailable: 'La synthèse vocale n’est pas disponible dans ce navigateur.',
    speechPanel: 'Voix',
    speechRate: 'Vitesse',
    speechPitch: 'Hauteur',
    speechVolume: 'Volume',
    speechVoice: 'Voix',
    speechVoiceDefault: 'Par défaut du système',
    speechPreview: 'Aperçu',
    speechPreviewSample: 'Bonjour, ceci est un aperçu vocal de Cherry Studio WebUI.',
    speechReset: 'Réinitialiser',
    speechEmptyContent: 'Ce message ne contient aucun texte lisible.',
    speechGeneratingBlocked: 'La lecture n’est pas disponible pendant la génération du message.',
    speechPlay: 'Lecture',
    speechPause: 'Pause',
    speechStop: 'Arrêt',
    speechPreviousSentence: 'Phrase précédente',
    speechNextSentence: 'Phrase suivante',
    speechPreviousParagraph: 'Paragraphe précédent',
    speechNextParagraph: 'Paragraphe suivant',
    speechAutoOpenPanel: 'Ouvrir le panneau Voix lors de la lecture',
    speechAutoOpenPanelHint: 'Si activé, la lecture ouvre l’onglet Voix à droite.',
    speechTransport: 'Commandes de lecture',
    speechProgress: 'Progression',
    speechNoActiveReading: 'Aucune session de lecture active.',
    speechIdleHint: 'Sélectionnez Lire à voix haute sur un message pour commencer.',
    attachmentPreview: 'Aperçu de la pièce jointe',
    attachmentPreviewUnavailable: 'Cette pièce jointe ne peut pas être prévisualisée.',
    attachmentPreviewOpenFailed: 'Impossible d’ouvrir la pièce jointe.',
    deleteConversation: 'Supprimer la conversation',
    deleteConversationDescription:
      'Cette conversation et ses messages seront supprimés de l’application bureau et ne pourront pas être restaurés.',
    delete: 'Supprimer',
    editTitle: 'Modifier le titre',
    generateTopicName: 'Générer un nom de sujet',
    generatingTopicName: 'Génération du titre...',
    help: 'Aide',
    helpGuide: 'Guide d’utilisation',
    helpGuideIntro: 'Utilisez la WebUI pour poursuivre les sessions Agent bureau depuis ce navigateur.',
    helpGuideSessions:
      'Sessions : créez, basculez, renommez, générez des sujets ou supprimez des enregistrements depuis la barre latérale gauche.',
    helpGuideStatus:
      'État : consultez l’usage du contexte, les tâches en cours, les appels d’outils, les sous-agents et les artefacts depuis le panneau droit.',
    helpGuideFiles:
      'Fichiers : parcourez et prévisualisez l’espace de travail ou des fichiers locaux autorisés en lecture seule lorsqu’une clé d’accès est configurée.',
    helpGuidePreview:
      'Aperçu : Markdown, texte, code et fichiers de type script offrent des actions de barre d’outils pour copier, afficher la source, le retour à la ligne et le téléchargement.',
    helpGuideSpeech:
      'Voix : ajustez les paramètres de synthèse vocale dans l’onglet Voix ; la disponibilité dépend du navigateur et des voix système.',
    helpGuideSecurity:
      'Sécurité : la WebUI conserve les aperçus en lecture seule et n’accède pas directement à l’IPC, aux bases de données ou au cœur IA.',
    renameTitle: 'Renommer la conversation',
    save: 'Enregistrer',
    saving: 'Enregistrement...',
    titleRequired: 'Le titre ne peut pas être vide.',
    deleteMessage: 'Supprimer ce message ?',
    deleteMessageDescription: 'Ce message sera retiré de la conversation bureau et ne pourra pas être restauré.',
    deleting: 'Suppression...',
    create: 'Créer',
    creating: 'Création...',
    desktopSession: 'Session bureau',
    disconnected: 'Pont bureau indisponible',
    emptyConversation: 'Cette conversation bureau n’a pas encore de messages.',
    generating: 'Génération',
    githubProject: 'Ouvrir le dépôt du projet',
    invalidKey: 'Clé d’accès invalide',
    loadingConversations: 'Chargement des conversations',
    loadingMessages: 'Chargement des messages bureau',
    loadingOlder: 'Chargement des messages plus anciens...',
    loadOlder: 'Charger les messages plus anciens',
    loadingOlderConversations: 'Chargement des conversations plus anciennes...',
    loadOlderConversations: 'Charger les conversations plus anciennes',
    model: 'Modèle',
    newConversation: 'Nouvelle conversation',
    conversationHistory: 'Historique des conversations',
    noAgents: 'Aucun agent bureau configuré n’est disponible.',
    noContext: 'Aucune utilisation de contexte disponible',
    status: 'État',
    tasks: 'Tâches',
    subagents: 'Sous-agents',
    artifacts: 'Artefacts',
    contextUsage: 'Utilisation du contexte',
    runtimeDetails: 'Connexion WebUI',
    filePreviewPending: 'L’aperçu des fichiers sera disponible dans une prochaine mise à jour.',
    files: 'Fichiers',
    searchFiles: 'Rechercher des fichiers',
    refreshFiles: 'Actualiser les fichiers',
    loadingFiles: 'Chargement des fichiers',
    filesEmpty: 'Aucun fichier dans l’espace de travail',
    noSearchResults: 'Aucun fichier correspondant',
    selectFile: 'Sélectionnez un fichier à prévisualiser',
    backToFiles: 'Retour aux fichiers',
    fileUnavailable: 'Ce fichier est indisponible.',
    fileAuthRequired: 'Configurez une clé d’accès WebUI pour parcourir les fichiers de l’espace de travail.',
    fileTooLarge: 'Ce fichier est trop volumineux pour l’aperçu.',
    binaryUnavailable: 'Ce format binaire n’est pas disponible dans l’aperçu de base.',
    statusPending: 'En attente',
    statusRunning: 'En cours',
    statusCompleted: 'Terminé',
    statusError: 'Erreur',
    contextAutocompactBuffer: 'Tampon d’autocompaction',
    contextCustomAgents: 'Agents personnalisés',
    contextFreeSpace: 'Espace libre',
    contextMcpTools: 'Outils MCP',
    contextMemoryFiles: 'Fichiers mémoire',
    contextMessages: 'Messages',
    contextPlugins: 'Plugins',
    contextSkills: 'Compétences',
    contextSystemPrompt: 'Invite système',
    contextSystemTools: 'Outils système',
    noSessions: 'Aucune session bureau pour le moment',
    reasoning: 'Raisonnement',
    processDetails: 'Détails du traitement',
    toolCalls: 'Appels d’outils',
    processingTime: 'Traité en',
    requestAborted: 'La génération a été interrompue',
    runtime: 'Runtime',
    selectConversation: 'Sélectionner une conversation',
    selectFirst: 'Sélectionnez d’abord une conversation bureau',
    send: 'Envoyer',
    sendPlaceholder:
      'Saisissez un message. Entrée pour envoyer, Maj+Entrée pour une nouvelle ligne. Tapez / pour rechercher des compétences ou commandes.',
    serviceStarted: 'Démarré',
    sessionsChanged: 'La conversation bureau sélectionnée n’est plus disponible.',
    sseClients: 'Clients SSE',
    stop: 'Arrêter',
    stopped: 'Arrêté',
    switchToDark: 'Passer au thème sombre',
    switchToLight: 'Passer au thème clair',
    attachmentPending: 'Ajouter un fichier',
    attachmentLimit: 'Jusqu’à 5 fichiers, 10 Mo chacun et 25 Mo au total.',
    attachmentReadFailed: 'Impossible de lire le fichier sélectionné.',
    removeAttachment: 'Retirer la pièce jointe',
    backToBottom: 'Retour en bas',
    resizeComposer: 'Redimensionner la zone de saisie',
    newConversationTool: 'Nouvelle conversation',
    thinkingPending: 'Longueur du raisonnement',
    thinkingUnavailable: 'Le runtime Agent bureau actuel n’expose pas le contrôle de la longueur du raisonnement.',
    reasoningDefault: 'Par défaut',
    reasoningNone: 'Désactivé',
    reasoningMinimal: 'Minimal',
    reasoningLow: 'Faible',
    reasoningMedium: 'Moyen',
    reasoningHigh: 'Élevé',
    reasoningXhigh: 'Très élevé',
    reasoningAuto: 'Auto',
    unavailable: 'Indisponible',
    verify: 'Vérifier',
    webui: 'WebUI',
    webUiVersion: 'WebUI',
    approveTool: 'Autoriser',
    denyTool: 'Refuser',
    approvalSubmitting: 'Envoi…',
    approvalReadonly: 'Approbation requise — ouvrez l’application bureau si les boutons sont indisponibles.',
    approvalFailed: 'Échec de l’envoi de l’approbation de l’outil.',
    toolPermissionConfirmation: 'Permission d’outil',
    toolPermissionPending: 'En attente',
    permissionMode: 'Mode d’autorisation',
    permissionModeDefault: 'Normal',
    permissionModePlan: 'Planifier',
    permissionModeAcceptEdits: 'Édition auto',
    permissionModeBypass: 'Entièrement auto',
    permissionModeDefaultDesc: 'Lecture libre. Demander avant les modifications ou commandes.',
    permissionModePlanDesc: 'Lecture et planification uniquement. Pas de modifications ni de commandes.',
    permissionModeAcceptEditsDesc: 'Lecture et édition libres. Demander avant les commandes.',
    permissionModeBypassDesc: 'Tout exécuter sans demander. À utiliser avec prudence.'
  },
  'es-ES': {
    agent: 'Agente',
    appVersion: 'Cherry Studio',
    authDescription: 'Introduce la clave de acceso de WebUI configurada en Cherry Studio.',
    authKey: 'Clave de acceso',
    authTitle: 'Verificación de WebUI',
    bridgeStatus: 'Estado del puente',
    changeLanguage: 'Cambiar idioma',
    cancel: 'Cancelar',
    checkingBridge: 'Comprobando el puente de escritorio',
    close: 'Cerrar',
    connected: 'Puente de escritorio conectado',
    context: 'Contexto',
    copy: 'Copiar',
    copyMarkdown: 'Copiar Markdown',
    copyPlainText: 'Copiar texto sin formato',
    copyCode: 'Copiar código',
    copySource: 'Copiar origen',
    downloadSource: 'Descargar origen',
    previewMode: 'Vista previa',
    sourceMode: 'Origen',
    wrapLines: 'Ajustar líneas',
    unwrapLines: 'Desactivar ajuste de líneas',
    copied: 'Copiado',
    openPath: 'Abrir ruta',
    pathInputPlaceholder: 'Introduce una ruta de carpeta de solo lectura',
    readAloud: 'Leer en voz alta',
    stopReading: 'Detener lectura',
    speechUnavailable: 'La síntesis de voz no está disponible en este navegador.',
    speechPanel: 'Voz',
    speechRate: 'Velocidad',
    speechPitch: 'Tono',
    speechVolume: 'Volumen',
    speechVoice: 'Voz',
    speechVoiceDefault: 'Predeterminada del sistema',
    speechPreview: 'Vista previa',
    speechPreviewSample: 'Hola, esta es una vista previa de voz de Cherry Studio WebUI.',
    speechReset: 'Restablecer valores',
    speechEmptyContent: 'Este mensaje no tiene texto legible.',
    speechGeneratingBlocked: 'La lectura no está disponible mientras se genera el mensaje.',
    speechPlay: 'Reproducir',
    speechPause: 'Pausa',
    speechStop: 'Detener',
    speechPreviousSentence: 'Frase anterior',
    speechNextSentence: 'Frase siguiente',
    speechPreviousParagraph: 'Párrafo anterior',
    speechNextParagraph: 'Párrafo siguiente',
    speechAutoOpenPanel: 'Abrir el panel de voz al leer en voz alta',
    speechAutoOpenPanelHint: 'Si está activado, al leer en voz alta se abre la pestaña Voz de la derecha.',
    speechTransport: 'Controles de reproducción',
    speechProgress: 'Progreso',
    speechNoActiveReading: 'No hay una sesión de lectura activa.',
    speechIdleHint: 'Selecciona Leer en voz alta en un mensaje para empezar.',
    attachmentPreview: 'Vista previa del archivo adjunto',
    attachmentPreviewUnavailable: 'Este archivo adjunto no se puede previsualizar.',
    attachmentPreviewOpenFailed: 'No se pudo abrir el archivo adjunto.',
    deleteConversation: 'Eliminar conversación',
    deleteConversationDescription:
      'Esta conversación y sus mensajes se eliminarán de la app de escritorio y no se podrán restaurar.',
    delete: 'Eliminar',
    editTitle: 'Editar título',
    generateTopicName: 'Generar nombre del tema',
    generatingTopicName: 'Generando título...',
    help: 'Ayuda',
    helpGuide: 'Guía de uso',
    helpGuideIntro: 'Usa la WebUI para continuar las sesiones de Agent de escritorio desde este navegador.',
    helpGuideSessions:
      'Sesiones: crea, cambia, renombra, genera nombres de tema o elimina registros desde la barra lateral izquierda.',
    helpGuideStatus:
      'Estado: revisa el uso de contexto, tareas en curso, llamadas a herramientas, subagentes y artefactos desde el panel derecho.',
    helpGuideFiles:
      'Archivos: explora y previsualiza el espacio de trabajo o archivos locales permitidos en solo lectura cuando haya una clave de acceso configurada.',
    helpGuidePreview:
      'Vista previa: Markdown, texto, código y archivos tipo script ofrecen acciones de barra de herramientas para copiar, ver origen, ajustar líneas y descargar.',
    helpGuideSpeech:
      'Voz: ajusta la síntesis de voz del navegador en la pestaña Voz; la disponibilidad depende del navegador y de las voces del sistema.',
    helpGuideSecurity:
      'Seguridad: la WebUI mantiene las vistas previas en solo lectura y no accede directamente a IPC, bases de datos ni al núcleo de IA.',
    renameTitle: 'Renombrar conversación',
    save: 'Guardar',
    saving: 'Guardando...',
    titleRequired: 'El título no puede estar vacío.',
    deleteMessage: '¿Eliminar este mensaje?',
    deleteMessageDescription: 'Este mensaje se eliminará de la conversación de escritorio y no se podrá restaurar.',
    deleting: 'Eliminando...',
    create: 'Crear',
    creating: 'Creando...',
    desktopSession: 'Sesión de escritorio',
    disconnected: 'Puente de escritorio no disponible',
    emptyConversation: 'Esta conversación de escritorio aún no tiene mensajes.',
    generating: 'Generando',
    githubProject: 'Abrir repositorio del proyecto',
    invalidKey: 'Clave de acceso no válida',
    loadingConversations: 'Cargando conversaciones',
    loadingMessages: 'Cargando mensajes de escritorio',
    loadingOlder: 'Cargando mensajes anteriores...',
    loadOlder: 'Cargar mensajes anteriores',
    loadingOlderConversations: 'Cargando conversaciones anteriores...',
    loadOlderConversations: 'Cargar conversaciones anteriores',
    model: 'Modelo',
    newConversation: 'Nueva conversación',
    conversationHistory: 'Historial de conversaciones',
    noAgents: 'No hay agentes de escritorio configurados disponibles.',
    noContext: 'No hay uso de contexto disponible',
    status: 'Estado',
    tasks: 'Tareas',
    subagents: 'Subagentes',
    artifacts: 'Artefactos',
    contextUsage: 'Uso de contexto',
    runtimeDetails: 'Conexión WebUI',
    filePreviewPending: 'La vista previa de archivos estará disponible en una actualización posterior.',
    files: 'Archivos',
    searchFiles: 'Buscar archivos',
    refreshFiles: 'Actualizar archivos',
    loadingFiles: 'Cargando archivos',
    filesEmpty: 'No hay archivos en el espacio de trabajo',
    noSearchResults: 'No hay archivos coincidentes',
    selectFile: 'Selecciona un archivo para previsualizar',
    backToFiles: 'Volver a archivos',
    fileUnavailable: 'Este archivo no está disponible.',
    fileAuthRequired: 'Configura una clave de acceso WebUI para explorar los archivos del espacio de trabajo.',
    fileTooLarge: 'Este archivo es demasiado grande para previsualizarlo.',
    binaryUnavailable: 'Este formato binario no está disponible en la vista previa básica.',
    statusPending: 'Pendiente',
    statusRunning: 'En curso',
    statusCompleted: 'Completado',
    statusError: 'Error',
    contextAutocompactBuffer: 'Búfer de autocompactación',
    contextCustomAgents: 'Agentes personalizados',
    contextFreeSpace: 'Espacio libre',
    contextMcpTools: 'Herramientas MCP',
    contextMemoryFiles: 'Archivos de memoria',
    contextMessages: 'Mensajes',
    contextPlugins: 'Complementos',
    contextSkills: 'Habilidades',
    contextSystemPrompt: 'Indicación del sistema',
    contextSystemTools: 'Herramientas del sistema',
    noSessions: 'Aún no hay sesiones de escritorio',
    reasoning: 'Razonamiento',
    processDetails: 'Detalles del procesamiento',
    toolCalls: 'Llamadas a herramientas',
    processingTime: 'Procesado en',
    requestAborted: 'La generación se interrumpió',
    runtime: 'Tiempo de ejecución',
    selectConversation: 'Seleccionar una conversación',
    selectFirst: 'Selecciona primero una conversación de escritorio',
    send: 'Enviar',
    sendPlaceholder:
      'Escribe un mensaje. Intro para enviar, Mayús+Intro para nueva línea. Escribe / para buscar habilidades o comandos.',
    serviceStarted: 'Iniciado',
    sessionsChanged: 'La conversación de escritorio seleccionada ya no está disponible.',
    sseClients: 'Clientes SSE',
    stop: 'Detener',
    stopped: 'Detenido',
    switchToDark: 'Cambiar a tema oscuro',
    switchToLight: 'Cambiar a tema claro',
    attachmentPending: 'Añadir archivo',
    attachmentLimit: 'Hasta 5 archivos, 10 MB cada uno y 25 MB en total.',
    attachmentReadFailed: 'No se pudo leer el archivo seleccionado.',
    removeAttachment: 'Quitar archivo adjunto',
    backToBottom: 'Ir al final',
    resizeComposer: 'Redimensionar el cuadro de mensaje',
    newConversationTool: 'Nueva conversación',
    thinkingPending: 'Longitud del razonamiento',
    thinkingUnavailable: 'El runtime actual del Agent de escritorio no expone el control de longitud del razonamiento.',
    reasoningDefault: 'Predeterminado',
    reasoningNone: 'Desactivado',
    reasoningMinimal: 'Mínimo',
    reasoningLow: 'Bajo',
    reasoningMedium: 'Medio',
    reasoningHigh: 'Alto',
    reasoningXhigh: 'Muy alto',
    reasoningAuto: 'Automático',
    unavailable: 'No disponible',
    verify: 'Verificar',
    webui: 'WebUI',
    webUiVersion: 'WebUI',
    approveTool: 'Permitir',
    denyTool: 'Denegar',
    approvalSubmitting: 'Enviando…',
    approvalReadonly: 'Se requiere aprobación — abre la app de escritorio si los botones no están disponibles.',
    approvalFailed: 'No se pudo enviar la aprobación de la herramienta.',
    toolPermissionConfirmation: 'Permiso de herramienta',
    toolPermissionPending: 'Pendiente',
    permissionMode: 'Modo de permiso',
    permissionModeDefault: 'Normal',
    permissionModePlan: 'Planificar',
    permissionModeAcceptEdits: 'Edición automática',
    permissionModeBypass: 'Totalmente automático',
    permissionModeDefaultDesc: 'Leer libremente. Preguntar antes de editar o ejecutar comandos.',
    permissionModePlanDesc: 'Solo leer y planificar. Sin ediciones ni comandos.',
    permissionModeAcceptEditsDesc: 'Leer y editar libremente. Preguntar antes de los comandos.',
    permissionModeBypassDesc: 'Hacerlo todo sin preguntar. Úsalo con precaución.'
  },
  'ru-RU': {
    agent: 'Агент',
    appVersion: 'Cherry Studio',
    authDescription: 'Введите ключ доступа WebUI, настроенный в Cherry Studio.',
    authKey: 'Ключ доступа',
    authTitle: 'Проверка WebUI',
    bridgeStatus: 'Состояние моста',
    changeLanguage: 'Сменить язык',
    cancel: 'Отмена',
    checkingBridge: 'Проверка моста рабочего стола',
    close: 'Закрыть',
    connected: 'Мост рабочего стола подключён',
    context: 'Контекст',
    copy: 'Копировать',
    copyMarkdown: 'Копировать Markdown',
    copyPlainText: 'Копировать обычный текст',
    copyCode: 'Копировать код',
    copySource: 'Копировать исходник',
    downloadSource: 'Скачать исходник',
    previewMode: 'Просмотр',
    sourceMode: 'Исходник',
    wrapLines: 'Перенос строк',
    unwrapLines: 'Отключить перенос строк',
    copied: 'Скопировано',
    openPath: 'Открыть путь',
    pathInputPlaceholder: 'Введите путь к папке только для чтения',
    readAloud: 'Озвучить',
    stopReading: 'Остановить озвучивание',
    speechUnavailable: 'Синтез речи недоступен в этом браузере.',
    speechPanel: 'Речь',
    speechRate: 'Скорость',
    speechPitch: 'Высота',
    speechVolume: 'Громкость',
    speechVoice: 'Голос',
    speechVoiceDefault: 'Системный по умолчанию',
    speechPreview: 'Проверка',
    speechPreviewSample: 'Здравствуйте, это предварительное прослушивание речи Cherry Studio WebUI.',
    speechReset: 'Сбросить настройки',
    speechEmptyContent: 'В этом сообщении нет текста для озвучивания.',
    speechGeneratingBlocked: 'Озвучивание недоступно, пока сообщение генерируется.',
    speechPlay: 'Воспроизвести',
    speechPause: 'Пауза',
    speechStop: 'Стоп',
    speechPreviousSentence: 'Предыдущее предложение',
    speechNextSentence: 'Следующее предложение',
    speechPreviousParagraph: 'Предыдущий абзац',
    speechNextParagraph: 'Следующий абзац',
    speechAutoOpenPanel: 'Открывать панель речи при озвучивании',
    speechAutoOpenPanelHint: 'Если включено, озвучивание открывает правую вкладку «Речь».',
    speechTransport: 'Управление воспроизведением',
    speechProgress: 'Прогресс',
    speechNoActiveReading: 'Нет активной сессии озвучивания.',
    speechIdleHint: 'Выберите «Озвучить» у сообщения, чтобы начать.',
    attachmentPreview: 'Просмотр вложения',
    attachmentPreviewUnavailable: 'Это вложение нельзя просмотреть.',
    attachmentPreviewOpenFailed: 'Не удалось открыть вложение.',
    deleteConversation: 'Удалить беседу',
    deleteConversationDescription:
      'Эта беседа и её сообщения будут удалены из приложения рабочего стола и не могут быть восстановлены.',
    delete: 'Удалить',
    editTitle: 'Изменить название',
    generateTopicName: 'Сгенерировать название темы',
    generatingTopicName: 'Генерация названия...',
    help: 'Справка',
    helpGuide: 'Руководство',
    helpGuideIntro: 'Используйте WebUI, чтобы продолжать сессии Agent рабочего стола из этого браузера.',
    helpGuideSessions:
      'Сессии: создавайте, переключайте, переименовывайте, генерируйте названия тем или удаляйте записи в левой боковой панели.',
    helpGuideStatus:
      'Статус: просматривайте использование контекста, задачи, вызовы инструментов, субагентов и артефакты в правой панели.',
    helpGuideFiles:
      'Файлы: просматривайте рабочую область или разрешённые локальные файлы в режиме только чтения при настроенном ключе доступа.',
    helpGuidePreview:
      'Просмотр: Markdown, текст, код и скриптовые файлы поддерживают копирование, исходный вид, перенос строк и скачивание.',
    helpGuideSpeech:
      'Речь: настройте синтез речи браузера во вкладке «Речь»; доступность зависит от браузера и системных голосов.',
    helpGuideSecurity:
      'Безопасность: WebUI оставляет предпросмотр файлов только для чтения и не обращается напрямую к IPC, базам данных или ядру ИИ.',
    renameTitle: 'Переименовать беседу',
    save: 'Сохранить',
    saving: 'Сохранение...',
    titleRequired: 'Название не может быть пустым.',
    deleteMessage: 'Удалить это сообщение?',
    deleteMessageDescription: 'Это сообщение будет удалено из беседы рабочего стола и не может быть восстановлено.',
    deleting: 'Удаление...',
    create: 'Создать',
    creating: 'Создание...',
    desktopSession: 'Сессия рабочего стола',
    disconnected: 'Мост рабочего стола недоступен',
    emptyConversation: 'В этой беседе рабочего стола пока нет сообщений.',
    generating: 'Генерация',
    githubProject: 'Открыть репозиторий проекта',
    invalidKey: 'Недействительный ключ доступа',
    loadingConversations: 'Загрузка бесед',
    loadingMessages: 'Загрузка сообщений рабочего стола',
    loadingOlder: 'Загрузка более ранних сообщений...',
    loadOlder: 'Загрузить более ранние сообщения',
    loadingOlderConversations: 'Загрузка более ранних бесед...',
    loadOlderConversations: 'Загрузить более ранние беседы',
    model: 'Модель',
    newConversation: 'Новая беседа',
    conversationHistory: 'История бесед',
    noAgents: 'Нет доступных настроенных агентов рабочего стола.',
    noContext: 'Нет данных об использовании контекста',
    status: 'Статус',
    tasks: 'Задачи',
    subagents: 'Субагенты',
    artifacts: 'Артефакты',
    contextUsage: 'Использование контекста',
    runtimeDetails: 'Подключение WebUI',
    filePreviewPending: 'Предпросмотр файлов появится в следующем обновлении.',
    files: 'Файлы',
    searchFiles: 'Поиск файлов',
    refreshFiles: 'Обновить файлы',
    loadingFiles: 'Загрузка файлов',
    filesEmpty: 'В рабочей области нет файлов',
    noSearchResults: 'Нет подходящих файлов',
    selectFile: 'Выберите файл для просмотра',
    backToFiles: 'Назад к файлам',
    fileUnavailable: 'Этот файл недоступен.',
    fileAuthRequired: 'Настройте ключ доступа WebUI, чтобы просматривать файлы рабочей области.',
    fileTooLarge: 'Файл слишком большой для предпросмотра.',
    binaryUnavailable: 'Этот двоичный формат недоступен в базовом предпросмотре.',
    statusPending: 'Ожидание',
    statusRunning: 'Выполняется',
    statusCompleted: 'Завершено',
    statusError: 'Ошибка',
    contextAutocompactBuffer: 'Буфер автосжатия',
    contextCustomAgents: 'Пользовательские агенты',
    contextFreeSpace: 'Свободное место',
    contextMcpTools: 'Инструменты MCP',
    contextMemoryFiles: 'Файлы памяти',
    contextMessages: 'Сообщения',
    contextPlugins: 'Плагины',
    contextSkills: 'Навыки',
    contextSystemPrompt: 'Системный промпт',
    contextSystemTools: 'Системные инструменты',
    noSessions: 'Пока нет сессий рабочего стола',
    reasoning: 'Рассуждение',
    processDetails: 'Сведения об обработке',
    toolCalls: 'Вызовы инструментов',
    processingTime: 'Обработано за',
    requestAborted: 'Генерация была прервана',
    runtime: 'Среда выполнения',
    selectConversation: 'Выберите беседу',
    selectFirst: 'Сначала выберите беседу рабочего стола',
    send: 'Отправить',
    sendPlaceholder:
      'Введите сообщение. Enter — отправить, Shift+Enter — новая строка. Введите /, чтобы искать навыки или команды.',
    serviceStarted: 'Запущено',
    sessionsChanged: 'Выбранная беседа рабочего стола больше недоступна.',
    sseClients: 'SSE-клиенты',
    stop: 'Остановить',
    stopped: 'Остановлено',
    switchToDark: 'Переключить на тёмную тему',
    switchToLight: 'Переключить на светлую тему',
    attachmentPending: 'Добавить файл',
    attachmentLimit: 'До 5 файлов, по 10 МБ каждый и 25 МБ всего.',
    attachmentReadFailed: 'Не удалось прочитать выбранный файл.',
    removeAttachment: 'Удалить вложение',
    backToBottom: 'К концу',
    resizeComposer: 'Изменить размер поля ввода',
    newConversationTool: 'Новая беседа',
    thinkingPending: 'Длина рассуждения',
    thinkingUnavailable: 'Текущая среда Agent рабочего стола не предоставляет управление длиной рассуждения.',
    reasoningDefault: 'По умолчанию',
    reasoningNone: 'Выкл.',
    reasoningMinimal: 'Минимальный',
    reasoningLow: 'Низкий',
    reasoningMedium: 'Средний',
    reasoningHigh: 'Высокий',
    reasoningXhigh: 'Очень высокий',
    reasoningAuto: 'Авто',
    unavailable: 'Недоступно',
    verify: 'Проверить',
    webui: 'WebUI',
    webUiVersion: 'WebUI',
    approveTool: 'Разрешить',
    denyTool: 'Отклонить',
    approvalSubmitting: 'Отправка…',
    approvalReadonly: 'Требуется подтверждение — откройте приложение рабочего стола, если кнопки недоступны.',
    approvalFailed: 'Не удалось отправить подтверждение инструмента.',
    toolPermissionConfirmation: 'Разрешение инструмента',
    toolPermissionPending: 'Ожидание',
    permissionMode: 'Режим разрешений',
    permissionModeDefault: 'Обычный',
    permissionModePlan: 'План',
    permissionModeAcceptEdits: 'Автоправка',
    permissionModeBypass: 'Полный авто',
    permissionModeDefaultDesc: 'Чтение свободно. Спрашивать перед правками или командами.',
    permissionModePlanDesc: 'Только чтение и планирование. Без правок и команд.',
    permissionModeAcceptEditsDesc: 'Чтение и правки свободно. Спрашивать перед командами.',
    permissionModeBypassDesc: 'Делать всё без запроса. Используйте осторожно.'
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

type ComposerToolIconName = 'attachment' | 'newConversation' | 'thinking' | 'permission'

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

  if (name === 'permission') {
    // Shield-check: permission / policy control (aligns with desktop permission mode affordance).
    return h('svg', baseProps, [
      h('path', { d: 'M12 3 5 6v6c0 4.5 3 7.5 7 9 4-1.5 7-4.5 7-9V6l-7-3z' }),
      h('path', { d: 'm9 12 2 2 4-4' })
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
  | 'copy'
  | 'download'
  | 'source'
  | 'wrap'
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

  if (name === 'copy')
    return h('svg', props, [
      h('rect', { x: 9, y: 9, width: 11, height: 11, rx: 2 }),
      h('path', { d: 'M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1' })
    ])
  if (name === 'download')
    return h('svg', props, [
      h('path', { d: 'M12 3v12' }),
      h('path', { d: 'm7 10 5 5 5-5' }),
      h('path', { d: 'M5 21h14' })
    ])
  if (name === 'source') return h('svg', props, [h('path', { d: 'm8 18-6-6 6-6' }), h('path', { d: 'm16 6 6 6-6 6' })])
  if (name === 'wrap')
    return h('svg', props, [
      h('path', { d: 'M3 7h14a4 4 0 0 1 0 8H7' }),
      h('path', { d: 'm10 12-3 3 3 3' }),
      h('path', { d: 'M3 19h8' })
    ])
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
    const approvalId =
      typeof part.approval?.id === 'string' && part.approval.id.trim() ? part.approval.id.trim() : undefined
    const tool: WebUiToolCallSnapshot = {
      id,
      name: toToolName(part.type, part.toolName),
      state: toToolState(state),
      ...(approvalId ? { approvalId } : {}),
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
    .map((part) => {
      const fileEntryId = part.providerMetadata?.cherry?.fileEntryId
      return {
        name: part.filename || 'Attachment',
        ...(part.mediaType ? { mediaType: part.mediaType } : {}),
        ...(fileEntryId ? { fileEntryId } : {})
      }
    })
  const processingTimeMs =
    message.stats?.timeCompletionMs ??
    message.stats?.timeThinkingMs ??
    parts.find((part) => part.type === 'reasoning')?.providerMetadata?.cherry?.thinkingMs
  const modelId = typeof message.modelId === 'string' && message.modelId.trim() ? message.modelId : undefined

  return {
    id: message.id,
    conversationId: message.sessionId,
    role: message.role,
    content: content || message.searchableText || '',
    ...(reasoning ? { reasoning } : {}),
    ...(toolCalls.length ? { toolCalls } : {}),
    ...(agentStatusEvents.length ? { agentStatusEvents } : {}),
    ...(attachments.length ? { attachments } : {}),
    ...(modelId ? { modelId } : {}),
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
    const speechPanelPreferences = ref<SpeechPanelPreferences>(loadSpeechPanelPreferences())
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
    const workspacePreviewMode = ref<'preview' | 'source'>('preview')
    const workspacePreviewWrap = ref(false)
    const slashCommands = ref<readonly WebUiSlashCommand[]>([])
    const modelPickerOpen = ref(false)
    const reasoningPickerOpen = ref(false)
    const permissionModePickerOpen = ref(false)
    const reasoningEffort = ref('default')
    const modelUpdateState = ref<'idle' | 'updating' | 'error'>('idle')
    const permissionModeUpdateState = ref<'idle' | 'updating' | 'error'>('idle')
    /** Optimistic submit keys: `${messageId}:${toolCallId}` */
    const approvalSubmittingKeys = ref<ReadonlySet<string>>(new Set())
    const approvalErrorByKey = ref<Readonly<Record<string, string>>>({})
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
    const conversationNav = ref<HTMLElement>()
    const olderConversationsCursor = ref<string>()
    const olderConversationsLoading = ref(false)
    const showScrollToBottom = ref(false)
    const composerHeight = ref(composerDefaultHeight)
    const deleteMessageId = ref<string>()
    const messageDeleteState = ref<'idle' | 'deleting' | 'error'>('idle')
    const messageDeleteError = ref('')
    const speechState = ref<SpeechSynthesisControllerState>({
      isSpeaking: false,
      isPaused: false,
      segmentIndex: 0,
      segmentCount: 0,
      paragraphIndex: 0,
      paragraphCount: 0
    })
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
    const selectedPermissionMode = computed<WebUiPermissionMode>(() => {
      const mode = selectedAgent.value?.configuration?.permission_mode
      if (mode === 'plan' || mode === 'acceptEdits' || mode === 'bypassPermissions' || mode === 'default') return mode
      return 'default'
    })
    const permissionModeCards = computed(
      () =>
        [
          {
            mode: 'default' as const,
            titleKey: 'permissionModeDefault' as const,
            descriptionKey: 'permissionModeDefaultDesc' as const
          },
          {
            mode: 'plan' as const,
            titleKey: 'permissionModePlan' as const,
            descriptionKey: 'permissionModePlanDesc' as const
          },
          {
            mode: 'acceptEdits' as const,
            titleKey: 'permissionModeAcceptEdits' as const,
            descriptionKey: 'permissionModeAcceptEditsDesc' as const
          },
          {
            mode: 'bypassPermissions' as const,
            titleKey: 'permissionModeBypass' as const,
            descriptionKey: 'permissionModeBypassDesc' as const
          }
        ] as const
    )
    const permissionModeLabel = computed(() => {
      const card = permissionModeCards.value.find((item) => item.mode === selectedPermissionMode.value)
      return card ? text(card.titleKey) : text('permissionModeDefault')
    })
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
    /** Resolve display model name for an assistant message (session snapshot → live agent). */
    const messageModelLabel = (message: WebUiMessageSnapshot) => {
      if (message.role !== 'assistant') return ''
      if (message.modelId) {
        const fromCatalog = models.value.find((model) => model.id === message.modelId)
        if (fromCatalog?.name) return fromCatalog.name
        const bareId = message.modelId.includes('::')
          ? (message.modelId.split('::').pop() ?? message.modelId)
          : message.modelId
        return bareId
      }
      return selectedModel.value?.name ?? selectedAgent.value?.modelName ?? selectedAgent.value?.model ?? ''
    }
    const messageHeaderLabel = (message: WebUiMessageSnapshot) => {
      const author = messageAuthorName(message.role)
      if (message.role !== 'assistant') return author
      const modelLabel = messageModelLabel(message)
      return modelLabel ? `${author} · ${modelLabel}` : author
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
      // Toast payload is the visible microcopy (usually text('copied')).
      // Keep a unique stamp so rapid successive copies still reset the timer.
      const stamp = `${label}::${Date.now()}`
      copiedHint.value = stamp
      window.setTimeout(() => {
        if (copiedHint.value === stamp) copiedHint.value = undefined
      }, 1600)
    }
    const renderCopiedToast = () => {
      const raw = copiedHint.value
      if (!raw) return undefined
      const base = raw.includes('::') ? raw.slice(0, raw.lastIndexOf('::')) : raw
      const label = base === text('downloadSource') ? text('downloadSource') : text('copied')
      return h(
        'div',
        {
          class: 'webui-copy-toast',
          role: 'status',
          'aria-live': 'polite'
        },
        label
      )
    }
    const markdownToPlainText = (value: string) => {
      const container = document.createElement('div')
      container.innerHTML = renderMarkdown(value, {
        copyCodeLabel: text('copyCode'),
        downloadCodeLabel: text('downloadSource'),
        wrapLinesLabel: text('wrapLines')
      })
      return (container.textContent ?? value).trim()
    }
    const isReadingMessage = (messageId: string) =>
      Boolean(speechState.value.messageId === messageId && speechState.value.isSpeaking)
    const hasActiveSpeechSession = computed(() => Boolean(speechState.value.messageId) && speechState.value.isSpeaking)
    const isSpeechPaused = computed(() => speechState.value.isPaused)
    const isSpeechPlaying = computed(() => speechState.value.isSpeaking && !speechState.value.isPaused)
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
    const persistSpeechPanelPreferences = (next: SpeechPanelPreferences) => {
      speechPanelPreferences.value = next
      saveSpeechPanelPreferences(next)
    }
    const updateSpeechAutoOpenPanel = (enabled: boolean) => {
      persistSpeechPanelPreferences({ ...speechPanelPreferences.value, autoOpenPanel: enabled })
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
    const handleSpeechPlayPause = () => {
      if (!speechController.refreshSupport()) {
        showSpeechNotice(text('speechUnavailable'))
        return
      }
      if (isSpeechPlaying.value) {
        speechController.pause()
        return
      }
      if (isSpeechPaused.value || hasActiveSpeechSession.value) {
        speechController.play()
      }
    }
    const handleSpeechStop = () => {
      speechController.stop()
    }
    const handleSpeechPreviousSentence = () => {
      speechController.previousSentence()
    }
    const handleSpeechNextSentence = () => {
      speechController.nextSentence()
    }
    const handleSpeechPreviousParagraph = () => {
      speechController.previousParagraph()
    }
    const handleSpeechNextParagraph = () => {
      speechController.nextParagraph()
    }
    const renderSpeechTransportButton = (
      label: string,
      onClick: () => void,
      options?: { readonly disabled?: boolean; readonly active?: boolean; readonly caution?: boolean }
    ) =>
      h(
        'button',
        {
          class: [
            'speech-transport-button',
            {
              'speech-transport-button-active': Boolean(options?.active),
              'speech-transport-button-caution': Boolean(options?.caution)
            }
          ],
          type: 'button',
          disabled: Boolean(options?.disabled) || !speechController.isSupported,
          title: label,
          'aria-label': label,
          onClick
        },
        label
      )
    const renderSpeechPanel = () => {
      const state = speechState.value
      const sessionActive = hasActiveSpeechSession.value
      const progressLabel = sessionActive
        ? `${text('speechProgress')}: ${state.segmentIndex + 1}/${Math.max(state.segmentCount, 1)} · ${state.paragraphIndex + 1}/${Math.max(state.paragraphCount, 1)}`
        : text('speechNoActiveReading')

      return h('div', { class: 'speech-settings-panel' }, [
        !speechController.isSupported
          ? h('p', { class: 'speech-settings-warning', role: 'status' }, text('speechUnavailable'))
          : undefined,
        h('section', { class: 'speech-transport-panel', 'aria-label': text('speechTransport') }, [
          h('div', { class: 'speech-transport-header' }, [
            h('h3', { class: 'speech-transport-title' }, text('speechTransport')),
            h('p', { class: 'speech-transport-progress', role: 'status' }, progressLabel)
          ]),
          h('div', { class: 'speech-transport-grid' }, [
            renderSpeechTransportButton(
              isSpeechPlaying.value ? text('speechPause') : text('speechPlay'),
              handleSpeechPlayPause,
              {
                disabled: !sessionActive && !isSpeechPaused.value,
                active: isSpeechPlaying.value
              }
            ),
            renderSpeechTransportButton(text('speechStop'), handleSpeechStop, {
              disabled: !sessionActive,
              caution: true
            }),
            renderSpeechTransportButton(text('speechPreviousSentence'), handleSpeechPreviousSentence, {
              disabled: !sessionActive
            }),
            renderSpeechTransportButton(text('speechNextSentence'), handleSpeechNextSentence, {
              disabled: !sessionActive
            }),
            renderSpeechTransportButton(text('speechPreviousParagraph'), handleSpeechPreviousParagraph, {
              disabled: !sessionActive
            }),
            renderSpeechTransportButton(text('speechNextParagraph'), handleSpeechNextParagraph, {
              disabled: !sessionActive
            })
          ]),
          !sessionActive ? h('p', { class: 'speech-transport-hint' }, text('speechIdleHint')) : undefined
        ]),
        h('label', { class: 'speech-setting-row speech-auto-open-row' }, [
          h('div', { class: 'speech-auto-open-copy' }, [
            h('span', text('speechAutoOpenPanel')),
            h('span', { class: 'speech-auto-open-hint' }, text('speechAutoOpenPanelHint'))
          ]),
          h('input', {
            class: 'speech-auto-open-switch',
            type: 'checkbox',
            checked: speechPanelPreferences.value.autoOpenPanel,
            'aria-label': text('speechAutoOpenPanel'),
            onChange: (event: Event) => {
              updateSpeechAutoOpenPanel((event.target as HTMLInputElement).checked)
            }
          })
        ]),
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
    }
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
    const approvalKey = (messageId: string, toolId: string) => `${messageId}:${toolId}`
    const isApprovalSubmitting = (messageId: string, toolId: string) =>
      approvalSubmittingKeys.value.has(approvalKey(messageId, toolId))
    const setApprovalSubmitting = (messageId: string, toolId: string, submitting: boolean) => {
      const key = approvalKey(messageId, toolId)
      const next = new Set(approvalSubmittingKeys.value)
      if (submitting) next.add(key)
      else next.delete(key)
      approvalSubmittingKeys.value = next
    }
    const setApprovalError = (messageId: string, toolId: string, error: string) => {
      const key = approvalKey(messageId, toolId)
      if (!error) {
        if (!(key in approvalErrorByKey.value)) return
        const { [key]: _removed, ...rest } = approvalErrorByKey.value
        approvalErrorByKey.value = rest
        return
      }
      approvalErrorByKey.value = { ...approvalErrorByKey.value, [key]: error }
    }
    const respondToolApproval = async (
      tool: WebUiToolCallSnapshot,
      message: WebUiMessageSnapshot,
      approved: boolean
    ) => {
      const conversationId = selectedConversationId.value
      const approvalId = tool.approvalId
      if (!conversationId || !approvalId || isApprovalSubmitting(message.id, tool.id)) return

      setApprovalSubmitting(message.id, tool.id, true)
      setApprovalError(message.id, tool.id, '')
      try {
        await httpClient.postJson<WebUiToolApprovalResponse>(
          `/api/agent-sessions/${encodeURIComponent(conversationId)}/tool-approvals`,
          {
            approvalId,
            approved,
            ...(approved ? {} : { reason: text('denyTool') })
          }
        )
      } catch (error) {
        setApprovalSubmitting(message.id, tool.id, false)
        setApprovalError(message.id, tool.id, localizedErrorMessage(error) || text('approvalFailed'))
      }
    }

    /** Latest tool awaiting approval — drives the composer overlay (desktop-style). */
    type PendingToolApproval = {
      readonly message: WebUiMessageSnapshot
      readonly tool: WebUiToolCallSnapshot
    }
    const pendingToolApproval = computed((): PendingToolApproval | null => {
      let latest: PendingToolApproval | null = null
      for (const message of messages.value) {
        for (const tool of message.toolCalls ?? []) {
          if (tool.state !== 'approval-requested') continue
          latest = { message, tool }
        }
      }
      return latest
    })

    const truncateApprovalPreview = (value: string | undefined, max = 1200) => {
      if (!value) return ''
      const trimmed = value.trim()
      if (trimmed.length <= max) return trimmed
      return `${trimmed.slice(0, max)}…`
    }

    const renderPermissionRequestPanel = () => {
      const pending = pendingToolApproval.value
      if (!pending) return undefined

      const { message, tool } = pending
      const submitting = isApprovalSubmitting(message.id, tool.id)
      const approvalError = approvalErrorByKey.value[approvalKey(message.id, tool.id)]
      const preview = truncateApprovalPreview(tool.input)

      return h(
        'div',
        {
          class: 'permission-request-panel',
          role: 'dialog',
          'aria-labelledby': 'permission-request-title',
          'aria-modal': 'false'
        },
        [
          h('div', { class: 'permission-request-card' }, [
            h('div', { class: 'permission-request-header' }, [
              h('div', { class: 'permission-request-heading' }, [
                h('h2', { id: 'permission-request-title', class: 'permission-request-title' }, [
                  h(
                    'svg',
                    {
                      class: 'permission-request-title-icon',
                      width: 16,
                      height: 16,
                      viewBox: '0 0 24 24',
                      fill: 'none',
                      stroke: 'currentColor',
                      'stroke-width': 2,
                      'stroke-linecap': 'round',
                      'stroke-linejoin': 'round',
                      'aria-hidden': 'true'
                    },
                    [
                      h('path', {
                        d: 'M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z'
                      })
                    ]
                  ),
                  h('span', text('toolPermissionConfirmation'))
                ]),
                h('p', { class: 'permission-request-tool-name', title: tool.name }, tool.name)
              ]),
              h('span', { class: 'permission-request-badge' }, text('toolPermissionPending'))
            ]),
            preview
              ? h('div', { class: 'permission-request-preview' }, [
                  h('pre', { class: 'permission-request-preview-body' }, preview)
                ])
              : undefined,
            tool.approvalId
              ? h('div', { class: 'permission-request-actions' }, [
                  h(
                    'button',
                    {
                      class: 'permission-request-option',
                      type: 'button',
                      disabled: submitting,
                      'aria-label': text('approveTool'),
                      onClick: () => void respondToolApproval(tool, message, true)
                    },
                    [
                      h('span', { class: 'permission-request-option-index' }, '1'),
                      h(
                        'span',
                        { class: 'permission-request-option-label' },
                        submitting ? text('approvalSubmitting') : text('approveTool')
                      )
                    ]
                  ),
                  h(
                    'button',
                    {
                      class: 'permission-request-option permission-request-option-deny',
                      type: 'button',
                      disabled: submitting,
                      'aria-label': text('denyTool'),
                      onClick: () => void respondToolApproval(tool, message, false)
                    },
                    [
                      h('span', { class: 'permission-request-option-index' }, '2'),
                      h('span', { class: 'permission-request-option-label' }, text('denyTool'))
                    ]
                  )
                ])
              : h('p', { class: 'permission-request-readonly' }, text('approvalReadonly')),
            approvalError ? h('p', { class: 'permission-request-error' }, approvalError) : undefined
          ])
        ]
      )
    }

    const renderToolCall = (tool: WebUiToolCallSnapshot, message: WebUiMessageSnapshot) => {
      const submitting = isApprovalSubmitting(message.id, tool.id)
      const approvalError = approvalErrorByKey.value[approvalKey(message.id, tool.id)]
      const showApprovalActions = tool.state === 'approval-requested'
      return h(
        'details',
        {
          class: ['tool-call', `tool-call-${tool.state}`],
          open:
            (message.status === 'pending' && !terminalToolStates.has(tool.state)) || tool.state === 'approval-requested'
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
            tool.errorText ? h('p', { class: 'tool-call-error' }, tool.errorText) : undefined,
            showApprovalActions
              ? h('div', { class: 'tool-approval-bar' }, [
                  tool.approvalId
                    ? h('div', { class: 'tool-approval-actions' }, [
                        h(
                          'button',
                          {
                            class: 'tool-approval-button tool-approval-button-approve',
                            type: 'button',
                            disabled: submitting,
                            onClick: (event: MouseEvent) => {
                              event.preventDefault()
                              event.stopPropagation()
                              void respondToolApproval(tool, message, true)
                            }
                          },
                          submitting ? text('approvalSubmitting') : text('approveTool')
                        ),
                        h(
                          'button',
                          {
                            class: 'tool-approval-button tool-approval-button-deny',
                            type: 'button',
                            disabled: submitting,
                            onClick: (event: MouseEvent) => {
                              event.preventDefault()
                              event.stopPropagation()
                              void respondToolApproval(tool, message, false)
                            }
                          },
                          text('denyTool')
                        )
                      ])
                    : h('p', { class: 'tool-approval-readonly' }, text('approvalReadonly')),
                  approvalError ? h('p', { class: 'tool-call-error' }, approvalError) : undefined
                ])
              : undefined
          ])
        ]
      )
    }
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
                      innerHTML: renderMarkdown(message.reasoning, {
                        copyCodeLabel: text('copyCode'),
                        downloadCodeLabel: text('downloadSource'),
                        wrapLinesLabel: text('wrapLines')
                      })
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
      workspacePreviewMode.value = 'preview'
      workspacePreviewWrap.value = false
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

    const handleWorkspacePreviewCopy = async (value: string, label: string) => {
      await copyText(value)
      showCopiedHint(label)
    }

    const downloadWorkspacePreviewSource = (preview: Extract<WorkspaceFilePreviewState, { status: 'text' }>) => {
      const blob = new Blob([preview.content], { type: 'text/plain;charset=utf-8' })
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = preview.name || getWorkspacePathBasename(preview.path)
      document.body.appendChild(link)
      link.click()
      link.remove()
      URL.revokeObjectURL(url)
      showCopiedHint(text('downloadSource'))
    }

    const codeLanguageExtension = (language: string | undefined) => {
      const key = (language ?? '').trim().toLowerCase()
      const map: Record<string, string> = {
        js: 'js',
        javascript: 'js',
        jsx: 'jsx',
        ts: 'ts',
        typescript: 'ts',
        tsx: 'tsx',
        py: 'py',
        python: 'py',
        rb: 'rb',
        ruby: 'rb',
        go: 'go',
        rs: 'rs',
        rust: 'rs',
        java: 'java',
        kt: 'kt',
        kotlin: 'kt',
        c: 'c',
        cpp: 'cpp',
        'c++': 'cpp',
        cs: 'cs',
        csharp: 'cs',
        php: 'php',
        sh: 'sh',
        bash: 'sh',
        zsh: 'sh',
        shell: 'sh',
        powershell: 'ps1',
        ps1: 'ps1',
        sql: 'sql',
        json: 'json',
        yaml: 'yml',
        yml: 'yml',
        toml: 'toml',
        xml: 'xml',
        html: 'html',
        css: 'css',
        scss: 'scss',
        less: 'less',
        md: 'md',
        markdown: 'md',
        vue: 'vue',
        svelte: 'svelte',
        dockerfile: 'Dockerfile',
        docker: 'Dockerfile',
        text: 'txt',
        plaintext: 'txt',
        txt: 'txt'
      }
      return map[key] ?? (key && /^[a-z0-9.+-]+$/i.test(key) ? key : 'txt')
    }

    const downloadTextAsFile = (value: string, filename: string) => {
      const blob = new Blob([value], { type: 'text/plain;charset=utf-8' })
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = filename
      document.body.appendChild(link)
      link.click()
      link.remove()
      URL.revokeObjectURL(url)
    }

    const openMessageAttachment = async (attachment: {
      readonly name: string
      readonly mediaType?: string
      readonly fileEntryId?: string
    }) => {
      const fileEntryId = attachment.fileEntryId?.trim()
      if (!fileEntryId) {
        submitError.value = text('attachmentPreviewUnavailable')
        return
      }
      try {
        const blob = await httpClient.getBlob(`/api/files/${encodeURIComponent(fileEntryId)}`)
        const mediaType = attachment.mediaType || blob.type || 'application/octet-stream'
        const isTextLike =
          mediaType.startsWith('text/') ||
          mediaType.includes('json') ||
          mediaType.includes('xml') ||
          mediaType.includes('javascript') ||
          mediaType.includes('markdown') ||
          /\.(txt|md|json|csv|log|xml|yml|yaml|ts|tsx|js|jsx|py|go|rs|java|c|cpp|h|css|html|sh|bat|ps1)$/i.test(
            attachment.name
          )
        const isImage = mediaType.startsWith('image/')
        const isPdf = mediaType === 'application/pdf' || attachment.name.toLowerCase().endsWith('.pdf')

        if (isTextLike) {
          const content = await blob.text()
          clearStatusPreviewTimers()
          statusPreviewOpen.value = false
          statusPanelOpen.value = true
          rightPanelTab.value = 'files'
          releaseWorkspacePreview()
          workspacePreviewMode.value = 'preview'
          workspacePreviewWrap.value = true
          selectedWorkspaceFile.value = attachment.name
          workspaceFilePreview.value = {
            status: 'text',
            path: attachment.name,
            name: attachment.name,
            content
          }
          return
        }

        const objectUrl = URL.createObjectURL(blob)
        if (isImage || isPdf) {
          clearStatusPreviewTimers()
          statusPreviewOpen.value = false
          statusPanelOpen.value = true
          rightPanelTab.value = 'files'
          releaseWorkspacePreview()
          workspacePreviewMode.value = 'preview'
          selectedWorkspaceFile.value = attachment.name
          workspaceFilePreview.value = {
            status: isImage ? 'image' : 'pdf',
            path: attachment.name,
            name: attachment.name,
            url: objectUrl
          }
          return
        }

        const link = document.createElement('a')
        link.href = objectUrl
        link.download = attachment.name || 'attachment'
        document.body.appendChild(link)
        link.click()
        link.remove()
        window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1500)
        showCopiedHint(text('downloadSource'))
      } catch (error) {
        submitError.value =
          error instanceof WebUiHttpError
            ? error.payload?.code === 'WEBUI_FILE_AUTH_REQUIRED'
              ? text('fileAuthRequired')
              : error.payload?.message || text('attachmentPreviewOpenFailed')
            : text('attachmentPreviewOpenFailed')
      }
    }

    const handleMarkdownContentClick = (event: MouseEvent) => {
      const target =
        event.target instanceof Element
          ? event.target.closest<HTMLElement>(
              '[data-webui-copy-code], [data-webui-download-code], [data-webui-wrap-code], [data-webui-file-path]'
            )
          : null
      if (!target) return

      if (target.dataset.webuiCopyCode !== undefined) {
        const code = target.closest('.markdown-code-block')?.querySelector('pre code')?.textContent ?? ''
        if (code) void copyText(code).then(() => showCopiedHint(text('copied')))
        return
      }

      if (target.dataset.webuiDownloadCode !== undefined) {
        const block = target.closest('.markdown-code-block')
        const code = block?.querySelector('pre code')?.textContent ?? ''
        if (!code) return
        const language = target.dataset.webuiCodeLang ?? ''
        const ext = codeLanguageExtension(language)
        const filename = ext === 'Dockerfile' ? 'Dockerfile' : `code.${ext}`
        downloadTextAsFile(code, filename)
        showCopiedHint(text('downloadSource'))
        return
      }

      if (target.dataset.webuiWrapCode !== undefined) {
        const block = target.closest('.markdown-code-block')
        if (!block) return
        const next = !block.classList.contains('markdown-code-block-wrap')
        block.classList.toggle('markdown-code-block-wrap', next)
        target.setAttribute('aria-pressed', next ? 'true' : 'false')
        target.classList.toggle('markdown-code-tool-active', next)
        target.setAttribute('title', next ? text('unwrapLines') : text('wrapLines'))
        target.setAttribute('aria-label', next ? text('unwrapLines') : text('wrapLines'))
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

    const renderWorkspacePreviewToolButton = (
      label: string,
      onClick: () => void,
      options: { active?: boolean; icon?: ActionIconName; shortLabel?: string } = {}
    ) =>
      h(
        'button',
        {
          class: ['workspace-preview-tool-button', { 'workspace-preview-tool-button-active': options.active }],
          type: 'button',
          title: label,
          'aria-label': label,
          'aria-pressed': options.active === undefined ? undefined : String(options.active),
          onClick
        },
        options.icon ? renderActionIcon(options.icon) : (options.shortLabel ?? label)
      )

    const renderWorkspacePreviewToolbar = (preview: WorkspaceFilePreviewState, previewKind: string) => {
      if (preview.status !== 'text') return [] as const
      const isMarkdown = previewKind === 'markdown'
      const language = isMarkdown ? 'markdown' : (getWorkspaceCodeLanguage(preview.path) ?? 'text')
      // Left type label (TEXT / MARKDOWN / TS …); action buttons sit as a separate right group.
      const languageLabel =
        !language || language === 'text' || language === 'plaintext' ? 'TEXT' : language.toUpperCase()
      return [
        h('span', { class: 'workspace-preview-language' }, languageLabel),
        h('div', { class: 'workspace-preview-tool-actions', role: 'toolbar' }, [
          isMarkdown
            ? renderWorkspacePreviewToolButton(
                text('copyMarkdown'),
                () => {
                  void handleWorkspacePreviewCopy(preview.content, text('copyMarkdown'))
                },
                { shortLabel: 'MD' }
              )
            : undefined,
          renderWorkspacePreviewToolButton(
            isMarkdown ? text('copyPlainText') : text('copySource'),
            () => {
              void handleWorkspacePreviewCopy(
                isMarkdown ? markdownToPlainText(preview.content) : preview.content,
                isMarkdown ? text('copyPlainText') : text('copySource')
              )
            },
            { shortLabel: 'TXT' }
          ),
          isMarkdown
            ? renderWorkspacePreviewToolButton(
                workspacePreviewMode.value === 'preview' ? text('sourceMode') : text('previewMode'),
                () => {
                  workspacePreviewMode.value = workspacePreviewMode.value === 'preview' ? 'source' : 'preview'
                },
                { active: workspacePreviewMode.value === 'source', icon: 'source' }
              )
            : undefined,
          renderWorkspacePreviewToolButton(
            workspacePreviewWrap.value ? text('unwrapLines') : text('wrapLines'),
            () => {
              workspacePreviewWrap.value = !workspacePreviewWrap.value
            },
            { active: workspacePreviewWrap.value, icon: 'wrap' }
          ),
          renderWorkspacePreviewToolButton(text('downloadSource'), () => downloadWorkspacePreviewSource(preview), {
            icon: 'download'
          })
        ])
      ] as const
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
          h('span', { class: 'workspace-file-preview-title' }, getWorkspacePathBasename(preview.path)),
          ...renderWorkspacePreviewToolbar(preview, previewKind)
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
                              class: [
                                'workspace-markdown-preview markdown-content',
                                { 'workspace-preview-wrapped': workspacePreviewWrap.value }
                              ],
                              onClick: handleMarkdownContentClick,
                              innerHTML:
                                workspacePreviewMode.value === 'source'
                                  ? `<pre class="workspace-code-preview hljs"><code>${renderCode(preview.content, 'markdown')}</code></pre>`
                                  : renderMarkdown(preview.content, {
                                      copyCodeLabel: text('copyCode'),
                                      downloadCodeLabel: text('downloadSource'),
                                      wrapLinesLabel: text('wrapLines')
                                    })
                            })
                          : h(
                              'pre',
                              {
                                class: [
                                  'workspace-code-preview hljs',
                                  { 'workspace-code-preview-wrapped': workspacePreviewWrap.value }
                                ]
                              },
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

    const sortConversations = (items: readonly WebUiConversationSummary[]) =>
      [...items].sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt))

    const mergeConversations = (
      current: readonly WebUiConversationSummary[],
      incoming: readonly WebUiConversationSummary[]
    ): readonly WebUiConversationSummary[] => {
      const byId = new Map(current.map((conversation) => [conversation.id, conversation]))
      for (const conversation of incoming) byId.set(conversation.id, conversation)
      return sortConversations([...byId.values()])
    }

    const loadConversations = async () => {
      conversationLoadState.value = 'loading'
      conversationLoadMessage.value = ''
      olderConversationsCursor.value = undefined

      try {
        const query = new URLSearchParams({ limit: String(conversationPageSize) })
        const page = await httpClient.getJson<WebUiCursorResponse<WebUiAgentSessionEntity>>(
          `/api/data/agent-sessions?${query.toString()}`
        )
        conversations.value = sortConversations(page.items.map(toConversationSummary))
        olderConversationsCursor.value = page.nextCursor
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
        // If the first page does not fill the sidebar, keep loading older pages.
        await nextTick()
        const nav = conversationNav.value
        if (olderConversationsCursor.value && nav && nav.scrollHeight <= nav.clientHeight + 8) {
          void loadOlderConversations()
        }
      } catch (error) {
        conversations.value = []
        olderConversationsCursor.value = undefined
        conversationLoadState.value = 'error'
        conversationLoadMessage.value = localizedErrorMessage(error)
      }
    }

    const loadOlderConversations = async () => {
      const cursor = olderConversationsCursor.value
      if (!cursor || olderConversationsLoading.value) return

      olderConversationsLoading.value = true
      try {
        const query = new URLSearchParams({ limit: String(conversationPageSize), cursor })
        const page = await httpClient.getJson<WebUiCursorResponse<WebUiAgentSessionEntity>>(
          `/api/data/agent-sessions?${query.toString()}`
        )
        conversations.value = mergeConversations(conversations.value, page.items.map(toConversationSummary))
        olderConversationsCursor.value = page.nextCursor
        await nextTick()
        const nav = conversationNav.value
        // Keep filling the sidebar while older pages remain (button + scroll still work).
        if (olderConversationsCursor.value && nav && nav.scrollHeight <= nav.clientHeight + 8) {
          olderConversationsLoading.value = false
          await loadOlderConversations()
          return
        }
      } catch (error) {
        conversationLoadMessage.value = localizedErrorMessage(error)
      } finally {
        olderConversationsLoading.value = false
      }
    }

    const updateConversationScrollState = () => {
      const nav = conversationNav.value
      if (!nav) return
      // Auto-load older sessions when the user scrolls near the bottom.
      if (
        nav.scrollHeight - nav.scrollTop - nav.clientHeight <= 72 &&
        olderConversationsCursor.value &&
        !olderConversationsLoading.value
      ) {
        void loadOlderConversations()
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
        if (mode === 'replace') {
          scrollMessagesToEnd()
          // If the first page does not fill the viewport, keep loading older pages.
          await nextTick()
          const stack = messageStack.value
          if (olderMessagesCursor.value && stack && stack.scrollHeight <= stack.clientHeight + 8) {
            void loadOlderMessages()
          }
        }
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
        // Keep filling the viewport while older pages remain (button + scroll-to-top still work).
        if (olderMessagesCursor.value && stack && stack.scrollHeight <= stack.clientHeight + 8) {
          olderMessagesLoading.value = false
          await loadOlderMessages()
          return
        }
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

    const updatePermissionMode = async (mode: WebUiPermissionMode) => {
      const conversationId = selectedConversationId.value
      if (
        !conversationId ||
        !selectedAgent.value ||
        mode === selectedPermissionMode.value ||
        permissionModeUpdateState.value === 'updating'
      ) {
        return
      }

      permissionModeUpdateState.value = 'updating'
      submitError.value = ''
      try {
        await httpClient.patchJson<WebUiPermissionModeResponse>(
          `/api/agent-sessions/${encodeURIComponent(conversationId)}/permission-mode`,
          { permissionMode: mode }
        )
        await loadAgents()
        permissionModePickerOpen.value = false
        permissionModeUpdateState.value = 'idle'
      } catch (error) {
        submitError.value = localizedErrorMessage(error)
        permissionModeUpdateState.value = 'error'
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
      permissionModePickerOpen.value = false
      approvalSubmittingKeys.value = new Set()
      approvalErrorByKey.value = {}
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
        if (reason === 'agent-permission-mode-updated') {
          void loadAgents().catch(() => {
            /* ignore — label falls back until next manual refresh */
          })
        }
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
        const approvalId =
          typeof chunk.approvalId === 'string' && chunk.approvalId.trim()
            ? chunk.approvalId.trim()
            : previousTool?.approvalId
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
          ...(approvalId &&
          (chunk.type === 'tool-approval-request' ||
            previousTool?.state === 'approval-requested' ||
            previousTool?.approvalId)
            ? { approvalId }
            : {}),
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
        if (chunk.type === 'tool-approval-request' || nextTool.state !== 'approval-requested') {
          setApprovalSubmitting(message.id, chunk.toolCallId, false)
          if (nextTool.state !== 'approval-requested') setApprovalError(message.id, chunk.toolCallId, '')
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
      // Auto-load older pages when the user scrolls near the top (keep manual button too).
      if (stack.scrollTop <= 72 && olderMessagesCursor.value && !olderMessagesLoading.value) {
        void loadOlderMessages()
      }
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
      if (
        !conversationId ||
        (!messageText && attachments.value.length === 0) ||
        activeRunConversationId.value ||
        pendingToolApproval.value
      )
        return

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
      if (speechPanelPreferences.value.autoOpenPanel) {
        openSpeechPanel()
      }
      speechController.speak(message.id, message.content, language.value)
    }

    const renderMessageActions = (message: WebUiMessageSnapshot) =>
      h('div', { class: 'message-actions' }, [
        message.content
          ? h(
              'button',
              {
                class: 'message-action-button',
                type: 'button',
                title: text('copy'),
                'aria-label': text('copy'),
                onClick: () => {
                  void copyText(message.content).then(() => showCopiedHint(text('copy')))
                }
              },
              renderActionIcon('copy')
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
        )
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
                    {
                      class: 'conversation-nav',
                      'aria-label': text('desktopSession'),
                      ref: conversationNav,
                      onScroll: updateConversationScrollState
                    },
                    [
                      ...conversations.value.map((conversation) =>
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
                                    'aria-current':
                                      conversation.id === selectedConversationId.value ? 'page' : undefined,
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
                      ),
                      olderConversationsCursor.value
                        ? h(
                            'button',
                            {
                              class: 'load-older-button load-older-conversations-button',
                              type: 'button',
                              disabled: olderConversationsLoading.value,
                              onClick: () => void loadOlderConversations()
                            },
                            olderConversationsLoading.value
                              ? text('loadingOlderConversations')
                              : text('loadOlderConversations')
                          )
                        : undefined
                    ]
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
                renderCopiedToast(),
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
                            h('p', { class: 'message-role' }, messageHeaderLabel(message))
                          ]),
                          renderProcessDetails(message),
                          message.attachments?.length
                            ? h(
                                'div',
                                { class: 'message-attachments' },
                                message.attachments.map((attachment) =>
                                  attachment.fileEntryId
                                    ? h(
                                        'button',
                                        {
                                          class: ['message-attachment', 'message-attachment-link'],
                                          type: 'button',
                                          title: attachment.mediaType || attachment.name,
                                          onClick: () => void openMessageAttachment(attachment)
                                        },
                                        attachment.name
                                      )
                                    : h(
                                        'span',
                                        {
                                          class: 'message-attachment',
                                          title: attachment.mediaType || attachment.name
                                        },
                                        attachment.name
                                      )
                                )
                              )
                            : undefined,
                          message.content
                            ? h('div', {
                                class: 'markdown-content',
                                onClick: handleMarkdownContentClick,
                                innerHTML: renderMarkdown(message.content, {
                                  copyCodeLabel: text('copyCode'),
                                  downloadCodeLabel: text('downloadSource'),
                                  wrapLinesLabel: text('wrapLines')
                                })
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
                  renderPermissionRequestPanel(),
                  h(
                    'div',
                    {
                      class: ['composer-surface', { 'composer-surface-dimmed': Boolean(pendingToolApproval.value) }]
                    },
                    [
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
                          !selectedConversation.value ||
                          activeRunConversationId.value === selectedConversationId.value ||
                          Boolean(pendingToolApproval.value),
                        value: composerText.value,
                        placeholder: pendingToolApproval.value
                          ? text('toolPermissionConfirmation')
                          : selectedConversation.value
                            ? text('sendPlaceholder')
                            : text('selectFirst'),
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
                                permissionModePickerOpen.value = false
                              }
                            },
                            renderComposerToolIcon('thinking')
                          ),
                          h(
                            'button',
                            {
                              class: [
                                'composer-tool-button',
                                {
                                  'composer-tool-button-active': selectedPermissionMode.value !== 'default',
                                  'composer-tool-button-caution': selectedPermissionMode.value === 'bypassPermissions'
                                }
                              ],
                              type: 'button',
                              disabled: !selectedConversation.value || permissionModeUpdateState.value === 'updating',
                              title: `${text('permissionMode')}: ${permissionModeLabel.value}`,
                              'aria-label': text('permissionMode'),
                              'aria-expanded': permissionModePickerOpen.value,
                              onClick: () => {
                                permissionModePickerOpen.value = !permissionModePickerOpen.value
                                modelPickerOpen.value = false
                                reasoningPickerOpen.value = false
                              }
                            },
                            renderComposerToolIcon('permission')
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
                                permissionModePickerOpen.value = false
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
                              (Boolean(pendingToolApproval.value) &&
                                activeRunConversationId.value !== selectedConversationId.value) ||
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
                      permissionModePickerOpen.value
                        ? h(
                            'div',
                            { class: 'permission-mode-picker-menu', role: 'listbox' },
                            permissionModeCards.value.map((card) =>
                              h(
                                'button',
                                {
                                  class: [
                                    'permission-mode-option',
                                    {
                                      'permission-mode-option-selected': card.mode === selectedPermissionMode.value,
                                      'permission-mode-option-caution': card.mode === 'bypassPermissions'
                                    }
                                  ],
                                  key: card.mode,
                                  type: 'button',
                                  role: 'option',
                                  'aria-selected': card.mode === selectedPermissionMode.value,
                                  disabled: permissionModeUpdateState.value === 'updating',
                                  onClick: () => void updatePermissionMode(card.mode)
                                },
                                [
                                  h('span', { class: 'permission-mode-option-title' }, text(card.titleKey)),
                                  h('span', { class: 'permission-mode-option-desc' }, text(card.descriptionKey))
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
                                  command.description
                                    ? h('span', { class: 'slash-command-description' }, command.description)
                                    : undefined
                                ]
                              )
                            )
                          )
                        : undefined
                    ]
                  )
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
                                h('details', { class: 'help-guide-tree', open: true }, [
                                  h('summary', [renderActionIcon('help'), h('span', text('helpGuide'))]),
                                  h(
                                    'ul',
                                    [
                                      'helpGuideIntro',
                                      'helpGuideSessions',
                                      'helpGuideStatus',
                                      'helpGuideFiles',
                                      'helpGuidePreview',
                                      'helpGuideSpeech',
                                      'helpGuideSecurity'
                                    ].map((key) => h('li', text(key as TextKey)))
                                  )
                                ]),
                                h('section', { class: 'help-runtime-section' }, [
                                  h('div', { class: 'help-runtime-header' }, [
                                    h('h3', text('runtimeDetails')),
                                    h('span', {
                                      class: [
                                        'bridge-indicator',
                                        {
                                          'bridge-indicator-connected': bridgeState.value === 'connected',
                                          'bridge-indicator-offline': bridgeState.value === 'offline'
                                        }
                                      ],
                                      title: bridgeDetail.value,
                                      'aria-label': bridgeDetail.value,
                                      role: 'status'
                                    })
                                  ]),
                                  h('div', { class: 'status-runtime-body' }, [
                                    ...statusItems.value.map((item, index) =>
                                      h(
                                        'dl',
                                        {
                                          class: [
                                            'status-row',
                                            { 'status-row-terminal': index === statusItems.value.length - 1 }
                                          ],
                                          key: item.label
                                        },
                                        [h('dt', item.label), h('dd', item.value)]
                                      )
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
    grid-template-columns: minmax(220px, 260px) minmax(0, 1fr);
    height: 100vh;
    height: 100dvh;
    overflow: hidden;
  }

  .webui-shell-status-open {
    grid-template-columns: minmax(220px, 260px) minmax(0, 1fr) minmax(300px, var(--webui-right-panel-width, 380px));
  }

  .webui-shell-files-open {
    grid-template-columns: minmax(220px, 260px) minmax(0, 1fr) minmax(320px, var(--webui-right-panel-width, 420px));
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
    padding: 14px 12px;
    background: #f8fafc;
    border-color: #e2e8f0;
  }

  .conversation-list {
    display: grid;
    grid-template-rows: auto auto auto minmax(0, 1fr);
    overflow: hidden;
    border-right: 1px solid #e2e8f0;
  }

  .status-panel {
    overflow-y: auto;
    padding-top: 20px;
    border-left: 1px solid #e2e8f0;
  }

  .panel-header {
    display: flex;
    gap: 10px;
    align-items: center;
    margin-bottom: 10px;
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
    z-index: 50;
  }

  .language-picker-menu {
    position: absolute;
    top: calc(100% + 6px);
    right: 0;
    z-index: 60;
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
    gap: 6px;
    align-content: start;
    min-height: 0;
    margin-top: 6px;
    padding-right: 4px;
    overflow-y: auto;
    scrollbar-gutter: stable;
  }

  .conversation-item-wrap {
    position: relative;
    display: grid;
    align-self: start;
    height: fit-content;
  }

  .conversation-item {
    display: grid;
    width: 100%;
    min-height: 52px;
    height: fit-content;
    padding: 8px 10px;
    text-align: left;
    background: #ffffff;
    border: 1px solid #e2e8f0;
    border-radius: 8px;
    box-shadow: 0 1px 2px rgb(15 23 42 / 4%);
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
    min-width: 0;
    padding-right: 34px;
    overflow: hidden;
    color: #111827;
    font-size: 14px;
    font-weight: 600;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .conversation-meta {
    min-width: 0;
    overflow: hidden;
    color: #64748b;
    font-size: 12px;
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
    padding: 12px 14px 8px;
  }

  .message-stack {
    display: flex;
    flex-direction: column;
    gap: 12px;
    min-height: 0;
    overflow-y: auto;
    padding: 8px 2px 6px;
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

  .load-older-conversations-button {
    width: 100%;
    margin: 4px 0 8px;
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
    gap: 10px;
    align-items: center;
    justify-content: space-between;
    padding-bottom: 10px;
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
    width: 50px;
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
    right: -8px;
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
    min-height: 44px;
    gap: 7px;
    align-items: center;
    padding: 6px 10px;
    border-bottom: 1px solid var(--webui-divider);
  }

  .workspace-file-preview-title {
    min-width: 0;
    flex: 1;
    overflow: hidden;
    color: #334155;
    font-size: 12px;
    font-weight: 600;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .workspace-preview-language {
    max-width: 96px;
    flex: 0 1 auto;
    overflow: hidden;
    color: #64748b;
    font-size: 11px;
    font-weight: 700;
    text-overflow: ellipsis;
    text-transform: uppercase;
    white-space: nowrap;
    letter-spacing: 0.04em;
  }

  .workspace-preview-tool-actions {
    display: flex;
    flex: 0 0 auto;
    gap: 4px;
    align-items: center;
  }

  .workspace-preview-tool-button {
    display: grid;
    min-width: 28px;
    height: 28px;
    padding: 0 7px;
    place-items: center;
    color: #64748b;
    font-size: 10px;
    font-weight: 700;
    background: transparent;
    border: 1px solid transparent;
    border-radius: 6px;
    cursor: pointer;
  }

  .workspace-preview-tool-button svg {
    width: 14px;
    height: 14px;
  }

  .workspace-preview-tool-button:hover,
  .workspace-preview-tool-button:focus-visible,
  .workspace-preview-tool-button-active {
    color: #111827;
    background: #f1f5f9;
    border-color: #dbe1ea;
    outline: 0;
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

  .workspace-code-preview-wrapped {
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }

  .workspace-preview-wrapped {
    overflow-wrap: anywhere;
  }

  .workspace-preview-wrapped pre {
    white-space: pre-wrap;
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

  .help-runtime-header {
    display: flex;
    gap: 12px;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 2px;
  }

  .help-runtime-header h3 {
    margin: 0;
  }

  .help-runtime-header .bridge-indicator {
    flex: 0 0 auto;
    margin-bottom: 0;
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
    line-height: 1.45;
    opacity: 0.78;
  }

  .message-header {
    display: flex;
    gap: 12px;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 2px;
    min-height: 22px;
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

  /* Floating copy/download toast (viewport-centered bottom), not inline next to action buttons. */
  .webui-copy-toast {
    position: fixed;
    z-index: 80;
    left: 50%;
    bottom: 28px;
    transform: translateX(-50%);
    padding: 8px 14px;
    color: #f8fafc;
    font-size: 13px;
    font-weight: 600;
    line-height: 1.3;
    white-space: nowrap;
    pointer-events: none;
    background: rgb(15 23 42 / 92%);
    border: 1px solid rgb(255 255 255 / 12%);
    border-radius: 999px;
    box-shadow: 0 12px 32px rgb(15 23 42 / 28%);
    animation: webui-copy-toast-in 160ms ease-out;
  }

  @keyframes webui-copy-toast-in {
    from {
      opacity: 0;
      transform: translateX(-50%) translateY(8px);
    }
    to {
      opacity: 1;
      transform: translateX(-50%) translateY(0);
    }
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

  .markdown-code-block-wrap pre,
  .markdown-code-block-wrap code {
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }

  .markdown-code-language {
    position: absolute;
    top: 10px;
    left: 12px;
    z-index: 1;
    max-width: calc(100% - 120px);
    overflow: hidden;
    color: #64748b;
    font-size: 11px;
    font-weight: 700;
    text-overflow: ellipsis;
    text-transform: uppercase;
    white-space: nowrap;
    letter-spacing: 0.04em;
    pointer-events: none;
  }

  .markdown-code-toolbar {
    position: absolute;
    top: 6px;
    right: 6px;
    z-index: 1;
    display: flex;
    gap: 4px;
    align-items: center;
    opacity: 0;
    transition: opacity 140ms ease;
  }

  .markdown-code-block:hover .markdown-code-toolbar,
  .markdown-code-toolbar:focus-within {
    opacity: 1;
  }

  .markdown-code-tool {
    display: grid;
    width: 28px;
    height: 28px;
    padding: 0;
    place-items: center;
    color: #64748b;
    background: rgb(255 255 255 / 92%);
    border: 1px solid var(--webui-code-border);
    border-radius: 6px;
    cursor: pointer;
    transition: background 140ms ease, color 140ms ease, border-color 140ms ease;
  }

  .markdown-code-tool svg {
    display: block;
    width: 14px;
    height: 14px;
    fill: none;
    stroke: currentColor;
    stroke-linecap: round;
    stroke-linejoin: round;
    stroke-width: 2;
  }

  .markdown-code-tool:hover,
  .markdown-code-tool:focus-visible,
  .markdown-code-tool-active {
    color: #111827;
    background: #ffffff;
    outline: 0;
  }

  .markdown-code-tool-active {
    color: #2563eb;
    border-color: #93c5fd;
  }

  .webui-file-link {
    display: inline-flex;
    max-width: 100%;
    padding: 0;
    color: inherit;
    font: inherit;
    text-align: left;
    text-decoration: underline;
    text-decoration-color: rgb(100 116 139 / 45%);
    text-decoration-style: dotted;
    text-underline-offset: 3px;
    overflow-wrap: anywhere;
    background: transparent;
    border: 0;
    cursor: pointer;
  }

  .webui-file-link:hover,
  .webui-file-link:focus-visible {
    color: inherit;
    text-decoration-style: solid;
    text-decoration-color: currentColor;
    outline: 0;
  }


  .markdown-content table {
    width: 100%;
    max-width: 100%;
    margin: 0.75em 0;
    overflow: hidden;
    border-collapse: separate;
    border-spacing: 0;
    border: 0.5px solid #d1d5db;
    border-radius: 8px;
    font-size: 0.92em;
  }

  .markdown-content th,
  .markdown-content td {
    min-width: 88px;
    padding: 0.5em 0.75em;
    text-align: left;
    vertical-align: top;
    border-right: 0.5px solid #d1d5db;
    border-bottom: 0.5px solid #d1d5db;
  }

  .markdown-content th:last-child,
  .markdown-content td:last-child {
    border-right: none;
  }

  .markdown-content tr:last-child td {
    border-bottom: none;
  }

  .markdown-content th {
    font-weight: 600;
    background: #f3f4f6;
  }

  .markdown-content tr:hover {
    background: #f8fafc;
  }

  .markdown-content .table-wrapper,
  .markdown-content table {
    display: block;
    overflow-x: auto;
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
    min-height: 40px;
    padding: 4px 12px;
    line-height: 1.45;
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

  .tool-approval-bar {
    display: grid;
    gap: 8px;
    margin-top: 8px;
    padding-top: 8px;
    border-top: 1px solid #e5e7eb;
  }

  .tool-approval-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }

  .tool-approval-button {
    min-height: 30px;
    padding: 0 12px;
    font-size: 12px;
    font-weight: 600;
    border: 1px solid transparent;
    border-radius: 6px;
    cursor: pointer;
  }

  .tool-approval-button:disabled {
    opacity: 0.65;
    cursor: wait;
  }

  .tool-approval-button-approve {
    color: #065f46;
    background: #d1fae5;
    border-color: #6ee7b7;
  }

  .tool-approval-button-deny {
    color: #991b1b;
    background: #fee2e2;
    border-color: #fca5a5;
  }

  .tool-approval-readonly {
    margin: 0;
    font-size: 12px;
    color: #92400e;
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

  .speech-transport-panel {
    display: grid;
    gap: 10px;
    padding: 12px;
    background: #f8fafc;
    border: 1px solid #e2e8f0;
    border-radius: 10px;
  }

  .speech-transport-header {
    display: grid;
    gap: 4px;
  }

  .speech-transport-title {
    margin: 0;
    color: #0f172a;
    font-size: 13px;
    font-weight: 600;
  }

  .speech-transport-progress {
    margin: 0;
    color: #64748b;
    font-size: 12px;
    font-variant-numeric: tabular-nums;
    line-height: 1.4;
  }

  .speech-transport-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 8px;
  }

  .speech-transport-button {
    min-height: 36px;
    padding: 0 10px;
    color: #1f2937;
    font-size: 12px;
    line-height: 1.2;
    background: #ffffff;
    border: 1px solid #d1d5db;
    border-radius: 8px;
    cursor: pointer;
  }

  .speech-transport-button:hover:not(:disabled) {
    background: #f1f5f9;
    border-color: #94a3b8;
  }

  .speech-transport-button-active {
    color: #ffffff;
    background: #111827;
    border-color: #111827;
  }

  .speech-transport-button-active:hover:not(:disabled) {
    background: #1f2937;
    border-color: #1f2937;
  }

  .speech-transport-button-caution {
    color: #b91c1c;
    border-color: #fecaca;
    background: #fef2f2;
  }

  .speech-transport-button-caution:hover:not(:disabled) {
    background: #fee2e2;
    border-color: #fca5a5;
  }

  .speech-transport-button:disabled {
    cursor: not-allowed;
    opacity: 0.5;
  }

  .speech-transport-hint {
    margin: 0;
    color: #64748b;
    font-size: 12px;
    line-height: 1.4;
  }

  .speech-auto-open-row {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 12px;
    padding: 10px 12px;
    background: #ffffff;
    border: 1px solid #e2e8f0;
    border-radius: 10px;
  }

  .speech-auto-open-copy {
    display: grid;
    gap: 4px;
    min-width: 0;
  }

  .speech-auto-open-hint {
    color: #64748b;
    font-size: 12px;
    line-height: 1.4;
  }

  .speech-auto-open-switch {
    width: 18px;
    height: 18px;
    margin-top: 2px;
    flex-shrink: 0;
    accent-color: #111827;
    cursor: pointer;
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

  .message-attachment-link {
    color: #1d4ed8;
    text-decoration: underline;
    text-decoration-color: rgb(29 78 216 / 35%);
    text-underline-offset: 2px;
    cursor: pointer;
  }

  .message-attachment-link:hover,
  .message-attachment-link:focus-visible {
    color: #1e40af;
    text-decoration-color: currentColor;
    outline: 0;
  }

  .composer {
    margin-top: 8px;
    padding-top: 8px;
    background: #eef2f7;
    border-top: 1px solid #dbe1ea;
  }

  .permission-request-panel {
    margin: 0 0 10px;
  }

  .permission-request-card {
    padding: 10px;
    background: #ffffff;
    border: 1px solid #dbe1ea;
    border-radius: 17px;
    box-shadow: 0 1px 5px rgb(15 23 42 / 5%);
  }

  .permission-request-header {
    display: flex;
    gap: 12px;
    align-items: flex-start;
    justify-content: space-between;
  }

  .permission-request-heading {
    min-width: 0;
    flex: 1;
  }

  .permission-request-title {
    display: flex;
    gap: 8px;
    align-items: center;
    margin: 0;
    overflow: hidden;
    color: #111827;
    font-size: 13px;
    font-weight: 600;
    line-height: 1.4;
  }

  .permission-request-title-icon {
    flex: 0 0 auto;
    color: #6b7280;
  }

  .permission-request-title span {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .permission-request-tool-name {
    margin: 2px 0 0;
    overflow: hidden;
    color: #6b7280;
    font-size: 12px;
    line-height: 1.4;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .permission-request-badge {
    flex: 0 0 auto;
    padding: 3px 8px;
    color: #b45309;
    font-size: 11px;
    font-weight: 600;
    white-space: nowrap;
    background: #fffbeb;
    border-radius: 999px;
  }

  .permission-request-preview {
    margin-top: 8px;
    overflow: hidden;
    background: #f3f4f6;
    border-radius: 12px;
  }

  .permission-request-preview-body {
    max-height: 160px;
    margin: 0;
    padding: 10px 12px;
    overflow: auto;
    color: #374151;
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    font-size: 12px;
    line-height: 1.45;
    white-space: pre-wrap;
    word-break: break-word;
  }

  .permission-request-actions {
    display: grid;
    gap: 6px;
    margin-top: 8px;
  }

  .permission-request-option {
    display: flex;
    gap: 12px;
    align-items: center;
    min-height: 44px;
    padding: 8px 12px;
    color: #111827;
    font-size: 13px;
    font-weight: 600;
    text-align: left;
    background: transparent;
    border: 0;
    border-radius: 12px;
    cursor: pointer;
  }

  .permission-request-option:hover:not(:disabled) {
    background: #f3f4f6;
  }

  .permission-request-option:disabled {
    opacity: 0.65;
    cursor: wait;
  }

  .permission-request-option-index {
    display: inline-flex;
    width: 32px;
    height: 32px;
    flex: 0 0 auto;
    align-items: center;
    justify-content: center;
    color: #6b7280;
    font-size: 13px;
    font-weight: 700;
    background: #e5e7eb;
    border-radius: 999px;
  }

  .permission-request-option:hover:not(:disabled) .permission-request-option-index {
    color: #ffffff;
    background: #111827;
  }

  .permission-request-option-label {
    min-width: 0;
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .permission-request-option-deny .permission-request-option-label {
    color: #b91c1c;
  }

  .permission-request-readonly {
    margin: 8px 0 0;
    color: #92400e;
    font-size: 12px;
  }

  .permission-request-error {
    margin: 8px 0 0;
    color: #b91c1c;
    font-size: 12px;
  }

  .composer-surface-dimmed {
    opacity: 0.55;
    pointer-events: none;
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

  .composer-tool-button-caution {
    color: #7c3aed;
    background: #f5f3ff;
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
  .reasoning-picker-menu,
  .permission-mode-picker-menu {
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

  .permission-mode-picker-menu {
    z-index: 7;
    right: auto;
    left: 8px;
    width: min(320px, calc(100% - 16px));
    max-height: min(360px, 48dvh);
  }

  .permission-mode-option {
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

  .permission-mode-option:hover,
  .permission-mode-option:focus-visible,
  .permission-mode-option-selected {
    background: #eef2ff;
    outline: 0;
  }

  .permission-mode-option:disabled {
    opacity: 0.65;
    cursor: wait;
  }

  .permission-mode-option-caution .permission-mode-option-title {
    color: #7c3aed;
  }

  .permission-mode-option-title {
    font-size: 13px;
    font-weight: 600;
  }

  .permission-mode-option-desc {
    color: #64748b;
    font-size: 11px;
    line-height: 1.35;
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

  .status-row-terminal {
    margin-bottom: 0;
    padding-bottom: 0;
    border-bottom: 0;
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

    .composer-tool-button-active {
      color: #93c5fd;
      background: #1e3a5f;
    }

    .composer-tool-button-caution {
      color: #c4b5fd;
      background: #2e1065;
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
    .permission-mode-picker-menu,
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
    .reasoning-picker-option,
    .permission-mode-option {
      color: #e5e7eb;
    }

    .permission-mode-option-desc {
      color: #94a3b8;
    }

    .permission-mode-option-caution .permission-mode-option-title {
      color: #c4b5fd;
    }

    .slash-command-option:hover,
    .slash-command-option:focus-visible {
      background: #334155;
    }

    .model-picker-option:hover,
    .model-picker-option:focus-visible,
    .model-picker-option-selected,
    .reasoning-picker-option:hover,
    .reasoning-picker-option-selected,
    .permission-mode-option:hover,
    .permission-mode-option:focus-visible,
    .permission-mode-option-selected {
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

  :root[data-webui-theme='dark'] .permission-request-card {
    background: #1f2937;
    border-color: #475569;
    box-shadow: 0 1px 5px rgb(0 0 0 / 20%);
  }

  :root[data-webui-theme='dark'] .permission-request-title {
    color: #f3f4f6;
  }

  :root[data-webui-theme='dark'] .permission-request-title-icon,
  :root[data-webui-theme='dark'] .permission-request-tool-name {
    color: #9ca3af;
  }

  :root[data-webui-theme='dark'] .permission-request-badge {
    color: #fbbf24;
    background: rgb(251 191 36 / 12%);
  }

  :root[data-webui-theme='dark'] .permission-request-preview {
    background: #111827;
  }

  :root[data-webui-theme='dark'] .permission-request-preview-body {
    color: #d1d5db;
  }

  :root[data-webui-theme='dark'] .permission-request-option {
    color: #f3f4f6;
  }

  :root[data-webui-theme='dark'] .permission-request-option:hover:not(:disabled) {
    background: #374151;
  }

  :root[data-webui-theme='dark'] .permission-request-option-index {
    color: #d1d5db;
    background: #374151;
  }

  :root[data-webui-theme='dark'] .permission-request-option:hover:not(:disabled) .permission-request-option-index {
    color: #111827;
    background: #f3f4f6;
  }

  :root[data-webui-theme='dark'] .permission-request-option-deny .permission-request-option-label {
    color: #fca5a5;
  }

  :root[data-webui-theme='dark'] .permission-request-readonly {
    color: #fbbf24;
  }

  :root[data-webui-theme='dark'] .permission-request-error {
    color: #fca5a5;
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
  :root[data-webui-theme='dark'] .permission-mode-picker-menu,
  :root[data-webui-theme='dark'] .scroll-bottom-button,
  :root[data-webui-theme='dark'] .theme-toggle-button,
  :root[data-webui-theme='dark'] .panel-icon-button,
  :root[data-webui-theme='dark'] .status-github-link,
  :root[data-webui-theme='dark'] .language-picker-menu {
    color: #e5e7eb;
    background: #273449;
    border-color: #475569;
  }

  :root[data-webui-theme='dark'] .markdown-content table {
    border-color: #475569;
  }

  :root[data-webui-theme='dark'] .markdown-content th,
  :root[data-webui-theme='dark'] .markdown-content td {
    border-right-color: #475569;
    border-bottom-color: #475569;
  }

  :root[data-webui-theme='dark'] .markdown-content tr:hover {
    background: #1e293b;
  }

  :root[data-webui-theme='dark'] .message-attachment-link {
    color: #93c5fd;
    text-decoration-color: rgb(147 197 253 / 40%);
  }

  :root[data-webui-theme='dark'] .message-attachment-link:hover,
  :root[data-webui-theme='dark'] .message-attachment-link:focus-visible {
    color: #bfdbfe;
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
  :root[data-webui-theme='dark'] .permission-mode-option:hover,
  :root[data-webui-theme='dark'] .permission-mode-option:focus-visible,
  :root[data-webui-theme='dark'] .permission-mode-option-selected,
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
  :root[data-webui-theme='dark'] .permission-mode-option,
  :root[data-webui-theme='dark'] .composer-tool-button {
    color: #e5e7eb;
  }

  :root[data-webui-theme='dark'] .composer-tool-button-pending,
  :root[data-webui-theme='dark'] .slash-command-description,
  :root[data-webui-theme='dark'] .permission-mode-option-desc,
  :root[data-webui-theme='dark'] .help-guide-tree ul,
  :root[data-webui-theme='dark'] .conversation-meta,
  :root[data-webui-theme='dark'] .model-picker-provider {
    color: #94a3b8;
  }

  :root[data-webui-theme='dark'] .composer-tool-button-active {
    color: #93c5fd;
    background: #1e3a5f;
  }

  :root[data-webui-theme='dark'] .composer-tool-button-caution {
    color: #c4b5fd;
    background: #2e1065;
  }

  :root[data-webui-theme='dark'] .permission-mode-option-caution .permission-mode-option-title {
    color: #c4b5fd;
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

  :root[data-webui-theme='dark'] .speech-transport-panel {
    background: #1f2937;
    border-color: #475569;
  }

  :root[data-webui-theme='dark'] .speech-transport-title {
    color: #e5e7eb;
  }

  :root[data-webui-theme='dark'] .speech-transport-progress,
  :root[data-webui-theme='dark'] .speech-transport-hint,
  :root[data-webui-theme='dark'] .speech-auto-open-hint {
    color: #94a3b8;
  }

  :root[data-webui-theme='dark'] .speech-transport-button {
    color: #e5e7eb;
    background: #273449;
    border-color: #475569;
  }

  :root[data-webui-theme='dark'] .speech-transport-button:hover:not(:disabled) {
    background: #334155;
    border-color: #64748b;
  }

  :root[data-webui-theme='dark'] .speech-transport-button-active {
    color: #ffffff;
    background: #3b82f6;
    border-color: #3b82f6;
  }

  :root[data-webui-theme='dark'] .speech-transport-button-active:hover:not(:disabled) {
    background: #2563eb;
    border-color: #2563eb;
  }

  :root[data-webui-theme='dark'] .speech-transport-button-caution {
    color: #fca5a5;
    background: #450a0a;
    border-color: #7f1d1d;
  }

  :root[data-webui-theme='dark'] .speech-transport-button-caution:hover:not(:disabled) {
    background: #7f1d1d;
    border-color: #991b1b;
  }

  :root[data-webui-theme='dark'] .speech-auto-open-row {
    background: #1f2937;
    border-color: #475569;
  }

  :root[data-webui-theme='dark'] .speech-auto-open-switch {
    accent-color: #3b82f6;
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

  :root[data-webui-theme='dark'] .webui-copy-toast {
    color: #f8fafc;
    background: rgb(15 23 42 / 94%);
    border-color: rgb(148 163 184 / 28%);
  }

  :root[data-webui-theme='dark'] .markdown-code-tool {
    color: #cbd5e1;
    background: rgb(15 23 42 / 88%);
    border-color: rgb(148 163 184 / 28%);
  }

  :root[data-webui-theme='dark'] .markdown-code-tool:hover,
  :root[data-webui-theme='dark'] .markdown-code-tool:focus-visible,
  :root[data-webui-theme='dark'] .markdown-code-tool-active {
    color: #f8fafc;
    background: #1e293b;
  }

  :root[data-webui-theme='dark'] .markdown-code-tool-active {
    color: #93c5fd;
    border-color: #3b82f6;
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

  :root[data-webui-theme='dark'] .workspace-preview-language,
  :root[data-webui-theme='dark'] .markdown-code-language {
    color: #94a3b8;
  }

  :root[data-webui-theme='dark'] .workspace-preview-tool-button {
    color: #94a3b8;
  }

  :root[data-webui-theme='dark'] .workspace-preview-tool-button:hover,
  :root[data-webui-theme='dark'] .workspace-preview-tool-button:focus-visible,
  :root[data-webui-theme='dark'] .workspace-preview-tool-button-active {
    color: #f8fafc;
    background: #334155;
    border-color: #475569;
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
  :root[data-webui-theme='light'] .permission-mode-picker-menu,
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
  :root[data-webui-theme='light'] .permission-mode-option:hover,
  :root[data-webui-theme='light'] .permission-mode-option:focus-visible,
  :root[data-webui-theme='light'] .permission-mode-option-selected,
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
  :root[data-webui-theme='light'] .permission-mode-option,
  :root[data-webui-theme='light'] .composer-tool-button {
    color: #1f2937;
  }

  :root[data-webui-theme='light'] .composer-tool-button-active {
    color: #2563eb;
    background: #eff6ff;
  }

  :root[data-webui-theme='light'] .composer-tool-button-caution {
    color: #7c3aed;
    background: #f5f3ff;
  }

  :root[data-webui-theme='light'] .permission-mode-option-caution .permission-mode-option-title {
    color: #7c3aed;
  }

  :root[data-webui-theme='light'] .permission-mode-option-desc {
    color: #64748b;
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
    .reasoning-picker-menu,
    .permission-mode-picker-menu {
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

    .permission-mode-picker-menu {
      right: auto;
      left: 0;
      width: min(100%, 320px);
      max-height: min(340px, 48dvh);
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
