import { createSlice, PayloadAction } from '@reduxjs/toolkit'
import { TRANSLATE_PROMPT } from '@renderer/config/prompts'
import {
  AssistantsSortType,
  CodeStyleVarious,
  LanguageVarious,
  MathEngine,
  OpenAIServiceTier,
  OpenAISummaryText,
  PaintingProvider,
  S3Config,
  ThemeMode,
  TranslateLanguageVarious
} from '@renderer/types'
import { uuid } from '@renderer/utils'
import { UpgradeChannel } from '@shared/config/constant'

import { RemoteSyncState } from './backup'

export type SendMessageShortcut = 'Enter' | 'Shift+Enter' | 'Ctrl+Enter' | 'Command+Enter' | 'Alt+Enter'

export type SidebarIcon = 'assistants' | 'agents' | 'paintings' | 'translate' | 'minapp' | 'knowledge' | 'files'

export const DEFAULT_SIDEBAR_ICONS: SidebarIcon[] = [
  'assistants',
  'agents',
  'paintings',
  'translate',
  'minapp',
  'knowledge',
  'files'
]

export interface NutstoreSyncRuntime extends RemoteSyncState {}

export type AssistantIconType = 'model' | 'emoji' | 'none'

export type UserTheme = {
  colorPrimary: string
}

export interface SettingsState {
  showAssistants: boolean
  showTopics: boolean
  assistantsTabSortType: AssistantsSortType
  sendMessageShortcut: SendMessageShortcut
  language: LanguageVarious
  targetLanguage: TranslateLanguageVarious
  proxyMode: 'system' | 'custom' | 'none'
  proxyUrl?: string
  userName: string
  userId: string
  showPrompt: boolean
  showTokens: boolean
  showMessageDivider: boolean
  messageFont: 'system' | 'serif'
  showInputEstimatedTokens: boolean
  launchOnBoot: boolean
  launchToTray: boolean
  trayOnClose: boolean
  tray: boolean
  theme: ThemeMode
  userTheme: UserTheme
  windowStyle: 'transparent' | 'opaque'
  fontSize: number
  topicPosition: 'left' | 'right'
  showTopicTime: boolean
  pinTopicsToTop: boolean
  assistantIconType: AssistantIconType
  pasteLongTextAsFile: boolean
  pasteLongTextThreshold: number
  clickAssistantToShowTopic: boolean
  autoCheckUpdate: boolean
  testPlan: boolean
  testChannel: UpgradeChannel
  renderInputMessageAsMarkdown: boolean
  // 代码执行
  codeExecution: {
    enabled: boolean
    timeoutMinutes: number
  }
  codeEditor: {
    enabled: boolean
    themeLight: string
    themeDark: string
    highlightActiveLine: boolean
    foldGutter: boolean
    autocompletion: boolean
    keymap: boolean
  }
  codePreview: {
    themeLight: CodeStyleVarious
    themeDark: CodeStyleVarious
  }
  codeShowLineNumbers: boolean
  codeCollapsible: boolean
  codeWrappable: boolean
  mathEngine: MathEngine
  messageStyle: 'plain' | 'bubble'
  foldDisplayMode: 'expanded' | 'compact'
  gridColumns: number
  gridPopoverTrigger: 'hover' | 'click'
  messageNavigation: 'none' | 'buttons' | 'anchor'
  // 数据目录设置
  skipBackupFile: boolean
  // webdav 配置 host, user, pass, path
  webdavHost: string
  webdavUser: string
  webdavPass: string
  webdavPath: string
  webdavAutoSync: boolean
  webdavSyncInterval: number
  webdavMaxBackups: number
  webdavSkipBackupFile: boolean
  webdavDisableStream: boolean
  translateModelPrompt: string
  autoTranslateWithSpace: boolean
  showTranslateConfirm: boolean
  enableTopicNaming: boolean
  customCss: string
  topicNamingPrompt: string
  // Sidebar icons
  sidebarIcons: {
    visible: SidebarIcon[]
    disabled: SidebarIcon[]
  }
  narrowMode: boolean
  // QuickAssistant
  enableQuickAssistant: boolean
  clickTrayToShowQuickAssistant: boolean
  multiModelMessageStyle: MultiModelMessageStyle
  readClipboardAtStartup: boolean
  notionDatabaseID: string | null
  notionApiKey: string | null
  notionPageNameKey: string | null
  markdownExportPath: string | null
  forceDollarMathInMarkdown: boolean
  useTopicNamingForMessageTitle: boolean
  showModelNameInMarkdown: boolean
  showModelProviderInMarkdown: boolean
  thoughtAutoCollapse: boolean
  notionExportReasoning: boolean
  yuqueToken: string | null
  yuqueUrl: string | null
  yuqueRepoId: string | null
  joplinToken: string | null
  joplinUrl: string | null
  joplinExportReasoning: boolean
  defaultObsidianVault: string | null
  defaultAgent: string | null
  // 思源笔记配置
  siyuanApiUrl: string | null
  siyuanToken: string | null
  siyuanBoxId: string | null
  siyuanRootPath: string | null
  // 订阅的助手地址
  agentssubscribeUrl: string | null
  // MinApps
  maxKeepAliveMinapps: number
  showOpenedMinappsInSidebar: boolean
  minappsOpenLinkExternal: boolean
  // 隐私设置
  enableDataCollection: boolean
  enableSpellCheck: boolean
  spellCheckLanguages: string[]
  enableQuickPanelTriggers: boolean
  enableBackspaceDeleteModel: boolean
  // 硬件加速设置
  disableHardwareAcceleration: boolean
  exportMenuOptions: {
    image: boolean
    markdown: boolean
    markdown_reason: boolean
    notion: boolean
    yuque: boolean
    joplin: boolean
    obsidian: boolean
    siyuan: boolean
    docx: boolean
    plain_text: boolean
  }
  // OpenAI
  openAI: {
    summaryText: OpenAISummaryText
    serviceTier: OpenAIServiceTier
  }
  // Notification
  notification: {
    assistant: boolean
    backup: boolean
    knowledge: boolean
  }
  // Local backup settings
  localBackupDir: string
  localBackupAutoSync: boolean
  localBackupSyncInterval: number
  localBackupMaxBackups: number
  localBackupSkipBackupFile: boolean
  defaultPaintingProvider: PaintingProvider
  s3: S3Config
}

export type MultiModelMessageStyle = 'horizontal' | 'vertical' | 'fold' | 'grid'

export const initialState: SettingsState = {
  showAssistants: true,
  showTopics: true,
  assistantsTabSortType: 'list',
  sendMessageShortcut: 'Enter',
  language: navigator.language as LanguageVarious,
  targetLanguage: 'en-us',
  proxyMode: 'system',
  proxyUrl: undefined,
  userName: '',
  userId: uuid(),
  showPrompt: true,
  showTokens: true,
  showMessageDivider: true,
  messageFont: 'system',
  showInputEstimatedTokens: false,
  launchOnBoot: false,
  launchToTray: false,
  trayOnClose: true,
  tray: true,
  theme: ThemeMode.system,
  userTheme: {
    colorPrimary: '#00b96b'
  },
  windowStyle: 'opaque',
  fontSize: 14,
  topicPosition: 'left',
  showTopicTime: false,
  pinTopicsToTop: false,
  assistantIconType: 'emoji',
  pasteLongTextAsFile: false,
  pasteLongTextThreshold: 1500,
  clickAssistantToShowTopic: true,
  autoCheckUpdate: true,
  testPlan: false,
  testChannel: UpgradeChannel.LATEST,
  renderInputMessageAsMarkdown: false,
  codeExecution: {
    enabled: false,
    timeoutMinutes: 1
  },
  codeEditor: {
    enabled: false,
    themeLight: 'auto',
    themeDark: 'auto',
    highlightActiveLine: false,
    foldGutter: false,
    autocompletion: true,
    keymap: false
  },
  codePreview: {
    themeLight: 'auto',
    themeDark: 'auto'
  },
  codeShowLineNumbers: false,
  codeCollapsible: false,
  codeWrappable: false,
  mathEngine: 'KaTeX',
  messageStyle: 'plain',
  foldDisplayMode: 'expanded',
  gridColumns: 2,
  gridPopoverTrigger: 'click',
  messageNavigation: 'none',
  skipBackupFile: false,
  webdavHost: '',
  webdavUser: '',
  webdavPass: '',
  webdavPath: '/cherry-studio',
  webdavAutoSync: false,
  webdavSyncInterval: 0,
  webdavMaxBackups: 0,
  webdavSkipBackupFile: false,
  webdavDisableStream: false,
  translateModelPrompt: TRANSLATE_PROMPT,
  autoTranslateWithSpace: false,
  showTranslateConfirm: true,
  enableTopicNaming: true,
  customCss: '',
  topicNamingPrompt: '',
  sidebarIcons: {
    visible: DEFAULT_SIDEBAR_ICONS,
    disabled: []
  },
  narrowMode: false,
  enableQuickAssistant: false,
  clickTrayToShowQuickAssistant: false,
  readClipboardAtStartup: true,
  multiModelMessageStyle: 'fold',
  notionDatabaseID: '',
  notionApiKey: '',
  notionPageNameKey: 'Name',
  markdownExportPath: null,
  forceDollarMathInMarkdown: false,
  useTopicNamingForMessageTitle: false,
  showModelNameInMarkdown: false,
  showModelProviderInMarkdown: false,
  thoughtAutoCollapse: true,
  notionExportReasoning: false,
  yuqueToken: '',
  yuqueUrl: '',
  yuqueRepoId: '',
  joplinToken: '',
  joplinUrl: '',
  joplinExportReasoning: false,
  defaultObsidianVault: null,
  defaultAgent: null,
  siyuanApiUrl: null,
  siyuanToken: null,
  siyuanBoxId: null,
  siyuanRootPath: null,
  agentssubscribeUrl: '',
  // MinApps
  maxKeepAliveMinapps: 3,
  showOpenedMinappsInSidebar: true,
  minappsOpenLinkExternal: false,
  enableDataCollection: false,
  enableSpellCheck: false,
  spellCheckLanguages: [],
  enableQuickPanelTriggers: false,
  enableBackspaceDeleteModel: true,
  // 硬件加速设置
  disableHardwareAcceleration: false,
  exportMenuOptions: {
    image: true,
    markdown: true,
    markdown_reason: true,
    notion: true,
    yuque: true,
    joplin: true,
    obsidian: true,
    siyuan: true,
    docx: true,
    plain_text: true
  },
  // OpenAI
  openAI: {
    summaryText: 'off',
    serviceTier: 'auto'
  },
  notification: {
    assistant: false,
    backup: false,
    knowledge: false
  },
  // Local backup settings
  localBackupDir: '',
  localBackupAutoSync: false,
  localBackupSyncInterval: 0,
  localBackupMaxBackups: 0,
  localBackupSkipBackupFile: false,
  defaultPaintingProvider: 'aihubmix',
  s3: {
    endpoint: '',
    region: '',
    bucket: '',
    accessKeyId: '',
    secretAccessKey: '',
    root: '',
    autoSync: false,
    syncInterval: 0,
    maxBackups: 0,
    skipBackupFile: false
  }
}

const settingsSlice = createSlice({
  name: 'settings',
  initialState,
  reducers: {
    setShowAssistants: (state, action: PayloadAction<boolean>) => {
      state.showAssistants = action.payload
    },
    toggleShowAssistants: (state) => {
      state.showAssistants = !state.showAssistants
    },
    setShowTopics: (state, action: PayloadAction<boolean>) => {
      state.showTopics = action.payload
    },
    toggleShowTopics: (state) => {
      state.showTopics = !state.showTopics
    },
    setAssistantsTabSortType: (state, action: PayloadAction<AssistantsSortType>) => {
      state.assistantsTabSortType = action.payload
    },
    setSendMessageShortcut: (state, action: PayloadAction<SendMessageShortcut>) => {
      state.sendMessageShortcut = action.payload
    },
    setLanguage: (state, action: PayloadAction<LanguageVarious>) => {
      state.language = action.payload
    },
    setTargetLanguage: (state, action: PayloadAction<TranslateLanguageVarious>) => {
      state.targetLanguage = action.payload
    },
    setProxyMode: (state, action: PayloadAction<'system' | 'custom' | 'none'>) => {
      state.proxyMode = action.payload
    },
    setProxyUrl: (state, action: PayloadAction<string | undefined>) => {
      state.proxyUrl = action.payload
    },
    setUserName: (state, action: PayloadAction<string>) => {
      state.userName = action.payload
    },
    setShowPrompt: (state, action: PayloadAction<boolean>) => {
      state.showPrompt = action.payload
    },
    setShowTokens: (state, action: PayloadAction<boolean>) => {
      state.showTokens = action.payload
    },
    setShowMessageDivider: (state, action: PayloadAction<boolean>) => {
      state.showMessageDivider = action.payload
    },
    setMessageFont: (state, action: PayloadAction<'system' | 'serif'>) => {
      state.messageFont = action.payload
    },
    setShowInputEstimatedTokens: (state, action: PayloadAction<boolean>) => {
      state.showInputEstimatedTokens = action.payload
    },
    setLaunchOnBoot: (state, action: PayloadAction<boolean>) => {
      state.launchOnBoot = action.payload
    },
    setLaunchToTray: (state, action: PayloadAction<boolean>) => {
      state.launchToTray = action.payload
    },
    setTray: (state, action: PayloadAction<boolean>) => {
      state.tray = action.payload
    },
    setTrayOnClose: (state, action: PayloadAction<boolean>) => {
      state.trayOnClose = action.payload
    },
    setTheme: (state, action: PayloadAction<ThemeMode>) => {
      state.theme = action.payload
    },
    setCustomCss: (state, action: PayloadAction<string>) => {
      state.customCss = action.payload
    },
    setUserTheme: (state, action: PayloadAction<UserTheme>) => {
      state.userTheme = action.payload
    },
    setFontSize: (state, action: PayloadAction<number>) => {
      state.fontSize = action.payload
    },
    setWindowStyle: (state, action: PayloadAction<'transparent' | 'opaque'>) => {
      state.windowStyle = action.payload
    },
    setTopicPosition: (state, action: PayloadAction<'left' | 'right'>) => {
      state.topicPosition = action.payload
    },
    setShowTopicTime: (state, action: PayloadAction<boolean>) => {
      state.showTopicTime = action.payload
    },
    setPinTopicsToTop: (state, action: PayloadAction<boolean>) => {
      state.pinTopicsToTop = action.payload
    },
    setAssistantIconType: (state, action: PayloadAction<AssistantIconType>) => {
      state.assistantIconType = action.payload
    },
    setPasteLongTextAsFile: (state, action: PayloadAction<boolean>) => {
      state.pasteLongTextAsFile = action.payload
    },
    setAutoCheckUpdate: (state, action: PayloadAction<boolean>) => {
      state.autoCheckUpdate = action.payload
    },
    setTestPlan: (state, action: PayloadAction<boolean>) => {
      state.testPlan = action.payload
    },
    setTestChannel: (state, action: PayloadAction<UpgradeChannel>) => {
      state.testChannel = action.payload
    },
    setRenderInputMessageAsMarkdown: (state, action: PayloadAction<boolean>) => {
      state.renderInputMessageAsMarkdown = action.payload
    },
    setClickAssistantToShowTopic: (state, action: PayloadAction<boolean>) => {
      state.clickAssistantToShowTopic = action.payload
    },
    setSkipBackupFile: (state, action: PayloadAction<boolean>) => {
      state.skipBackupFile = action.payload
    },
    setWebdavHost: (state, action: PayloadAction<string>) => {
      state.webdavHost = action.payload
    },
    setWebdavUser: (state, action: PayloadAction<string>) => {
      state.webdavUser = action.payload
    },
    setWebdavPass: (state, action: PayloadAction<string>) => {
      state.webdavPass = action.payload
    },
    setWebdavPath: (state, action: PayloadAction<string>) => {
      state.webdavPath = action.payload
    },
    setWebdavAutoSync: (state, action: PayloadAction<boolean>) => {
      state.webdavAutoSync = action.payload
    },
    setWebdavSyncInterval: (state, action: PayloadAction<number>) => {
      state.webdavSyncInterval = action.payload
    },
    setWebdavMaxBackups: (state, action: PayloadAction<number>) => {
      state.webdavMaxBackups = action.payload
    },
    setWebdavSkipBackupFile: (state, action: PayloadAction<boolean>) => {
      state.webdavSkipBackupFile = action.payload
    },
    setWebdavDisableStream: (state, action: PayloadAction<boolean>) => {
      state.webdavDisableStream = action.payload
    },
    setCodeExecution: (state, action: PayloadAction<{ enabled?: boolean; timeoutMinutes?: number }>) => {
      if (action.payload.enabled !== undefined) {
        state.codeExecution.enabled = action.payload.enabled
      }
      if (action.payload.timeoutMinutes !== undefined) {
        state.codeExecution.timeoutMinutes = action.payload.timeoutMinutes
      }
    },
    setCodeEditor: (
      state,
      action: PayloadAction<{
        enabled?: boolean
        themeLight?: string
        themeDark?: string
        highlightActiveLine?: boolean
        foldGutter?: boolean
        autocompletion?: boolean
        keymap?: boolean
      }>
    ) => {
      if (action.payload.enabled !== undefined) {
        state.codeEditor.enabled = action.payload.enabled
      }
      if (action.payload.themeLight !== undefined) {
        state.codeEditor.themeLight = action.payload.themeLight
      }
      if (action.payload.themeDark !== undefined) {
        state.codeEditor.themeDark = action.payload.themeDark
      }
      if (action.payload.highlightActiveLine !== undefined) {
        state.codeEditor.highlightActiveLine = action.payload.highlightActiveLine
      }
      if (action.payload.foldGutter !== undefined) {
        state.codeEditor.foldGutter = action.payload.foldGutter
      }
      if (action.payload.autocompletion !== undefined) {
        state.codeEditor.autocompletion = action.payload.autocompletion
      }
      if (action.payload.keymap !== undefined) {
        state.codeEditor.keymap = action.payload.keymap
      }
    },
    setCodePreview: (state, action: PayloadAction<{ themeLight?: string; themeDark?: string }>) => {
      if (action.payload.themeLight !== undefined) {
        state.codePreview.themeLight = action.payload.themeLight
      }
      if (action.payload.themeDark !== undefined) {
        state.codePreview.themeDark = action.payload.themeDark
      }
    },
    setCodeShowLineNumbers: (state, action: PayloadAction<boolean>) => {
      state.codeShowLineNumbers = action.payload
    },
    setCodeCollapsible: (state, action: PayloadAction<boolean>) => {
      state.codeCollapsible = action.payload
    },
    setCodeWrappable: (state, action: PayloadAction<boolean>) => {
      state.codeWrappable = action.payload
    },
    setMathEngine: (state, action: PayloadAction<MathEngine>) => {
      state.mathEngine = action.payload
    },
    setFoldDisplayMode: (state, action: PayloadAction<'expanded' | 'compact'>) => {
      state.foldDisplayMode = action.payload
    },
    setGridColumns: (state, action: PayloadAction<number>) => {
      state.gridColumns = action.payload
    },
    setGridPopoverTrigger: (state, action: PayloadAction<'hover' | 'click'>) => {
      state.gridPopoverTrigger = action.payload
    },
    setMessageStyle: (state, action: PayloadAction<'plain' | 'bubble'>) => {
      state.messageStyle = action.payload
    },
    setTranslateModelPrompt: (state, action: PayloadAction<string>) => {
      state.translateModelPrompt = action.payload
    },
    setAutoTranslateWithSpace: (state, action: PayloadAction<boolean>) => {
      state.autoTranslateWithSpace = action.payload
    },
    setShowTranslateConfirm: (state, action: PayloadAction<boolean>) => {
      state.showTranslateConfirm = action.payload
    },
    setEnableTopicNaming: (state, action: PayloadAction<boolean>) => {
      state.enableTopicNaming = action.payload
    },
    setPasteLongTextThreshold: (state, action: PayloadAction<number>) => {
      state.pasteLongTextThreshold = action.payload
    },
    setTopicNamingPrompt: (state, action: PayloadAction<string>) => {
      state.topicNamingPrompt = action.payload
    },
    setSidebarIcons: (state, action: PayloadAction<{ visible?: SidebarIcon[]; disabled?: SidebarIcon[] }>) => {
      if (action.payload.visible) {
        state.sidebarIcons.visible = action.payload.visible
      }
      if (action.payload.disabled) {
        state.sidebarIcons.disabled = action.payload.disabled
      }
    },
    setNarrowMode: (state, action: PayloadAction<boolean>) => {
      state.narrowMode = action.payload
    },
    setClickTrayToShowQuickAssistant: (state, action: PayloadAction<boolean>) => {
      state.clickTrayToShowQuickAssistant = action.payload
    },
    setEnableQuickAssistant: (state, action: PayloadAction<boolean>) => {
      state.enableQuickAssistant = action.payload
    },
    setReadClipboardAtStartup: (state, action: PayloadAction<boolean>) => {
      state.readClipboardAtStartup = action.payload
    },
    setMultiModelMessageStyle: (state, action: PayloadAction<'horizontal' | 'vertical' | 'fold' | 'grid'>) => {
      state.multiModelMessageStyle = action.payload
    },
    setNotionDatabaseID: (state, action: PayloadAction<string>) => {
      state.notionDatabaseID = action.payload
    },
    setNotionApiKey: (state, action: PayloadAction<string>) => {
      state.notionApiKey = action.payload
    },
    setNotionPageNameKey: (state, action: PayloadAction<string>) => {
      state.notionPageNameKey = action.payload
    },
    setmarkdownExportPath: (state, action: PayloadAction<string | null>) => {
      state.markdownExportPath = action.payload
    },
    setForceDollarMathInMarkdown: (state, action: PayloadAction<boolean>) => {
      state.forceDollarMathInMarkdown = action.payload
    },
    setUseTopicNamingForMessageTitle: (state, action: PayloadAction<boolean>) => {
      state.useTopicNamingForMessageTitle = action.payload
    },
    setShowModelNameInMarkdown: (state, action: PayloadAction<boolean>) => {
      state.showModelNameInMarkdown = action.payload
    },
    setShowModelProviderInMarkdown: (state, action: PayloadAction<boolean>) => {
      state.showModelProviderInMarkdown = action.payload
    },
    setThoughtAutoCollapse: (state, action: PayloadAction<boolean>) => {
      state.thoughtAutoCollapse = action.payload
    },
    setNotionExportReasoning: (state, action: PayloadAction<boolean>) => {
      state.notionExportReasoning = action.payload
    },
    setYuqueToken: (state, action: PayloadAction<string>) => {
      state.yuqueToken = action.payload
    },
    setYuqueRepoId: (state, action: PayloadAction<string>) => {
      state.yuqueRepoId = action.payload
    },
    setYuqueUrl: (state, action: PayloadAction<string>) => {
      state.yuqueUrl = action.payload
    },
    setJoplinToken: (state, action: PayloadAction<string>) => {
      state.joplinToken = action.payload
    },
    setJoplinUrl: (state, action: PayloadAction<string>) => {
      state.joplinUrl = action.payload
    },
    setJoplinExportReasoning: (state, action: PayloadAction<boolean>) => {
      state.joplinExportReasoning = action.payload
    },
    setMessageNavigation: (state, action: PayloadAction<'none' | 'buttons' | 'anchor'>) => {
      state.messageNavigation = action.payload
    },
    setDefaultObsidianVault: (state, action: PayloadAction<string>) => {
      state.defaultObsidianVault = action.payload
    },
    setDefaultAgent: (state, action: PayloadAction<string>) => {
      state.defaultAgent = action.payload
    },
    setSiyuanApiUrl: (state, action: PayloadAction<string>) => {
      state.siyuanApiUrl = action.payload
    },
    setSiyuanToken: (state, action: PayloadAction<string>) => {
      state.siyuanToken = action.payload
    },
    setSiyuanBoxId: (state, action: PayloadAction<string>) => {
      state.siyuanBoxId = action.payload
    },
    setSiyuanRootPath: (state, action: PayloadAction<string>) => {
      state.siyuanRootPath = action.payload
    },
    setAgentssubscribeUrl: (state, action: PayloadAction<string>) => {
      state.agentssubscribeUrl = action.payload
    },
    setMaxKeepAliveMinapps: (state, action: PayloadAction<number>) => {
      state.maxKeepAliveMinapps = action.payload
    },
    setShowOpenedMinappsInSidebar: (state, action: PayloadAction<boolean>) => {
      state.showOpenedMinappsInSidebar = action.payload
    },
    setMinappsOpenLinkExternal: (state, action: PayloadAction<boolean>) => {
      state.minappsOpenLinkExternal = action.payload
    },
    setEnableDataCollection: (state, action: PayloadAction<boolean>) => {
      state.enableDataCollection = action.payload
    },
    setEnableSpellCheck: (state, action: PayloadAction<boolean>) => {
      state.enableSpellCheck = action.payload
    },
    setSpellCheckLanguages: (state, action: PayloadAction<string[]>) => {
      state.spellCheckLanguages = action.payload
    },
    setExportMenuOptions: (state, action: PayloadAction<typeof initialState.exportMenuOptions>) => {
      state.exportMenuOptions = action.payload
    },
    setEnableQuickPanelTriggers: (state, action: PayloadAction<boolean>) => {
      state.enableQuickPanelTriggers = action.payload
    },
    setEnableBackspaceDeleteModel: (state, action: PayloadAction<boolean>) => {
      state.enableBackspaceDeleteModel = action.payload
    },
    setDisableHardwareAcceleration: (state, action: PayloadAction<boolean>) => {
      state.disableHardwareAcceleration = action.payload
    },
    setOpenAISummaryText: (state, action: PayloadAction<OpenAISummaryText>) => {
      state.openAI.summaryText = action.payload
    },
    setOpenAIServiceTier: (state, action: PayloadAction<OpenAIServiceTier>) => {
      state.openAI.serviceTier = action.payload
    },
    setNotificationSettings: (state, action: PayloadAction<SettingsState['notification']>) => {
      state.notification = action.payload
    },
    // Local backup settings
    setLocalBackupDir: (state, action: PayloadAction<string>) => {
      state.localBackupDir = action.payload
    },
    setLocalBackupAutoSync: (state, action: PayloadAction<boolean>) => {
      state.localBackupAutoSync = action.payload
    },
    setLocalBackupSyncInterval: (state, action: PayloadAction<number>) => {
      state.localBackupSyncInterval = action.payload
    },
    setLocalBackupMaxBackups: (state, action: PayloadAction<number>) => {
      state.localBackupMaxBackups = action.payload
    },
    setLocalBackupSkipBackupFile: (state, action: PayloadAction<boolean>) => {
      state.localBackupSkipBackupFile = action.payload
    },
    setDefaultPaintingProvider: (state, action: PayloadAction<PaintingProvider>) => {
      state.defaultPaintingProvider = action.payload
    },
    setS3: (state, action: PayloadAction<S3Config>) => {
      state.s3 = action.payload
    },
    setS3Partial: (state, action: PayloadAction<Partial<S3Config>>) => {
      state.s3 = { ...state.s3, ...action.payload }
    }
  }
})

export const {
  setShowModelNameInMarkdown,
  setShowModelProviderInMarkdown,
  setShowAssistants,
  toggleShowAssistants,
  setShowTopics,
  toggleShowTopics,
  setAssistantsTabSortType,
  setSendMessageShortcut,
  setLanguage,
  setTargetLanguage,
  setProxyMode,
  setProxyUrl,
  setUserName,
  setShowPrompt,
  setShowTokens,
  setShowMessageDivider,
  setMessageFont,
  setShowInputEstimatedTokens,
  setLaunchOnBoot,
  setLaunchToTray,
  setTrayOnClose,
  setTray,
  setTheme,
  setUserTheme,
  setFontSize,
  setWindowStyle,
  setTopicPosition,
  setShowTopicTime,
  setPinTopicsToTop,
  setAssistantIconType,
  setPasteLongTextAsFile,
  setAutoCheckUpdate,
  setTestPlan,
  setTestChannel,
  setRenderInputMessageAsMarkdown,
  setClickAssistantToShowTopic,
  setSkipBackupFile,
  setWebdavHost,
  setWebdavUser,
  setWebdavPass,
  setWebdavPath,
  setWebdavAutoSync,
  setWebdavSyncInterval,
  setWebdavMaxBackups,
  setWebdavSkipBackupFile,
  setWebdavDisableStream,
  setCodeExecution,
  setCodeEditor,
  setCodePreview,
  setCodeShowLineNumbers,
  setCodeCollapsible,
  setCodeWrappable,
  setMathEngine,
  setFoldDisplayMode,
  setGridColumns,
  setGridPopoverTrigger,
  setMessageStyle,
  setTranslateModelPrompt,
  setAutoTranslateWithSpace,
  setShowTranslateConfirm,
  setEnableTopicNaming,
  setPasteLongTextThreshold,
  setCustomCss,
  setTopicNamingPrompt,
  setSidebarIcons,
  setNarrowMode,
  setClickTrayToShowQuickAssistant,
  setEnableQuickAssistant,
  setReadClipboardAtStartup,
  setMultiModelMessageStyle,
  setNotionDatabaseID,
  setNotionApiKey,
  setNotionPageNameKey,
  setmarkdownExportPath,
  setForceDollarMathInMarkdown,
  setUseTopicNamingForMessageTitle,
  setThoughtAutoCollapse,
  setNotionExportReasoning,
  setYuqueToken,
  setYuqueRepoId,
  setYuqueUrl,
  setJoplinToken,
  setJoplinUrl,
  setJoplinExportReasoning,
  setMessageNavigation,
  setDefaultObsidianVault,
  setDefaultAgent,
  setSiyuanApiUrl,
  setSiyuanToken,
  setSiyuanBoxId,
  setAgentssubscribeUrl,
  setSiyuanRootPath,
  setMaxKeepAliveMinapps,
  setShowOpenedMinappsInSidebar,
  setMinappsOpenLinkExternal,
  setEnableDataCollection,
  setEnableSpellCheck,
  setSpellCheckLanguages,
  setExportMenuOptions,
  setEnableQuickPanelTriggers,
  setEnableBackspaceDeleteModel,
  setDisableHardwareAcceleration,
  setOpenAISummaryText,
  setOpenAIServiceTier,
  setNotificationSettings,
  // Local backup settings
  setLocalBackupDir,
  setLocalBackupAutoSync,
  setLocalBackupSyncInterval,
  setLocalBackupMaxBackups,
  setLocalBackupSkipBackupFile,
  setDefaultPaintingProvider,
  setS3,
  setS3Partial
} = settingsSlice.actions

export default settingsSlice.reducer
