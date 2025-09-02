import type { WebSearchResultBlock } from '@anthropic-ai/sdk/resources'
import type { GenerateImagesConfig, GroundingMetadata, PersonGeneration } from '@google/genai'
import type OpenAI from 'openai'
import type { CSSProperties } from 'react'
import * as z from 'zod/v4'

export * from './file'
export * from './note'

import type { FileMetadata } from './file'
import { MCPConfigSample, McpServerType } from './mcp'
import type { Message } from './newMessage'

export * from './mcp'
export * from './ocr'

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
  settings?: Partial<AssistantSettings>
  messages?: AssistantMessage[]
  /** enableWebSearch 代表使用模型内置网络搜索功能 */
  enableWebSearch?: boolean
  webSearchProviderId?: WebSearchProvider['id']
  // enableUrlContext 是 Gemini 的特有功能
  enableUrlContext?: boolean
  enableGenerateImage?: boolean
  mcpServers?: MCPServer[]
  knowledgeRecognition?: 'off' | 'on'
  regularPhrases?: QuickPhrase[] // Added for regular phrase
  tags?: string[] // 助手标签
  enableMemory?: boolean
  // for translate. 更好的做法是定义base assistant，把 Assistant 作为多种不同定义 assistant 的联合类型，但重构代价太大
  content?: string
  targetLanguage?: TranslateLanguage
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
  'gpt5',
  'grok',
  'gemini',
  'gemini_pro',
  'qwen',
  'qwen_thinking',
  'doubao',
  'doubao_no_auto',
  'hunyuan',
  'zhipu',
  'perplexity',
  'deepseek_hybrid'
] as const

export type ReasoningEffortOption = NonNullable<OpenAI.ReasoningEffort> | 'auto'
export type ThinkingOption = ReasoningEffortOption | 'off'
export type ThinkingModelType = (typeof ThinkModelTypes)[number]
export type ThinkingOptionConfig = Record<ThinkingModelType, ThinkingOption[]>
export type ReasoningEffortConfig = Record<ThinkingModelType, ReasoningEffortOption[]>
export type EffortRatio = Record<ReasoningEffortOption, number>

export function isThinkModelType(type: string): type is ThinkingModelType {
  return ThinkModelTypes.some((t) => t === type)
}

export const EFFORT_RATIO: EffortRatio = {
  minimal: 0.05,
  low: 0.05,
  medium: 0.5,
  high: 0.8,
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
  reasoning_effort?: ReasoningEffortOption
  /** 保留上一次使用思考模型时的 reasoning effort, 在从非思考模型切换到思考模型时恢复.
   *
   * TODO: 目前 reasoning_effort === undefined 有两个语义，有的场景是显式关闭思考，有的场景是不传参。
   * 未来应该重构思考控制，将启用/关闭思考和思考选项分离，这样就不用依赖 cache 了。
   *
   */
  reasoning_effort_cache?: ReasoningEffortOption
  qwenThinkMode?: boolean
  toolUseMode: 'function' | 'prompt'
}

export type Agent = Omit<Assistant, 'model'> & {
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

export type Topic = {
  id: string
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

// undefined 视为支持，默认支持
export type ProviderApiOptions = {
  /** 是否不支持 message 的 content 为数组类型 */
  isNotSupportArrayContent?: boolean
  /** 是否不支持 stream_options 参数 */
  isNotSupportStreamOptions?: boolean
  /**
   * @deprecated
   * 是否不支持 message 的 role 为 developer */
  isNotSupportDeveloperRole?: boolean
  /* 是否支持 message 的 role 为 developer */
  isSupportDeveloperRole?: boolean
  /**
   * @deprecated
   * 是否不支持 service_tier 参数. Only for OpenAI Models. */
  isNotSupportServiceTier?: boolean
  /* 是否支持 service_tier 参数. Only for OpenAI Models. */
  isSupportServiceTier?: boolean
  /** 是否不支持 enable_thinking 参数 */
  isNotSupportEnableThinking?: boolean
}

export type Provider = {
  id: string
  type: ProviderType
  name: string
  apiKey: string
  apiHost: string
  apiVersion?: string
  models: Model[]
  enabled?: boolean
  isSystem?: boolean
  isAuthed?: boolean
  rateLimit?: number

  // API options
  apiOptions?: ProviderApiOptions
  serviceTier?: ServiceTier

  /** @deprecated */
  isNotSupportArrayContent?: boolean
  /** @deprecated */
  isNotSupportStreamOptions?: boolean
  /** @deprecated */
  isNotSupportDeveloperRole?: boolean
  /** @deprecated */
  isNotSupportServiceTier?: boolean

  isVertex?: boolean
  notes?: string
  extra_headers?: Record<string, string>
}

export const SystemProviderIds = {
  cherryin: 'cherryin',
  silicon: 'silicon',
  aihubmix: 'aihubmix',
  ocoolai: 'ocoolai',
  deepseek: 'deepseek',
  ppio: 'ppio',
  alayanew: 'alayanew',
  qiniu: 'qiniu',
  dmxapi: 'dmxapi',
  burncloud: 'burncloud',
  tokenflux: 'tokenflux',
  '302ai': '302ai',
  cephalon: 'cephalon',
  lanyun: 'lanyun',
  ph8: 'ph8',
  openrouter: 'openrouter',
  ollama: 'ollama',
  'new-api': 'new-api',
  lmstudio: 'lmstudio',
  anthropic: 'anthropic',
  openai: 'openai',
  'azure-openai': 'azure-openai',
  gemini: 'gemini',
  vertexai: 'vertexai',
  github: 'github',
  copilot: 'copilot',
  zhipu: 'zhipu',
  yi: 'yi',
  moonshot: 'moonshot',
  baichuan: 'baichuan',
  dashscope: 'dashscope',
  stepfun: 'stepfun',
  doubao: 'doubao',
  infini: 'infini',
  minimax: 'minimax',
  groq: 'groq',
  together: 'together',
  fireworks: 'fireworks',
  nvidia: 'nvidia',
  grok: 'grok',
  hyperbolic: 'hyperbolic',
  mistral: 'mistral',
  jina: 'jina',
  perplexity: 'perplexity',
  modelscope: 'modelscope',
  xirang: 'xirang',
  hunyuan: 'hunyuan',
  'tencent-cloud-ti': 'tencent-cloud-ti',
  'baidu-cloud': 'baidu-cloud',
  gpustack: 'gpustack',
  voyageai: 'voyageai',
  'aws-bedrock': 'aws-bedrock',
  poe: 'poe',
  aionly: 'aionly'
} as const

export type SystemProviderId = keyof typeof SystemProviderIds

export const isSystemProviderId = (id: string): id is SystemProviderId => {
  return Object.hasOwn(SystemProviderIds, id)
}

export type SystemProvider = Provider & {
  id: SystemProviderId
  isSystem: true
  apiOptions?: never
}

/**
 * 判断是否为系统内置的提供商。比直接使用`provider.isSystem`更好，因为该数据字段不会随着版本更新而变化。
 * @param provider - Provider对象，包含提供商的信息
 * @returns 是否为系统内置提供商
 */
export const isSystemProvider = (provider: Provider): provider is SystemProvider => {
  return isSystemProviderId(provider.id) && !!provider.isSystem
}

export type ProviderType =
  | 'openai'
  | 'openai-response'
  | 'anthropic'
  | 'gemini'
  | 'qwenlm'
  | 'azure-openai'
  | 'vertexai'
  | 'mistral'
  | 'aws-bedrock'

export type ModelType = 'text' | 'vision' | 'embedding' | 'reasoning' | 'function_calling' | 'web_search' | 'rerank'

export type ModelTag = Exclude<ModelType, 'text'> | 'free'

export type EndpointType = 'openai' | 'openai-response' | 'anthropic' | 'gemini' | 'image-generation' | 'jina-rerank'

export type ModelPricing = {
  input_per_million_tokens: number
  output_per_million_tokens: number
  currencySymbol?: string
}

export type ModelCapability = {
  type: ModelType
  /**
   * 是否为用户手动选择，如果为true，则表示用户手动选择了该类型，否则表示用户手动禁止了该模型；如果为undefined，则表示使用默认值
   * Is it manually selected by the user? If true, it means the user manually selected this type; otherwise, it means the user  * manually disabled the model.
   */
  isUserSelected?: boolean
}

export type Model = {
  id: string
  provider: string
  name: string
  group: string
  owned_by?: string
  description?: string
  capabilities?: ModelCapability[]
  /**
   * @deprecated
   */
  type?: ModelType[]
  pricing?: ModelPricing
  endpoint_type?: EndpointType
  supported_endpoint_types?: EndpointType[]
  supported_text_delta?: boolean
}

export type Suggestion = {
  content: string
}

export type PaintingParams = {
  id: string
  urls: string[]
  files: FileMetadata[]
}

export type PaintingProvider = 'zhipu' | 'aihubmix' | 'silicon' | 'dmxapi' | 'new-api'

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
}

export interface TokenFluxPainting extends PaintingParams {
  generationId?: string
  model?: string
  prompt?: string
  inputParams?: Record<string, any>
  status?: 'starting' | 'processing' | 'succeeded' | 'failed' | 'cancelled'
}

export type PaintingAction = Partial<
  GeneratePainting & RemixPainting & EditPainting & ScalePainting & DmxapiPainting & TokenFluxPainting
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
}

export type MinAppType = {
  id: string
  name: string
  logo?: string
  url: string
  bodered?: boolean
  background?: string
  style?: CSSProperties
  addTime?: string
  type?: 'Custom' | 'Default' // Added the 'type' property
}

export enum ThemeMode {
  light = 'light',
  dark = 'dark',
  system = 'system'
}

/** 有限的UI语言 */
export type LanguageVarious = 'zh-CN' | 'zh-TW' | 'el-GR' | 'en-US' | 'es-ES' | 'fr-FR' | 'ja-JP' | 'pt-PT' | 'ru-RU'

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

export type KnowledgeItemType = 'file' | 'url' | 'note' | 'sitemap' | 'directory' | 'memory'

export type KnowledgeItem = {
  id: string
  baseId?: string
  uniqueId?: string
  uniqueIds?: string[]
  type: KnowledgeItemType
  content: string | FileMetadata
  remark?: string
  created_at: number
  updated_at: number
  processingStatus?: ProcessingStatus
  processingProgress?: number
  processingError?: string
  retryCount?: number
  isPreprocessed?: boolean
}

export interface KnowledgeBase {
  id: string
  name: string
  model: Model
  dimensions?: number
  description?: string
  items: KnowledgeItem[]
  created_at: number
  updated_at: number
  version: number
  documentCount?: number
  chunkSize?: number
  chunkOverlap?: number
  threshold?: number
  rerankModel?: Model
  // topN?: number
  // preprocessing?: boolean
  preprocessProvider?: {
    type: 'preprocess'
    provider: PreprocessProvider
  }
}

export type ApiClient = {
  model: string
  provider: string
  apiKey: string
  apiVersion?: string
  baseURL: string
}

export type KnowledgeBaseParams = {
  id: string
  dimensions?: number
  chunkSize?: number
  chunkOverlap?: number
  embedApiClient: ApiClient
  rerankApiClient?: ApiClient
  documentCount?: number
  // preprocessing?: boolean
  preprocessProvider?: {
    type: 'preprocess'
    provider: PreprocessProvider
  }
}

export const PreprocessProviderIds = {
  doc2x: 'doc2x',
  mistral: 'mistral',
  mineru: 'mineru'
} as const

export type PreprocessProviderId = keyof typeof PreprocessProviderIds

export const isPreprocessProviderId = (id: string): id is PreprocessProviderId => {
  return Object.hasOwn(PreprocessProviderIds, id)
}

export interface PreprocessProvider {
  id: PreprocessProviderId
  name: string
  apiKey?: string
  apiHost?: string
  model?: string
  options?: any
  quota?: number
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

export type GenerateImageResponse = {
  type: 'url' | 'base64'
  images: string[]
}

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
  | 'agents'
  | 'paintings'
  | 'translate'
  | 'minapp'
  | 'knowledge'
  | 'files'
  | 'code_tools'
  | 'notes'

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

export type WebSearchProviderResult = {
  title: string
  content: string
  url: string
}

export type WebSearchProviderResponse = {
  query?: string
  results: WebSearchProviderResult[]
}

export type WebSearchResults =
  | WebSearchProviderResponse
  | GroundingMetadata
  | OpenAI.Chat.Completions.ChatCompletionMessage.Annotation.URLCitation[]
  | OpenAI.Responses.ResponseOutputText.URLCitation[]
  | WebSearchResultBlock[]
  | any[]

export enum WebSearchSource {
  WEBSEARCH = 'websearch',
  OPENAI = 'openai',
  OPENAI_RESPONSE = 'openai-response',
  OPENROUTER = 'openrouter',
  ANTHROPIC = 'anthropic',
  GEMINI = 'gemini',
  PERPLEXITY = 'perplexity',
  QWEN = 'qwen',
  HUNYUAN = 'hunyuan',
  ZHIPU = 'zhipu',
  GROK = 'grok'
}

export type WebSearchResponse = {
  results?: WebSearchResults
  source: WebSearchSource
}

export type WebSearchPhase = 'default' | 'fetch_complete' | 'rag' | 'rag_complete' | 'rag_failed' | 'cutoff'

export type WebSearchStatus = {
  phase: WebSearchPhase
  countBefore?: number
  countAfter?: number
}

export type KnowledgeReference = {
  id: number
  content: string
  sourceUrl: string
  type: KnowledgeItemType
  file?: FileMetadata
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
  python: '@cherry/python'
} as const

export type BuiltinMCPServerName = (typeof BuiltinMCPServerNames)[keyof typeof BuiltinMCPServerNames]

export const BuiltinMCPServerNamesArray = Object.values(BuiltinMCPServerNames)

export const isBuiltinMCPServerName = (name: string): name is BuiltinMCPServerName => {
  return BuiltinMCPServerNamesArray.some((n) => n === name)
}

export interface MCPToolInputSchema {
  type: string
  title: string
  description?: string
  required?: string[]
  properties: Record<string, object>
}

export const MCPToolOutputSchema = z.object({
  type: z.literal('object'),
  properties: z.record(z.string(), z.unknown()),
  required: z.array(z.string())
})

export interface MCPTool {
  id: string
  serverId: string
  serverName: string
  name: string
  description?: string
  inputSchema: MCPToolInputSchema
  outputSchema?: z.infer<typeof MCPToolOutputSchema>
  isBuiltIn?: boolean // 标识是否为内置工具，内置工具不需要通过MCP协议调用
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

export type MCPToolResponseStatus = 'pending' | 'cancelled' | 'invoking' | 'done' | 'error'

interface BaseToolResponse {
  id: string // unique id
  tool: MCPTool
  arguments: Record<string, unknown> | undefined
  status: MCPToolResponseStatus
  response?: any
}

export interface ToolUseResponse extends BaseToolResponse {
  toolUseId: string
}

export interface ToolCallResponse extends BaseToolResponse {
  // gemini tool call id might be undefined
  toolCallId?: string
}

export type MCPToolResponse = ToolUseResponse | ToolCallResponse

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

export type OpenAIVerbosity = 'high' | 'medium' | 'low'

export type OpenAISummaryText = 'auto' | 'concise' | 'detailed' | 'off'

export const OpenAIServiceTiers = {
  auto: 'auto',
  default: 'default',
  flex: 'flex',
  priority: 'priority'
} as const

export type OpenAIServiceTier = keyof typeof OpenAIServiceTiers

export function isOpenAIServiceTier(tier: string): tier is OpenAIServiceTier {
  return Object.hasOwn(OpenAIServiceTiers, tier)
}

export const GroqServiceTiers = {
  auto: 'auto',
  on_demand: 'on_demand',
  flex: 'flex',
  performance: 'performance'
} as const

// 从 GroqServiceTiers 对象中提取类型
export type GroqServiceTier = keyof typeof GroqServiceTiers

export function isGroqServiceTier(tier: string): tier is GroqServiceTier {
  return Object.hasOwn(GroqServiceTiers, tier)
}

export type ServiceTier = OpenAIServiceTier | GroqServiceTier

export function isServiceTier(tier: string): tier is ServiceTier {
  return isGroqServiceTier(tier) || isOpenAIServiceTier(tier)
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

export interface ApiServerConfig {
  enabled: boolean
  host: string
  port: number
  apiKey: string
}

// Memory Service Types
// ========================================================================
export interface MemoryConfig {
  /**
   * @deprecated use embedderApiClient instead
   */
  embedderModel?: Model
  embedderDimensions?: number
  /**
   * @deprecated use llmApiClient instead
   */
  llmModel?: Model
  embedderApiClient?: ApiClient
  llmApiClient?: ApiClient
  customFactExtractionPrompt?: string
  customUpdateMemoryPrompt?: string
  /** Indicates whether embedding dimensions are automatically detected */
  isAutoDimensions?: boolean
}

export interface MemoryItem {
  id: string
  memory: string
  hash?: string
  createdAt?: string
  updatedAt?: string
  score?: number
  metadata?: Record<string, any>
}

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

/**
 * 获取对象的所有键名，并保持类型安全
 * @param obj - 要获取键名的对象
 * @returns 对象的所有键名数组，类型为对象键名的联合类型
 * @example
 * ```ts
 * const obj = { foo: 1, bar: 'hello' };
 * const keys = objectKeys(obj); // ['foo', 'bar']
 * ```
 */
export function objectKeys<T extends object>(obj: T): (keyof T)[] {
  return Object.keys(obj) as (keyof T)[]
}

/**
 * 将对象转换为键值对数组，保持类型安全
 * @template T - 对象类型
 * @param obj - 要转换的对象
 * @returns 键值对数组，每个元素是一个包含键和值的元组
 * @example
 * const obj = { name: 'John', age: 30 };
 * const entries = objectEntries(obj); // [['name', 'John'], ['age', 30]]
 */
export function objectEntries<T extends object>(obj: T): [keyof T, T[keyof T]][] {
  return Object.entries(obj) as [keyof T, T[keyof T]][]
}

/**
 * 将对象转换为键值对数组，提供更严格的类型检查
 * @template T - 对象类型，键必须是string、number或symbol，值可以是任意类型
 * @param obj - 要转换的对象
 * @returns 键值对数组，每个元素是一个包含键和值的元组，类型完全对应原对象的键值类型
 * @example
 * const obj = { name: 'John', age: 30 };
 * const entries = objectEntriesStrict(obj); // [['name', string], ['age', number]]
 */
export function objectEntriesStrict<T extends Record<string | number | symbol, unknown>>(
  obj: T
): { [K in keyof T]: [K, T[K]] }[keyof T][] {
  return Object.entries(obj) as { [K in keyof T]: [K, T[K]] }[keyof T][]
}

/**
 * 表示一个对象类型，该对象至少包含类型T中指定的所有键，这些键的值类型为U
 * 同时也允许包含其他任意string类型的键，这些键的值类型也必须是U
 * @template T - 必需包含的键的字面量字符串联合类型
 * @template U - 所有键对应值的类型
 * @example
 * type Example = AtLeast<'a' | 'b', number>;
 * // 结果类型允许:
 * const obj1: Example = { a: 1, b: 2 };           // 只包含必需的键
 * const obj2: Example = { a: 1, b: 2, c: 3 };     // 包含额外的键
 */
export type AtLeast<T extends string, U> = {
  [K in T]: U
} & {
  [key: string]: U
}

/**
 * 从对象中移除指定的属性键，返回新对象
 * @template T - 源对象类型
 * @template K - 要移除的属性键类型，必须是T的键
 * @param obj - 源对象
 * @param keys - 要移除的属性键列表
 * @returns 移除指定属性后的新对象
 * @example
 * ```ts
 * const obj = { a: 1, b: 2, c: 3 };
 * const result = strip(obj, ['a', 'b']);
 * // result = { c: 3 }
 * ```
 */
export function strip<T, K extends keyof T>(obj: T, keys: K[]): Omit<T, K> {
  const result = { ...obj }
  for (const key of keys) {
    delete (result as any)[key] // 类型上 Omit 已保证安全
  }
  return result
}

export type HexColor = string

/**
 * 检查字符串是否为有效的十六进制颜色值
 * @param value 待检查的字符串
 */
export const isHexColor = (value: string): value is HexColor => {
  return /^#([0-9A-F]{3}){1,2}$/i.test(value)
}
