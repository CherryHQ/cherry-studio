/**
 * 对于需要动态获取的翻译文本：
 * 1. 储存 key -> i18n-key 的 keyMap
 * 2. 通过函数翻译文本
 */

import { loggerService } from '@logger'
import { ThinkingOption } from '@renderer/types'

import i18n from './index'

const t = i18n.t

const logger = loggerService.withContext('i18n:label')

const getLabel = (key: string, keyMap: Record<string, string>, fallback?: string) => {
  const result = keyMap[key]
  if (result) {
    return t(result)
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
  poe: 'provider.poe'
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
export const getProviderLabel = (id: string): string => {
  return getLabel(id, providerKeyMap)
}

const progressKeyMap = {
  completed: 'backup.progress.completed',
  compressing: 'backup.progress.compressing',
  copying_files: 'backup.progress.copying_files',
  preparing: 'backup.progress.preparing',
  title: 'backup.progress.title',
  writing_data: 'backup.progress.writing_data'
} as const

export const getProgressLabel = (key: string): string => {
  return getLabel(key, progressKeyMap)
}

const titleKeyMap = {
  agents: 'title.agents',
  apps: 'title.apps',
  code: 'title.code',
  files: 'title.files',
  home: 'title.home',
  knowledge: 'title.knowledge',
  launchpad: 'title.launchpad',
  'mcp-servers': 'title.mcp-servers',
  memories: 'title.memories',
  paintings: 'title.paintings',
  settings: 'title.settings',
  translate: 'title.translate'
} as const

export const getTitleLabel = (key: string): string => {
  return getLabel(key, titleKeyMap)
}

const themeModeKeyMap = {
  dark: 'settings.theme.dark',
  light: 'settings.theme.light',
  system: 'settings.theme.system'
} as const

export const getThemeModeLabel = (key: string): string => {
  return getLabel(key, themeModeKeyMap)
}

const sidebarIconKeyMap = {
  assistants: 'assistants.title',
  agents: 'agents.title',
  paintings: 'paintings.title',
  translate: 'translate.title',
  minapp: 'minapp.title',
  knowledge: 'knowledge.title',
  files: 'files.title'
} as const

export const getSidebarIconLabel = (key: string): string => {
  return getLabel(key, sidebarIconKeyMap)
}

const shortcutKeyMap = {
  action: 'settings.shortcuts.action',
  actions: 'settings.shortcuts.actions',
  clear_shortcut: 'settings.shortcuts.clear_shortcut',
  clear_topic: 'settings.shortcuts.clear_topic',
  copy_last_message: 'settings.shortcuts.copy_last_message',
  enabled: 'settings.shortcuts.enabled',
  exit_fullscreen: 'settings.shortcuts.exit_fullscreen',
  label: 'settings.shortcuts.label',
  mini_window: 'settings.shortcuts.mini_window',
  new_topic: 'settings.shortcuts.new_topic',
  press_shortcut: 'settings.shortcuts.press_shortcut',
  reset_defaults: 'settings.shortcuts.reset_defaults',
  reset_defaults_confirm: 'settings.shortcuts.reset_defaults_confirm',
  reset_to_default: 'settings.shortcuts.reset_to_default',
  search_message: 'settings.shortcuts.search_message',
  search_message_in_chat: 'settings.shortcuts.search_message_in_chat',
  selection_assistant_select_text: 'settings.shortcuts.selection_assistant_select_text',
  selection_assistant_toggle: 'settings.shortcuts.selection_assistant_toggle',
  show_app: 'settings.shortcuts.show_app',
  show_settings: 'settings.shortcuts.show_settings',
  title: 'settings.shortcuts.title',
  toggle_new_context: 'settings.shortcuts.toggle_new_context',
  toggle_show_assistants: 'settings.shortcuts.toggle_show_assistants',
  toggle_show_topics: 'settings.shortcuts.toggle_show_topics',
  zoom_in: 'settings.shortcuts.zoom_in',
  zoom_out: 'settings.shortcuts.zoom_out',
  zoom_reset: 'settings.shortcuts.zoom_reset'
} as const

export const getShortcutLabel = (key: string): string => {
  return getLabel(key, shortcutKeyMap)
}

const selectionDescriptionKeyMap = {
  mac: 'selection.settings.toolbar.trigger_mode.description_note.mac',
  windows: 'selection.settings.toolbar.trigger_mode.description_note.windows'
} as const

export const getSelectionDescriptionLabel = (key: string): string => {
  return getLabel(key, selectionDescriptionKeyMap)
}

const paintingsImageSizeOptionsKeyMap = {
  auto: 'paintings.image_size_options.auto'
} as const

export const getPaintingsImageSizeOptionsLabel = (key: string): string => {
  return getLabel(key, paintingsImageSizeOptionsKeyMap)
}

const paintingsQualityOptionsKeyMap = {
  auto: 'paintings.quality_options.auto',
  high: 'paintings.quality_options.high',
  low: 'paintings.quality_options.low',
  medium: 'paintings.quality_options.medium'
} as const

export const getPaintingsQualityOptionsLabel = (key: string): string => {
  return getLabel(key, paintingsQualityOptionsKeyMap)
}

const paintingsModerationOptionsKeyMap = {
  auto: 'paintings.moderation_options.auto',
  low: 'paintings.moderation_options.low'
} as const

export const getPaintingsModerationOptionsLabel = (key: string): string => {
  return getLabel(key, paintingsModerationOptionsKeyMap)
}

const paintingsBackgroundOptionsKeyMap = {
  auto: 'paintings.background_options.auto',
  opaque: 'paintings.background_options.opaque',
  transparent: 'paintings.background_options.transparent'
} as const

export const getPaintingsBackgroundOptionsLabel = (key: string): string => {
  return getLabel(key, paintingsBackgroundOptionsKeyMap)
}

const mcpTypeKeyMap = {
  inMemory: 'settings.mcp.types.inMemory',
  sse: 'settings.mcp.types.sse',
  stdio: 'settings.mcp.types.stdio',
  streamableHttp: 'settings.mcp.types.streamableHttp'
} as const

export const getMcpTypeLabel = (key: string): string => {
  return getLabel(key, mcpTypeKeyMap)
}

const miniappsStatusKeyMap = {
  visible: 'settings.miniapps.visible',
  disabled: 'settings.miniapps.disabled'
} as const

export const getMiniappsStatusLabel = (key: string): string => {
  return getLabel(key, miniappsStatusKeyMap)
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

export const getHttpMessageLabel = (key: string): string => {
  return getLabel(key, httpMessageKeyMap)
}

const reasoningEffortOptionsKeyMap: Record<ThinkingOption, string> = {
  off: 'assistants.settings.reasoning_effort.off',
  minimal: 'assistants.settings.reasoning_effort.minimal',
  high: 'assistants.settings.reasoning_effort.high',
  low: 'assistants.settings.reasoning_effort.low',
  medium: 'assistants.settings.reasoning_effort.medium',
  auto: 'assistants.settings.reasoning_effort.default'
} as const

export const getReasoningEffortOptionsLabel = (key: string): string => {
  return getLabel(key, reasoningEffortOptionsKeyMap)
}

const fileFieldKeyMap = {
  created_at: 'files.created_at',
  size: 'files.size',
  name: 'files.name'
} as const

export const getFileFieldLabel = (key: string): string => {
  return getLabel(key, fileFieldKeyMap)
}

const builtInMcpDescriptionKeyMap = {
  '@cherry/mcp-auto-install': 'settings.mcp.builtinServersDescriptions.mcp_auto_install',
  '@cherry/memory': 'settings.mcp.builtinServersDescriptions.mcp_auto_install',
  '@cherry/sequentialthinking': 'settings.mcp.builtinServersDescriptions.sequentialthinking',
  '@cherry/brave-search': 'settings.mcp.builtinServersDescriptions.brave_search',
  '@cherry/fetch': 'settings.mcp.builtinServersDescriptions.fetch',
  '@cherry/filesystem': 'settings.mcp.builtinServersDescriptions.filesystem',
  '@cherry/dify-knowledge': 'settings.mcp.builtinServersDescriptions.dify_knowledge',
  '@cherry/python': 'settings.mcp.builtinServersDescriptions.python'
} as const

export const getBuiltInMcpServerDescriptionLabel = (key: string): string => {
  return getLabel(key, builtInMcpDescriptionKeyMap, t('settings.mcp.builtinServersDescriptions.no'))
}
