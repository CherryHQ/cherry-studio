import type { LanguageModelV2Source } from '@ai-sdk/provider'
import type { WebSearchResultBlock } from '@anthropic-ai/sdk/resources'
import type OpenAI from '@cherrystudio/openai'
import type { GenerateImagesConfig, GroundingMetadata, PersonGeneration } from '@google/genai'
import type { CSSProperties } from 'react'

export * from './file'
export * from './note'

import * as z from 'zod'

import type { StreamTextParams } from './aiCoreTypes'
import type { Chunk } from './chunk'
import type { FileMetadata } from './file'
import type { KnowledgeBase, KnowledgeReference } from './knowledge'
import type { MCPConfigSample, MCPServerInstallSource, McpServerType } from './mcp'
import type { Message } from './newMessage'
import { BaseToolSchema, type MCPTool, MCPToolSchema } from './tool'
import { objectValues } from './typeUtils'

export * from './agent'
export * from './apiModels'
export * from './apiServer'
export * from './knowledge'
export * from './mcp'
export * from './notification'
export * from './ocr'
export * from './plugin'
export * from './provider'
export * from './serialize'

export type McpMode = 'disabled' | 'auto' | 'manual'

export type Assistant = {
  id: string
  name: string
  prompt: string
  knowledge_bases?: KnowledgeBase[]
  topics: Topic[]
  type: string
  emoji?: string
  description?: string
  model?: Model
  defaultModel?: Model
  // This field should be considered as not Partial and not optional in v2
  settings?: Partial<AssistantSettings>
  messages?: AssistantMessage[]
  /** enableWebSearch 代表使用模型内置网络搜索功能 */
  enableWebSearch?: boolean
  webSearchProviderId?: WebSearchProvider['id']
  // enableUrlContext 是 Gemini/Anthropic 的特有功能
  enableUrlContext?: boolean
  enableGenerateImage?: boolean
  /** MCP mode: 'disabled' (no MCP), 'auto' (hub server only), 'manual' (user selects servers) */
  mcpMode?: McpMode
  mcpServers?: MCPServer[]
  knowledgeRecognition?: 'off' | 'on'
  regularPhrases?: QuickPhrase[] // Added for regular phrase
  tags?: string[] // 助手标签
  enableMemory?: boolean
  // for translate. 更好的做法是定义base assistant，把 Assistant 作为多种不同定义 assistant 的联合类型，但重构代价太大
  content?: string
  targetLanguage?: TranslateLanguage
}

/**
 * Get the effective MCP mode for an assistant with backward compatibility.
 * Legacy assistants without mcpMode default based on mcpServers presence.
 */
export function getEffectiveMcpMode(assistant: Assistant): McpMode {
  if (assistant.mcpMode) return assistant.mcpMode
  return (assistant.mcpServers?.length ?? 0) > 0 ? 'manual' : 'disabled'
}

export type TranslateAssistant = Assistant & {
  model: Model
  content: string
  targetLanguage: TranslateLanguage
}

export const isTranslateAssistant = (assistant: Assistant): assistant is TranslateAssistant => {
  return (assistant.model && assistant.targetLanguage && typeof assistant.content === 'string') !== undefined
}

export type AssistantsSortType = 'tags' | 'list'

export type AssistantMessage = {
  role: 'user' | 'assistant'
  content: string
}

export type AssistantSettingCustomParameters = {
  name: string
  value: string | number | boolean | object
  type: 'string' | 'number' | 'boolean' | 'json'
}

const ThinkModelTypes = [
  'default',
  'o',
  'openai_deep_research',
  'gpt5',
  'gpt5_1',
  'gpt5_codex',
  'gpt5_1_codex',
  'gpt5_1_codex_max',
  'gpt5_2',
  'gpt5pro',
  'gpt52pro',
  'gpt_oss',
  'grok',
  'grok4_fast',
  'gemini2_flash',
  'gemini2_pro',
  'gemini3_flash',
  'gemini3_pro',
  'gemini3_1_pro',
  'qwen',
  'qwen_thinking',
  'doubao',
  'doubao_no_auto',
  'doubao_after_251015',
  'mimo',
  'hunyuan',
  'zhipu',
  'perplexity',
  'deepseek_hybrid',
  'kimi_k2_5',
  'claude46'
] as const

/** If the model's reasoning effort could be controlled, or its reasoning behavior could be turned on/off.
 * It's basically based on OpenAI's reasoning effort, but we have adapted it for other models.
 *
 * Possible options:
 * - 'none': Disable reasoning for the model. (inherit from OpenAI)
 *            It's also used as "off" when the reasoning behavior of the model only could be set to "on" and "off".
 * - 'minimal': Enable minimal reasoning effort for the model. (inherit from OpenAI, only for few models, such as GPT-5.)
 * - 'low': Enable low reasoning effort for the model. (inherit from OpenAI)
 * - 'medium': Enable medium reasoning effort for the model. (inherit from OpenAI)
 * - 'high': Enable high reasoning effort for the model. (inherit from OpenAI)
 * - 'xhigh': Enable extra high reasoning effort for the model. (inherit from OpenAI)
 * - 'auto': Automatically determine the reasoning effort based on the model's capabilities.
 *            For some providers, it's same with 'default'.
 *            It's also used as "on" when the reasoning behavior of the model only could be set to "on" and "off".
 * - 'default': Depend on default behavior. It means we would not set any reasoning related settings when calling API.
 */
export type ReasoningEffortOption = NonNullable<OpenAI.ReasoningEffort> | 'auto' | 'default'
export type ThinkingOption = ReasoningEffortOption
export type ThinkingModelType = (typeof ThinkModelTypes)[number]
export type ThinkingOptionConfig = Record<ThinkingModelType, ThinkingOption[]>
export type ReasoningEffortConfig = Record<ThinkingModelType, ReasoningEffortOption[]>
export type EffortRatio = Record<ReasoningEffortOption, number>

export function isThinkModelType(type: string): type is ThinkingModelType {
  return ThinkModelTypes.some((t) => t === type)
}

export const EFFORT_RATIO: EffortRatio = {
  // 'default' is not expected to be used.
  default: 0,
  none: 0.01,
  minimal: 0.05,
  low: 0.05,
  medium: 0.5,
  high: 0.8,
  xhigh: 0.9,
  auto: 2
}

export type AssistantSettings = {
  maxTokens?: number
  enableMaxTokens?: boolean
  temperature: number
  enableTemperature?: boolean
  topP: number
  enableTopP?: boolean
  contextCount: number
  streamOutput: boolean
  defaultModel?: Model
  customParameters?: AssistantSettingCustomParameters[]
  reasoning_effort: ReasoningEffortOption
  /**
   * Preserve the effective reasoning effort (not 'default') from the last use of a thinking model which supports thinking control,
   * and restore it when switching back from a non-thinking or fixed reasoning model.
   * FIXME: It should be managed by external cache service instead of being stored in the assistant
   */
  reasoning_effort_cache?: ReasoningEffortOption
  qwenThinkMode?: boolean
  toolUseMode: 'function' | 'prompt'
}

export type AssistantPreset = Omit<Assistant, 'model'> & {
  group?: string[]
}

export type LegacyMessage = {
  id: string
  assistantId: string
  role: 'user' | 'assistant'
  content: string
  reasoning_content?: string
  translatedContent?: string
  topicId: string
  createdAt: string
  status: 'sending' | 'pending' | 'searching' | 'success' | 'paused' | 'error'
  modelId?: string
  model?: Model
  files?: FileMetadata[]
  images?: string[]
  usage?: Usage
  metrics?: Metrics
  knowledgeBaseIds?: string[]
  type: 'text' | '@' | 'clear'
  mentions?: Model[]
  askId?: string
  useful?: boolean
  error?: Record<string, any>
  enabledMCPs?: MCPServer[]
  metadata?: {
    // Gemini
    groundingMetadata?: GroundingMetadata
    // Perplexity Or Openrouter
    citations?: string[]
    // OpenAI
    annotations?: OpenAI.Chat.Completions.ChatCompletionMessage.Annotation[]
    // Zhipu or Hunyuan
    webSearchInfo?: any[]
    // Web search
    webSearch?: WebSearchProviderResponse
    // MCP Tools
    mcpTools?: MCPToolResponse[]
    // Generate Image
    generateImage?: GenerateImageResponse
    // knowledge
    knowledge?: KnowledgeReference[]
  }
  // 多模型消息样式
  multiModelMessageStyle?: 'horizontal' | 'vertical' | 'fold' | 'grid'
  // fold时是否选中
  foldSelected?: boolean
}

export type Usage = OpenAI.Completions.CompletionUsage & {
  thoughts_tokens?: number
  // OpenRouter specific fields
  cost?: number
}

export type Metrics = {
  completion_tokens: number
  time_completion_millsec: number
  time_first_token_millsec?: number
  time_thinking_millsec?: number
}

export enum TopicType {
  Chat = 'chat',
  Session = 'session'
}

export type Topic = {
  id: string
  type?: TopicType
  assistantId: string
  name: string
  createdAt: string
  updatedAt: string
  messages: Message[]
  pinned?: boolean
  prompt?: string
  isNameManuallyEdited?: boolean
}

export type User = {
  id: string
  name: string
  avatar: string
  email: string
}

export const ModelTypeSchema = z.enum([
  'text',
  'vision',
  'embedding',
  'reasoning',
  'function_calling',
  'web_search',
  'rerank'
])

export type ModelType = z.infer<typeof ModelTypeSchema>

export type ModelTag = Exclude<ModelType, 'text'> | 'free'

// "image-generation" is also openai endpoint, but specifically for image generation.
export const EndPointTypeSchema = z.enum([
  'openai',
  'openai-response',
  'anthropic',
  'gemini',
  'image-generation',
  'jina-rerank'
])
export type EndpointType = z.infer<typeof EndPointTypeSchema>

export const ModelPricingSchema = z.object({
  input_per_million_tokens: z.number(),
  output_per_million_tokens: z.number(),
  currencySymbol: z.string().optional()
})

export type ModelPricing = z.infer<typeof ModelPricingSchema>

export const ModelCapabilitySchema = z.object({
  type: ModelTypeSchema,
  /**
   * 是否为用户手动选择，如果为true，则表示用户手动选择了该类型，否则表示用户手动禁止了该模型；如果为undefined，则表示使用默认值
   *
   * Is it manually selected by the user? If true, it means the user manually selected this type; otherwise, it means the user  * manually disabled the model.
   */
  isUserSelected: z.boolean().optional()
})

export type ModelCapability = z.infer<typeof ModelCapabilitySchema>

export const ModelSchema = z.object({
  id: z.string(),
  provider: z.string(),
  name: z.string(),
  group: z.string(),
  owned_by: z.string().optional(),
  description: z.string().optional(),
  capabilities: z.array(ModelCapabilitySchema).optional(),
  /**
   * @deprecated
   */
  type: z.array(ModelTypeSchema).optional(),
  pricing: ModelPricingSchema.optional(),
  endpoint_type: EndPointTypeSchema.optional(),
  supported_endpoint_types: z.array(EndPointTypeSchema).optional(),
  supported_text_delta: z.boolean().optional()
})

export type Model = z.infer<typeof ModelSchema>

export type Suggestion = {
  content: string
}

export type PaintingParams = {
  id: string
  urls: string[]
  files: FileMetadata[]
  // provider that this painting belongs to (for new-api family separation)
  providerId?: string
}

export type PaintingProvider = 'zhipu' | 'aihubmix' | 'silicon' | 'dmxapi' | 'new-api' | 'ovms' | 'cherryin' | 'ppio'

export interface Painting extends PaintingParams {
  model?: string
  prompt?: string
  negativePrompt?: string
  imageSize?: string
  numImages?: number
  seed?: string
  steps?: number
  guidanceScale?: number
  promptEnhancement?: boolean
}

export interface GeneratePainting extends PaintingParams {
  model: string
  prompt: string
  aspectRatio?: string
  numImages?: number
  styleType?: string
  seed?: string
  negativePrompt?: string
  magicPromptOption?: boolean
  renderingSpeed?: string
  quality?: string
  moderation?: string
  n?: number
  size?: string
  background?: string
  personGeneration?: GenerateImagesConfig['personGeneration']
  numberOfImages?: number
  safetyTolerance?: number
  width?: number
  height?: number
  imageSize?: string
}

export interface EditPainting extends PaintingParams {
  imageFile: string
  mask: FileMetadata
  model: string
  prompt: string
  numImages?: number
  styleType?: string
  seed?: string
  magicPromptOption?: boolean
  renderingSpeed?: string
}

export interface RemixPainting extends PaintingParams {
  imageFile: string
  model: string
  prompt: string
  aspectRatio?: string
  imageWeight: number
  numImages?: number
  styleType?: string
  seed?: string
  negativePrompt?: string
  magicPromptOption?: boolean
  renderingSpeed?: string
}

export interface ScalePainting extends PaintingParams {
  imageFile: string
  prompt: string
  resemblance?: number
  detail?: number
  numImages?: number
  seed?: string
  magicPromptOption?: boolean
  renderingSpeed?: string
}

export enum generationModeType {
  GENERATION = 'generation',
  EDIT = 'edit',
  MERGE = 'merge'
}

export interface DmxapiPainting extends PaintingParams {
  model?: string
  prompt?: string
  n?: number
  aspect_ratio?: string
  image_size?: string
  seed?: string
  style_type?: string
  autoCreate?: boolean
  generationMode?: generationModeType
  priceModel?: string
  extend_params?: Record<string, unknown>
}

export interface TokenFluxPainting extends PaintingParams {
  generationId?: string
  model?: string
  prompt?: string
  inputParams?: Record<string, any>
  status?: 'starting' | 'processing' | 'succeeded' | 'failed' | 'cancelled'
}

export interface OvmsPainting extends PaintingParams {
  model?: string
  prompt?: string
  size?: string
  num_inference_steps?: number
  rng_seed?: number
  safety_check?: boolean
  response_format?: 'url' | 'b64_json'
}

export interface PpioPainting extends PaintingParams {
  model?: string
  prompt?: string
  size?: string
  width?: number
  height?: number
  ppioSeed?: number // 使用 ppioSeed 避免与其他 Painting 类型的 seed (string) 冲突
  usePreLlm?: boolean
  addWatermark?: boolean
  taskId?: string
  ppioStatus?: 'pending' | 'processing' | 'succeeded' | 'failed'
  // Edit 模式相关
  imageFile?: string // 输入图像 URL 或 base64
  ppioMask?: string // 遮罩图像 URL 或 base64（用于擦除功能）
  resolution?: string // 高清化分辨率
  outputFormat?: string // 输出格式
}

export type PaintingAction = Partial<
  GeneratePainting &
    RemixPainting &
    EditPainting &
    ScalePainting &
    DmxapiPainting &
    TokenFluxPainting &
    OvmsPainting &
    PpioPainting
> &
  PaintingParams

export interface PaintingsState {
  // SiliconFlow
  siliconflow_paintings: Painting[]
  // DMXAPI
  dmxapi_paintings: DmxapiPainting[]
  // TokenFlux
  tokenflux_paintings: TokenFluxPainting[]
  // Zhipu
  zhipu_paintings: Painting[]
  // Aihubmix
  aihubmix_image_generate: Partial<GeneratePainting> & PaintingParams[]
  aihubmix_image_remix: Partial<RemixPainting> & PaintingParams[]
  aihubmix_image_edit: Partial<EditPainting> & PaintingParams[]
  aihubmix_image_upscale: Partial<ScalePainting> & PaintingParams[]
  // OpenAI
  openai_image_generate: Partial<GeneratePainting> & PaintingParams[]
  openai_image_edit: Partial<EditPainting> & PaintingParams[]
  // OVMS
  ovms_paintings: OvmsPainting[]
  // PPIO
  ppio_draw: PpioPainting[]
  ppio_edit: PpioPainting[]
}

export type MinAppType = {
  id: string
  name: string
  /** i18n key for translatable names */
  nameKey?: string
  /** Regions where this app is available. If includes 'Global', shown to international users. */
  supportedRegions?: MinAppRegion[]
  logo?: string
  url: string
  // FIXME: It should be `bordered`
  bodered?: boolean
  background?: string
  style?: CSSProperties
  addTime?: string
  type?: 'Custom' | 'Default' // Added the 'type' property
}

/** Region types for miniapps visibility */
export type MinAppRegion = 'CN' | 'Global'

export type MinAppRegionFilter = 'auto' | MinAppRegion

export enum ThemeMode {
  light = 'light',
  dark = 'dark',
  system = 'system'
}

/** 有限的UI语言 */
export type LanguageVarious =
  | 'zh-CN'
  | 'zh-TW'
  | 'de-DE'
  | 'el-GR'
  | 'en-US'
  | 'es-ES'
  | 'fr-FR'
  | 'ja-JP'
  | 'pt-PT'
  | 'ro-RO'
  | 'ru-RU'

export type CodeStyleVarious = 'auto' | string

export type WebDavConfig = {
  webdavHost: string
  webdavUser?: string
  webdavPass?: string
  webdavPath?: string
  fileName?: string
  skipBackupFile?: boolean
  disableStream?: boolean
}

export type AppInfo = {
  version: string
  isPackaged: boolean
  appPath: string
  configPath: string
  appDataPath: string
  resourcesPath: string
  filesPath: string
  logsPath: string
  arch: string
  isPortable: boolean
  installPath: string
}

export interface Shortcut {
  key: string
  shortcut: string[]
  editable: boolean
  enabled: boolean
  system: boolean
}

export type ProcessingStatus = 'pending' | 'processing' | 'completed' | 'failed'

export type ApiClient = {
  model: string
  provider: string
  apiKey: string
  apiVersion?: string
  baseURL: string
}

export type GenerateImageParams = {
  model: string
  prompt: string
  negativePrompt?: string
  imageSize: string
  batchSize: number
  seed?: string
  numInferenceSteps?: number
  guidanceScale?: number
  signal?: AbortSignal
  promptEnhancement?: boolean
  personGeneration?: PersonGeneration
  quality?: string
}

export const GenerateImageResponseSchema = z.object({
  type: z.enum(['url', 'base64']),
  images: z.array(z.string())
})

export type GenerateImageResponse = z.infer<typeof GenerateImageResponseSchema>

// 为了支持自定义语言，设置为string别名
/** zh-cn, en-us, etc. */
export type TranslateLanguageCode = string

// langCode应当能够唯一确认一种语言
export type TranslateLanguage = {
  value: string
  langCode: TranslateLanguageCode
  label: () => string
  emoji: string
}

export interface TranslateHistory {
  id: string
  sourceText: string
  targetText: string
  sourceLanguage: TranslateLanguageCode
  targetLanguage: TranslateLanguageCode
  createdAt: string
  /** 收藏状态 */
  star?: boolean
}

export type CustomTranslateLanguage = {
  id: string
  langCode: TranslateLanguageCode
  value: string
  emoji: string
}

export const AutoDetectionMethods = {
  franc: 'franc',
  llm: 'llm',
  auto: 'auto'
} as const

export type AutoDetectionMethod = keyof typeof AutoDetectionMethods

export const isAutoDetectionMethod = (method: string): method is AutoDetectionMethod => {
  return Object.hasOwn(AutoDetectionMethods, method)
}

export type SidebarIcon =
  | 'assistants'
  | 'store'
  | 'paintings'
  | 'translate'
  | 'minapp'
  | 'knowledge'
  | 'files'
  | 'code_tools'
  | 'notes'
  | 'openclaw'

export type ExternalToolResult = {
  mcpTools?: MCPTool[]
  toolUse?: MCPToolResponse[]
  webSearch?: WebSearchResponse
  knowledge?: KnowledgeReference[]
  memories?: MemoryItem[]
}

export const WebSearchProviderIds = {
  zhipu: 'zhipu',
  tavily: 'tavily',
  searxng: 'searxng',
  exa: 'exa',
  'exa-mcp': 'exa-mcp',
  bocha: 'bocha',
  'local-google': 'local-google',
  'local-bing': 'local-bing',
  'local-baidu': 'local-baidu'
} as const

export type WebSearchProviderId = keyof typeof WebSearchProviderIds

export const isWebSearchProviderId = (id: string): id is WebSearchProviderId => {
  return Object.hasOwn(WebSearchProviderIds, id)
}

export type WebSearchProvider = {
  id: WebSearchProviderId
  name: string
  apiKey?: string
  apiHost?: string
  engines?: string[]
  url?: string
  basicAuthUsername?: string
  basicAuthPassword?: string
  usingBrowser?: boolean
  topicId?: string
  parentSpanId?: string
  modelName?: string
}

const WebSearchProviderResultSchema = z.object({
  title: z.string(),
  content: z.string(),
  url: z.string()
})

export type WebSearchProviderResult = z.infer<typeof WebSearchProviderResultSchema>

const WebSearchProviderResponseSchema = z.object({
  query: z.string().optional(),
  results: z.array(WebSearchProviderResultSchema)
})

export type WebSearchProviderResponse = z.infer<typeof WebSearchProviderResponseSchema>

export type AISDKWebSearchResult = Omit<Extract<LanguageModelV2Source, { sourceType: 'url' }>, 'sourceType'>

export type WebSearchResults =
  | WebSearchProviderResponse
  | GroundingMetadata
  | OpenAI.Chat.Completions.ChatCompletionMessage.Annotation.URLCitation[]
  | OpenAI.Responses.ResponseOutputText.URLCitation[]
  | WebSearchResultBlock[]
  | AISDKWebSearchResult[]
  | any[]

export const WEB_SEARCH_SOURCE = {
  WEBSEARCH: 'websearch',
  OPENAI: 'openai',
  OPENAI_RESPONSE: 'openai-response',
  OPENROUTER: 'openrouter',
  ANTHROPIC: 'anthropic',
  GEMINI: 'gemini',
  PERPLEXITY: 'perplexity',
  QWEN: 'qwen',
  HUNYUAN: 'hunyuan',
  ZHIPU: 'zhipu',
  GROK: 'grok',
  AISDK: 'ai-sdk'
} as const

export const WebSearchSourceSchema = z.enum(objectValues(WEB_SEARCH_SOURCE))

export type WebSearchSource = z.infer<typeof WebSearchSourceSchema>

export const WebSearchResponseSchema = z.object({
  // It's way too complicated to define a schema for WebSearchResults,
  // so use z.custom to bypass validation
  results: z.custom<WebSearchResults>(),
  source: WebSearchSourceSchema
})

export type WebSearchResponse = z.infer<typeof WebSearchResponseSchema>

export type WebSearchPhase = 'default' | 'fetch_complete' | 'rag' | 'rag_complete' | 'rag_failed' | 'cutoff'

export type WebSearchStatus = {
  phase: WebSearchPhase
  countBefore?: number
  countAfter?: number
}

// TODO: 把 mcp 相关类型定义迁移到独立文件中
export type MCPArgType = 'string' | 'list' | 'number'
export type MCPEnvType = 'string' | 'number'
export type MCPArgParameter = { [key: string]: MCPArgType }
export type MCPEnvParameter = { [key: string]: MCPEnvType }

export interface MCPServerParameter {
  name: string
  type: MCPArgType | MCPEnvType
  description: string
}

export interface MCPServer {
  id: string // internal id
  name: string // mcp name, generally as unique key
  type?: McpServerType | 'inMemory'
  description?: string
  baseUrl?: string
  command?: string
  registryUrl?: string
  args?: string[]
  env?: Record<string, string>
  headers?: Record<string, string> // Custom headers to be sent with requests to this server
  provider?: string // Provider name for this server like ModelScope, Higress, etc.
  providerUrl?: string // URL of the MCP server in provider's website or documentation
  logoUrl?: string // URL of the MCP server's logo
  tags?: string[] // List of tags associated with this server
  longRunning?: boolean // Whether the server is long running
  timeout?: number // Timeout in seconds for requests to this server, default is 60 seconds
  dxtVersion?: string // Version of the DXT package
  dxtPath?: string // Path where the DXT package was extracted
  reference?: string // Reference link for the server, e.g., documentation or homepage
  searchKey?: string
  configSample?: MCPConfigSample
  /** List of tool names that are disabled for this server */
  disabledTools?: string[]
  /** Whether to auto-approve tools for this server */
  disabledAutoApproveTools?: string[]

  /** 用于标记内置 MCP 是否需要配置 */
  shouldConfig?: boolean
  /** 用于标记服务器是否运行中 */
  isActive: boolean
  /** 标记 MCP 安装来源，例如 builtin/manual/protocol */
  installSource?: MCPServerInstallSource
  /** 指示用户是否已信任该 MCP */
  isTrusted?: boolean
  /** 首次标记为信任的时间戳 */
  trustedAt?: number
  /** 安装时间戳 */
  installedAt?: number
}

export type BuiltinMCPServer = MCPServer & {
  type: 'inMemory'
  name: BuiltinMCPServerName
}

export const isBuiltinMCPServer = (server: MCPServer): server is BuiltinMCPServer => {
  return server.type === 'inMemory' && isBuiltinMCPServerName(server.name)
}

export const BuiltinMCPServerNames = {
  mcpAutoInstall: '@cherry/mcp-auto-install',
  memory: '@cherry/memory',
  sequentialThinking: '@cherry/sequentialthinking',
  braveSearch: '@cherry/brave-search',
  fetch: '@cherry/fetch',
  filesystem: '@cherry/filesystem',
  difyKnowledge: '@cherry/dify-knowledge',
  python: '@cherry/python',
  didiMCP: '@cherry/didi-mcp',
  browser: '@cherry/browser',
  nowledgeMem: '@cherry/nowledge-mem',
  hub: '@cherry/hub'
} as const

export type BuiltinMCPServerName = (typeof BuiltinMCPServerNames)[keyof typeof BuiltinMCPServerNames]

export const BuiltinMCPServerNamesArray = Object.values(BuiltinMCPServerNames)

export const isBuiltinMCPServerName = (name: string): name is BuiltinMCPServerName => {
  return BuiltinMCPServerNamesArray.some((n) => n === name)
}

export interface MCPPromptArguments {
  name: string
  description?: string
  required?: boolean
}

export interface MCPPrompt {
  id: string
  name: string
  description?: string
  arguments?: MCPPromptArguments[]
  serverId: string
  serverName: string
}

export interface GetMCPPromptResponse {
  description?: string
  messages: {
    role: string
    content: {
      type: 'text' | 'image' | 'audio' | 'resource'
      text?: string
      data?: string
      mimeType?: string
    }
  }[]
}

export interface MCPConfig {
  servers: MCPServer[]
  isUvInstalled: boolean
  isBunInstalled: boolean
}

const MCPToolResponseStatusSchema = z.enum(['pending', 'streaming', 'cancelled', 'invoking', 'done', 'error'])

export type MCPToolResponseStatus = z.infer<typeof MCPToolResponseStatusSchema>

const BaseToolResponseSchemaConfig = {
  /** Unique identifier */
  id: z.string(),
  tool: z.union([BaseToolSchema, MCPToolSchema]),
  arguments: z.union([
    z.record(z.string(), z.unknown()),
    z.array(z.record(z.string(), z.unknown())),
    z.string(),
    z.undefined()
  ]),
  status: MCPToolResponseStatusSchema,
  response: z.unknown().optional(),

  // Streaming arguments support
  /** Accumulated partial JSON string during streaming */
  partialArguments: z.string().optional()
} as const

const ToolUseResponseSchema = z.object({
  ...BaseToolResponseSchemaConfig,
  toolUseId: z.string()
})

export type ToolUseResponse = z.infer<typeof ToolUseResponseSchema>

const ToolCallResponseSchema = z.object({
  ...BaseToolResponseSchemaConfig,
  toolCallId: z.string().optional()
})

export type ToolCallResponse = z.infer<typeof ToolCallResponseSchema>

// export type MCPToolResponse = ToolUseResponse | ToolCallResponse
export const MCPToolResponseSchema = z.object({
  ...BaseToolResponseSchemaConfig,
  tool: MCPToolSchema,
  toolCallId: z.string().optional(),
  toolUseId: z.string().optional(),
  parentToolUseId: z.string().optional()
})

export type MCPToolResponse = z.infer<typeof MCPToolResponseSchema>

export const NormalToolResponseSchema = z.object({
  ...BaseToolResponseSchemaConfig,
  tool: BaseToolSchema,
  toolCallId: z.string(),
  parentToolUseId: z.string().optional()
})

export type NormalToolResponse = z.infer<typeof NormalToolResponseSchema>

export interface MCPToolResultContent {
  type: 'text' | 'image' | 'audio' | 'resource'
  text?: string
  data?: string
  mimeType?: string
  resource?: {
    uri?: string
    text?: string
    mimeType?: string
    blob?: string
  }
}

export interface MCPCallToolResponse {
  content: MCPToolResultContent[]
  isError?: boolean
}

export interface MCPResource {
  serverId: string
  serverName: string
  uri: string
  name: string
  description?: string
  mimeType?: string
  size?: number
  text?: string
  blob?: string
}

export interface GetResourceResponse {
  contents: MCPResource[]
}

export interface QuickPhrase {
  id: string
  title: string
  content: string
  createdAt: number
  updatedAt: number
  order?: number
}

export interface Citation {
  number: number
  url: string
  title?: string
  hostname?: string
  content?: string
  showFavicon?: boolean
  type?: string
  metadata?: Record<string, any>
}

export type MathEngine = 'KaTeX' | 'MathJax' | 'none'

export interface StoreSyncAction {
  type: string
  payload: any
  meta?: {
    fromSync?: boolean
    source?: string
  }
}

export type S3Config = {
  endpoint: string
  region: string
  bucket: string
  accessKeyId: string
  secretAccessKey: string
  root?: string
  fileName?: string
  skipBackupFile: boolean
  autoSync: boolean
  syncInterval: number
  maxBackups: number
}

export type { Message } from './newMessage'
export * from './tool'
export type { AtLeast, NotNull, NotUndefined, RequireSome } from './typeUtils'
export { objectEntries, objectEntriesStrict, objectKeys, objectValues, strip } from './typeUtils'

// Memory Service Types
// ========================================================================
export interface MemoryConfig {
  embeddingDimensions?: number
  embeddingModel?: Model
  llmModel?: Model
  // Dynamically retrieved, not persistently stored
  embeddingApiClient?: ApiClient
  customFactExtractionPrompt?: string
  customUpdateMemoryPrompt?: string
  /** Indicates whether embedding dimensions are automatically detected */
  isAutoDimensions?: boolean
}

export const MemoryItemSchema = z.object({
  id: z.string(),
  memory: z.string(),
  hash: z.string().optional(),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
  score: z.number().optional(),
  metadata: z.record(z.string(), z.unknown()).optional()
})

export type MemoryItem = z.infer<typeof MemoryItemSchema>

export interface MemorySearchResult {
  results: MemoryItem[]
  relations?: any[]
}

export interface MemoryEntity {
  userId?: string
  agentId?: string
  runId?: string
}

export interface MemorySearchFilters {
  userId?: string
  agentId?: string
  runId?: string
  [key: string]: any
}

export interface AddMemoryOptions extends MemoryEntity {
  metadata?: Record<string, any>
  filters?: MemorySearchFilters
  infer?: boolean
}

export interface MemorySearchOptions extends MemoryEntity {
  limit?: number
  filters?: MemorySearchFilters
}

export interface MemoryHistoryItem {
  id: number
  memoryId: string
  previousValue?: string
  newValue: string
  action: 'ADD' | 'UPDATE' | 'DELETE'
  createdAt: string
  updatedAt: string
  isDeleted: boolean
}

export interface MemoryListOptions extends MemoryEntity {
  limit?: number
  offset?: number
}

export interface MemoryDeleteAllOptions extends MemoryEntity {}

export type EditorView = 'preview' | 'source' | 'read' // 实时,源码,预览
// ========================================================================

export type HexColor = string

/**
 * 检查字符串是否为有效的十六进制颜色值
 * @param value 待检查的字符串
 */
export const isHexColor = (value: string): value is HexColor => {
  return /^#([0-9A-F]{3}){1,2}$/i.test(value)
}

export type FetchChatCompletionRequestOptions = {
  signal?: AbortSignal
  timeout?: number
  headers?: Record<string, string>
}

type BaseParams = {
  assistant: Assistant
  requestOptions?: FetchChatCompletionRequestOptions
  onChunkReceived: (chunk: Chunk) => void
  topicId?: string // 添加 topicId 参数
  uiMessages?: Message[]
}

type MessagesParams = BaseParams & {
  messages: StreamTextParams['messages']
  prompt?: never
}

type PromptParams = BaseParams & {
  messages?: never
  // prompt: Just use string for convinience. Native prompt type unite more types, including messages type.
  // we craete a non-intersecting prompt type to discriminate them.
  // see https://github.com/vercel/ai/issues/8363
  prompt: string
}

export type FetchChatCompletionParams = MessagesParams | PromptParams
