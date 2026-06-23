/**
 * 对于需要动态获取的翻译文本：
 * 1. 储存 key -> i18n-key 的 keyMap
 * 2. 通过函数翻译文本
 */

import { loggerService } from '@logger'
import type { BuiltinMcpServerName } from '@renderer/types'
import { BuiltinMcpServerNames } from '@renderer/types'

const logger = loggerService.withContext('i18n:label')

const getLabelKey = (keyMap: Record<string, string>, key: string, fallback?: string) => {
  const labelKey = keyMap[key]
  if (labelKey) {
    return labelKey
  } else {
    logger.error(`Missing key ${key}`)
    return fallback ?? key
  }
}

const providerKeyMap = {
  '302ai': 'provider.302ai',
  aihubmix: 'provider.aihubmix',
  alayanew: 'provider.alayanew',
  anthropic: 'provider.anthropic',
  'aws-bedrock': 'provider.aws-bedrock',
  'azure-openai': 'provider.azure-openai',
  baichuan: 'provider.baichuan',
  'baidu-cloud': 'provider.baidu-cloud',
  burncloud: 'provider.burncloud',
  cephalon: 'provider.cephalon',
  cherryai: 'provider.cherryai',
  cherryin: 'provider.cherryin',
  copilot: 'provider.copilot',
  dashscope: 'provider.dashscope',
  deepseek: 'provider.deepseek',
  dmxapi: 'provider.dmxapi',
  doubao: 'provider.doubao',
  fireworks: 'provider.fireworks',
  gemini: 'provider.gemini',
  'gitee-ai': 'provider.gitee-ai',
  github: 'provider.github',
  gpustack: 'provider.gpustack',
  grok: 'provider.grok',
  groq: 'provider.groq',
  hunyuan: 'provider.hunyuan',
  hyperbolic: 'provider.hyperbolic',
  infini: 'provider.infini',
  jina: 'provider.jina',
  lanyun: 'provider.lanyun',
  lmstudio: 'provider.lmstudio',
  minimax: 'provider.minimax',
  mistral: 'provider.mistral',
  modelscope: 'provider.modelscope',
  moonshot: 'provider.moonshot',
  'new-api': 'provider.new-api',
  nvidia: 'provider.nvidia',
  o3: 'provider.o3',
  ocoolai: 'provider.ocoolai',
  ovms: 'provider.ovms',
  ollama: 'provider.ollama',
  openai: 'provider.openai',
  openrouter: 'provider.openrouter',
  perplexity: 'provider.perplexity',
  ph8: 'provider.ph8',
  ppio: 'provider.ppio',
  qiniu: 'provider.qiniu',
  qwenlm: 'provider.qwenlm',
  silicon: 'provider.silicon',
  stepfun: 'provider.stepfun',
  'tencent-cloud-ti': 'provider.tencent-cloud-ti',
  together: 'provider.together',
  tokenflux: 'provider.tokenflux',
  vertexai: 'provider.vertexai',
  voyageai: 'provider.voyageai',
  xirang: 'provider.xirang',
  yi: 'provider.yi',
  zhinao: 'provider.zhinao',
  zhipu: 'provider.zhipu',
  poe: 'provider.poe',
  aionly: 'provider.aionly',
  longcat: 'provider.longcat',
  huggingface: 'provider.huggingface',
  sophnet: 'provider.sophnet',
  gateway: 'provider.ai-gateway',
  cerebras: 'provider.cerebras',
  mimo: 'provider.mimo',
  'minimax-global': 'provider.minimax-global',
  zai: 'provider.zai'
} as const

/**
 * 获取内置供应商的本地化标签
 * @param id - 供应商的id
 * @returns 本地化后的供应商名称
 * @remarks
 * 该函数仅用于获取内置供应商的 i18n label
 *
 * 对于可能处理自定义供应商的情况，使用 getProviderName 或 getFancyProviderName 更安全
 */
export const getProviderLabelKey = (id: string): string => {
  return getLabelKey(providerKeyMap, id)
}

const fileProcessorKeyMap = {
  doc2x: 'provider.doc2x',
  mineru: 'provider.mineru',
  ovocr: 'provider.ovocr',
  paddleocr: 'provider.paddleocr',
  system: 'provider.system',
  tesseract: 'provider.tesseract',
  mistral: 'provider.mistral',
  'open-mineru': 'provider.open-mineru'
} as const

export const getFileProcessorLabelKey = (id: string): string => {
  return getLabelKey(fileProcessorKeyMap, id)
}

const backupProgressKeyMap = {
  completed: 'backup.progress.completed',
  compressing: 'backup.progress.compressing',
  copying_database: 'backup.progress.copying_database',
  copying_files: 'backup.progress.copying_files',
  preparing: 'backup.progress.preparing',
  preparing_compression: 'backup.progress.preparing_compression',
  title: 'backup.progress.title',
  writing_data: 'backup.progress.writing_data'
} as const

export const getBackupProgressLabelKey = (key: string): string => {
  return getLabelKey(backupProgressKeyMap, key)
}

const restoreProgressKeyMap = {
  completed: 'restore.progress.completed',
  copying_files: 'restore.progress.copying_files',
  extracted: 'restore.progress.extracted',
  extracting: 'restore.progress.extracting',
  preparing: 'restore.progress.preparing',
  reading_data: 'restore.progress.reading_data',
  restoring_data: 'restore.progress.restoring_data',
  restoring_database: 'restore.progress.restoring_database',
  title: 'restore.progress.title',
  validating: 'restore.progress.validating'
}

export const getRestoreProgressLabelKey = (key: string): string => {
  return getLabelKey(restoreProgressKeyMap, key)
}

const titleKeyMap = {
  // TODO: update i18n key
  store: 'title.store',
  apps: 'title.apps',
  code: 'title.code',
  files: 'title.files',
  home: 'title.home',
  knowledge: 'title.knowledge',
  launchpad: 'title.launchpad',
  library: 'library.title',
  'mcp-servers': 'title.mcp-servers',
  notes: 'title.notes',
  paintings: 'title.paintings',
  settings: 'title.settings',
  translate: 'title.translate',
  openclaw: 'openclaw.title',
  agents: 'agent.sidebar_title'
} as const

export const getTitleLabelKey = (key: string): string => {
  return getLabelKey(titleKeyMap, key)
}

const themeModeKeyMap = {
  dark: 'settings.theme.dark',
  light: 'settings.theme.light',
  system: 'settings.theme.system'
} as const

export const getThemeModeLabelKey = (key: string): string => {
  return getLabelKey(themeModeKeyMap, key)
}

const sidebarIconKeyMap = {
  assistants: 'agent.session.group.conversation',
  agents: 'title.work',
  store: 'assistants.presets.title',
  paintings: 'paintings.title',
  translate: 'translate.title',
  mini_app: 'miniApp.title',
  knowledge: 'knowledge.title',
  files: 'files.title',
  code_tools: 'code.title',
  notes: 'notes.title',
  openclaw: 'openclaw.title'
} as const

export const getSidebarIconLabelKey = (key: string): string => {
  return getLabelKey(sidebarIconKeyMap, key)
}

// Transitional: feat renamed this to `getSidebarIconLabelKey` (above) and deleted
// the old one, but main's `components/app/Sidebar` still calls it. Kept until the
// chat carve brings feat's Sidebar; remove together with that.
const sidebarFavoriteKeyMap = {
  assistants: 'assistants.title',
  agents: 'title.work',
  store: 'assistants.presets.title',
  paintings: 'paintings.title',
  translate: 'translate.title',
  mini_app: 'miniApp.title',
  knowledge: 'knowledge.title',
  files: 'files.title',
  code_tools: 'code.title',
  notes: 'notes.title',
  openclaw: 'openclaw.title'
} as const
export const getSidebarFavoriteLabelKey = (key: string): string => {
  return getLabelKey(sidebarFavoriteKeyMap, key)
}

const selectionDescriptionKeyMap = {
  linux: 'selection.settings.toolbar.trigger_mode.description_note.linux',
  mac: 'selection.settings.toolbar.trigger_mode.description_note.mac',
  windows: 'selection.settings.toolbar.trigger_mode.description_note.windows'
} as const

export const getSelectionDescriptionLabelKey = (key: string): string => {
  return getLabelKey(selectionDescriptionKeyMap, key)
}

const paintingsImageSizeOptionsKeyMap = {
  auto: 'paintings.image_size_options.auto'
} as const

export const getPaintingsImageSizeOptionsLabelKey = (key: string): string => {
  return paintingsImageSizeOptionsKeyMap[key] ? getLabelKey(paintingsImageSizeOptionsKeyMap, key) : key
}

const paintingsQualityOptionsKeyMap = {
  auto: 'paintings.quality_options.auto',
  high: 'paintings.quality_options.high',
  low: 'paintings.quality_options.low',
  medium: 'paintings.quality_options.medium'
} as const

export const getPaintingsQualityOptionsLabelKey = (key: string): string => {
  return getLabelKey(paintingsQualityOptionsKeyMap, key)
}

const paintingsModerationOptionsKeyMap = {
  auto: 'paintings.moderation_options.auto',
  low: 'paintings.moderation_options.low'
} as const

export const getPaintingsModerationOptionsLabelKey = (key: string): string => {
  return getLabelKey(paintingsModerationOptionsKeyMap, key)
}

const paintingsBackgroundOptionsKeyMap = {
  auto: 'paintings.background_options.auto',
  opaque: 'paintings.background_options.opaque',
  transparent: 'paintings.background_options.transparent'
} as const

export const getPaintingsBackgroundOptionsLabelKey = (key: string): string => {
  return getLabelKey(paintingsBackgroundOptionsKeyMap, key)
}

const mcpTypeKeyMap = {
  inMemory: 'settings.mcp.types.inMemory',
  sse: 'settings.mcp.types.sse',
  stdio: 'settings.mcp.types.stdio',
  streamableHttp: 'settings.mcp.types.streamableHttp'
} as const

export const getMcpTypeLabelKey = (key: string): string => {
  return getLabelKey(mcpTypeKeyMap, key)
}

const mcpProviderDescriptionKeyMap = {
  '302ai': 'settings.mcp.sync.providerDescriptions.302ai',
  bailian: 'settings.mcp.sync.providerDescriptions.bailian',
  lanyun: 'settings.mcp.sync.providerDescriptions.lanyun',
  mcprouter: 'settings.mcp.sync.providerDescriptions.mcprouter',
  modelscope: 'settings.mcp.sync.providerDescriptions.modelscope'
} as const

export const getMcpProviderDescriptionLabelKey = (key: string): string => {
  return getLabelKey(mcpProviderDescriptionKeyMap, key)
}

const miniAppsStatusKeyMap = {
  visible: 'settings.miniApps.visible',
  disabled: 'settings.miniApps.disabled'
} as const

export const getMiniAppsStatusLabelKey = (key: string): string => {
  return getLabelKey(miniAppsStatusKeyMap, key)
}

const httpMessageKeyMap = {
  '400': 'error.http.400',
  '401': 'error.http.401',
  '403': 'error.http.403',
  '404': 'error.http.404',
  '429': 'error.http.429',
  '500': 'error.http.500',
  '502': 'error.http.502',
  '503': 'error.http.503',
  '504': 'error.http.504'
} as const

export const getHttpMessageLabelKey = (key: string): string => {
  return getLabelKey(httpMessageKeyMap, key)
}

const fileFieldKeyMap = {
  created_at: 'files.created_at',
  size: 'files.size',
  name: 'files.name'
} as const

export const getFileFieldLabelKey = (key: string): string => {
  return getLabelKey(fileFieldKeyMap, key)
}

const builtInMcpDescriptionKeyMap: Record<BuiltinMcpServerName, string> = {
  [BuiltinMcpServerNames.flomo]: 'settings.mcp.builtinServersDescriptions.flomo',
  [BuiltinMcpServerNames.mcpAutoInstall]: 'settings.mcp.builtinServersDescriptions.mcp_auto_install',
  [BuiltinMcpServerNames.memory]: 'settings.mcp.builtinServersDescriptions.memory',
  [BuiltinMcpServerNames.sequentialThinking]: 'settings.mcp.builtinServersDescriptions.sequentialthinking',
  [BuiltinMcpServerNames.braveSearch]: 'settings.mcp.builtinServersDescriptions.brave_search',
  [BuiltinMcpServerNames.fetch]: 'settings.mcp.builtinServersDescriptions.fetch',
  [BuiltinMcpServerNames.filesystem]: 'settings.mcp.builtinServersDescriptions.filesystem',
  [BuiltinMcpServerNames.difyKnowledge]: 'settings.mcp.builtinServersDescriptions.dify_knowledge',
  [BuiltinMcpServerNames.python]: 'settings.mcp.builtinServersDescriptions.python',
  [BuiltinMcpServerNames.didiMcp]: 'settings.mcp.builtinServersDescriptions.didi_mcp',
  [BuiltinMcpServerNames.browser]: 'settings.mcp.builtinServersDescriptions.browser',
  [BuiltinMcpServerNames.nowledgeMem]: 'settings.mcp.builtinServersDescriptions.nowledge_mem',
  [BuiltinMcpServerNames.hub]: 'settings.mcp.builtinServersDescriptions.hub'
} as const

export const getBuiltInMcpServerDescriptionLabelKey = (key: string): string => {
  return getLabelKey(builtInMcpDescriptionKeyMap, key, 'settings.mcp.builtinServersDescriptions.no')
}
