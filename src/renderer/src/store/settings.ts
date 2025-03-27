import { createSlice, PayloadAction } from '@reduxjs/toolkit'
import { TRANSLATE_PROMPT } from '@renderer/config/prompts'
import { CodeStyleVarious, LanguageVarious, ThemeMode, TranslateLanguageVarious } from '@renderer/types'

import { WebDAVSyncState } from './backup'

export type SendMessageShortcut = 'Enter' | 'Shift+Enter' | 'Ctrl+Enter' | 'Command+Enter'

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

export interface NutstoreSyncRuntime extends WebDAVSyncState {}

export interface SettingsState {
  showAssistants: boolean
  showTopics: boolean
  sendMessageShortcut: SendMessageShortcut
  language: LanguageVarious
  targetLanguage: TranslateLanguageVarious
  proxyMode: 'system' | 'custom' | 'none'
  proxyUrl?: string
  userName: string
  showMessageDivider: boolean
  messageFont: 'system' | 'serif'
  showInputEstimatedTokens: boolean
  launchOnBoot: boolean
  launchToTray: boolean
  trayOnClose: boolean
  tray: boolean
  theme: ThemeMode
  windowStyle: 'transparent' | 'opaque'
  fontSize: number
  topicPosition: 'left' | 'right'
  showTopicTime: boolean
  showAssistantIcon: boolean
  pasteLongTextAsFile: boolean
  pasteLongTextThreshold: number
  clickAssistantToShowTopic: boolean
  autoCheckUpdate: boolean
  renderInputMessageAsMarkdown: boolean
  codeShowLineNumbers: boolean
  codeCollapsible: boolean
  codeWrappable: boolean
  mathEngine: 'MathJax' | 'KaTeX'
  messageStyle: 'plain' | 'bubble'
  codeStyle: CodeStyleVarious
  foldDisplayMode: 'expanded' | 'compact'
  gridColumns: number
  gridPopoverTrigger: 'hover' | 'click'
  messageNavigation: 'none' | 'buttons' | 'anchor'
  // TTS 设置
  ttsEnabled: boolean
  ttsType: 'openai' | 'edge' // TTS类型，新增：openai或edge
  ttsApiUrl: string
  ttsApiKey: string
  ttsModel: string
  ttsVoice: string
  ttsPlayerType: 'auto' | 'ffmpeg' | 'system'
  ttsEdgeRate: string // Edge TTS语速设置，新增
  ttsEdgeVolume: string // Edge TTS音量设置，新增
  // 注：系统会自动清理1小时前创建的临时音频文件
  ttsCustomModels: Array<{ label?: string; value: string }>
  ttsCustomVoices: Array<{ label?: string; value: string }>
  // webdav 配置 host, user, pass, path
  webdavHost: string
  webdavUser: string
  webdavPass: string
  webdavPath: string
  webdavAutoSync: boolean
  webdavSyncInterval: number
  translateModelPrompt: string
  autoTranslateWithSpace: boolean
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
  thoughtAutoCollapse: boolean
  notionAutoSplit: boolean
  notionSplitSize: number
  yuqueToken: string | null
  yuqueUrl: string | null
  yuqueRepoId: string | null
  joplinToken: string | null
  joplinUrl: string | null
  defaultObsidianVault: string | null
  // 思源笔记配置
  siyuanApiUrl: string | null
  siyuanToken: string | null
  siyuanBoxId: string | null
  siyuanRootPath: string | null
}

export type MultiModelMessageStyle = 'horizontal' | 'vertical' | 'fold' | 'grid'

const initialState: SettingsState = {
  showAssistants: true,
  showTopics: true,
  sendMessageShortcut: 'Enter',
  language: navigator.language as LanguageVarious,
  targetLanguage: 'english' as TranslateLanguageVarious,
  proxyMode: 'system',
  proxyUrl: undefined,
  userName: '',
  showMessageDivider: true,
  messageFont: 'system',
  showInputEstimatedTokens: false,
  launchOnBoot: false,
  launchToTray: false,
  trayOnClose: true,
  tray: true,
  theme: ThemeMode.auto,
  windowStyle: 'transparent',
  fontSize: 14,
  topicPosition: 'left',
  showTopicTime: false,
  showAssistantIcon: false,
  pasteLongTextAsFile: false,
  pasteLongTextThreshold: 1500,
  clickAssistantToShowTopic: false,
  autoCheckUpdate: true,
  renderInputMessageAsMarkdown: false,
  codeShowLineNumbers: false,
  codeCollapsible: false,
  codeWrappable: false,
  mathEngine: 'KaTeX',
  messageStyle: 'plain',
  codeStyle: 'auto',
  foldDisplayMode: 'expanded',
  gridColumns: 2,
  gridPopoverTrigger: 'hover',
  messageNavigation: 'none',
  // TTS 设置
  ttsEnabled: false,
  ttsType: 'openai', // 默认使用OpenAI TTS
  ttsApiUrl: 'https://api.openai.com/v1/audio/speech',
  ttsApiKey: '',
  ttsModel: 'tts-1',
  ttsVoice: 'alloy',
  ttsPlayerType: 'auto', // 'auto', 'ffmpeg', 'system'
  ttsEdgeRate: '+0%', // Edge TTS默认语速
  ttsEdgeVolume: '+0%', // Edge TTS默认音量
  ttsCustomModels: [],
  ttsCustomVoices: [],
  webdavHost: '',
  webdavUser: '',
  webdavPass: '',
  webdavPath: '/cherry-studio',
  webdavAutoSync: false,
  webdavSyncInterval: 0,
  translateModelPrompt: TRANSLATE_PROMPT,
  autoTranslateWithSpace: false,
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
  thoughtAutoCollapse: true,
  notionAutoSplit: false,
  notionSplitSize: 90,
  yuqueToken: '',
  yuqueUrl: '',
  yuqueRepoId: '',
  joplinToken: '',
  joplinUrl: '',
  defaultObsidianVault: null,
  // 思源笔记配置初始值
  siyuanApiUrl: null,
  siyuanToken: null,
  siyuanBoxId: null,
  siyuanRootPath: null
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
    setSendMessageShortcut: (state, action: PayloadAction<SendMessageShortcut>) => {
      state.sendMessageShortcut = action.payload
    },
    setLanguage: (state, action: PayloadAction<LanguageVarious>) => {
      state.language = action.payload
      window.electron.ipcRenderer.send('miniwindow-reload')
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
    setShowAssistantIcon: (state, action: PayloadAction<boolean>) => {
      state.showAssistantIcon = action.payload
    },
    setPasteLongTextAsFile: (state, action: PayloadAction<boolean>) => {
      state.pasteLongTextAsFile = action.payload
    },
    setAutoCheckUpdate: (state, action: PayloadAction<boolean>) => {
      state.autoCheckUpdate = action.payload
    },
    setRenderInputMessageAsMarkdown: (state, action: PayloadAction<boolean>) => {
      state.renderInputMessageAsMarkdown = action.payload
    },
    setClickAssistantToShowTopic: (state, action: PayloadAction<boolean>) => {
      state.clickAssistantToShowTopic = action.payload
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
    setCodeShowLineNumbers: (state, action: PayloadAction<boolean>) => {
      state.codeShowLineNumbers = action.payload
    },
    setCodeCollapsible: (state, action: PayloadAction<boolean>) => {
      state.codeCollapsible = action.payload
    },
    setCodeWrappable: (state, action: PayloadAction<boolean>) => {
      state.codeWrappable = action.payload
    },
    setMathEngine: (state, action: PayloadAction<'MathJax' | 'KaTeX'>) => {
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
    setCodeStyle: (state, action: PayloadAction<CodeStyleVarious>) => {
      state.codeStyle = action.payload
    },
    setTranslateModelPrompt: (state, action: PayloadAction<string>) => {
      state.translateModelPrompt = action.payload
    },
    setAutoTranslateWithSpace: (state, action: PayloadAction<boolean>) => {
      state.autoTranslateWithSpace = action.payload
    },
    setEnableTopicNaming: (state, action: PayloadAction<boolean>) => {
      state.enableTopicNaming = action.payload
    },
    setPasteLongTextThreshold: (state, action: PayloadAction<number>) => {
      state.pasteLongTextThreshold = action.payload
    },
    setCustomCss: (state, action: PayloadAction<string>) => {
      state.customCss = action.payload
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
    setThoughtAutoCollapse: (state, action: PayloadAction<boolean>) => {
      state.thoughtAutoCollapse = action.payload
    },
    setNotionAutoSplit: (state, action: PayloadAction<boolean>) => {
      state.notionAutoSplit = action.payload
    },
    setNotionSplitSize: (state, action: PayloadAction<number>) => {
      state.notionSplitSize = action.payload
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
    setMessageNavigation: (state, action: PayloadAction<'none' | 'buttons' | 'anchor'>) => {
      state.messageNavigation = action.payload
    },
    // TTS相关设置
    setTtsEnabled: (state, action: PayloadAction<boolean>) => {
      state.ttsEnabled = action.payload
    },
    setTtsType: (state, action: PayloadAction<'openai' | 'edge'>) => {
      state.ttsType = action.payload
    },
    setTtsApiUrl: (state, action: PayloadAction<string>) => {
      state.ttsApiUrl = action.payload
    },
    setTtsApiKey: (state, action: PayloadAction<string>) => {
      state.ttsApiKey = action.payload
    },
    setTtsModel: (state, action: PayloadAction<string>) => {
      state.ttsModel = action.payload
    },
    setTtsVoice: (state, action: PayloadAction<string>) => {
      state.ttsVoice = action.payload
    },
    setTtsPlayerType: (state, action: PayloadAction<'auto' | 'ffmpeg' | 'system'>) => {
      state.ttsPlayerType = action.payload
    },
    setTtsEdgeRate: (state, action: PayloadAction<string>) => {
      state.ttsEdgeRate = action.payload
    },
    setTtsEdgeVolume: (state, action: PayloadAction<string>) => {
      state.ttsEdgeVolume = action.payload
    },
    setTtsCustomModels: (state, action: PayloadAction<Array<{ label?: string; value: string }>>) => {
      state.ttsCustomModels = action.payload
    },
    setTtsCustomVoices: (state, action: PayloadAction<Array<{ label?: string; value: string }>>) => {
      state.ttsCustomVoices = action.payload
    },
    setDefaultObsidianVault: (state, action: PayloadAction<string>) => {
      state.defaultObsidianVault = action.payload
    }
  }
})

export const {
  setShowAssistants,
  toggleShowAssistants,
  setShowTopics,
  toggleShowTopics,
  setSendMessageShortcut,
  setLanguage,
  setTargetLanguage,
  setProxyMode,
  setProxyUrl,
  setUserName,
  setShowMessageDivider,
  setMessageFont,
  setShowInputEstimatedTokens,
  setLaunchOnBoot,
  setLaunchToTray,
  setTrayOnClose,
  setTray,
  setTheme,
  setFontSize,
  setWindowStyle,
  setTopicPosition,
  setShowTopicTime,
  setShowAssistantIcon,
  setPasteLongTextAsFile,
  setAutoCheckUpdate,
  setRenderInputMessageAsMarkdown,
  setClickAssistantToShowTopic,
  setWebdavHost,
  setWebdavUser,
  setWebdavPass,
  setWebdavPath,
  setWebdavAutoSync,
  setWebdavSyncInterval,
  setCodeShowLineNumbers,
  setCodeCollapsible,
  setCodeWrappable,
  setMathEngine,
  setFoldDisplayMode,
  setGridColumns,
  setGridPopoverTrigger,
  setMessageStyle,
  setCodeStyle,
  setTranslateModelPrompt,
  setAutoTranslateWithSpace,
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
  setThoughtAutoCollapse,
  setNotionAutoSplit,
  setNotionSplitSize,
  setYuqueToken,
  setYuqueRepoId,
  setYuqueUrl,
  setJoplinToken,
  setJoplinUrl,
  setMessageNavigation,
  setDefaultObsidianVault,
  setSiyuanApiUrl,
  setSiyuanToken,
  setSiyuanBoxId,
  setSiyuanRootPath,
  // TTS actions
  setTtsEnabled,
  setTtsType,
  setTtsApiUrl,
  setTtsApiKey,
  setTtsModel,
  setTtsVoice,
  setTtsPlayerType,
  setTtsEdgeRate,
  setTtsEdgeVolume,
  setTtsCustomModels,
  setTtsCustomVoices
} = settingsSlice.actions

export default settingsSlice.reducer
