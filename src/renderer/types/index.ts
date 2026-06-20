/**
 * TODO [v2 refactor] 此文件存在以下架构问题，需要在 v2 重构中解决：
 *
 * 1. 文件过大 - 1100+ 行，难以维护
 * 2. 职责混乱 - 类型定义、运行时常量、工具函数混在一起，违反单一职责原则
 * 3. 工具函数不属于类型文件 - objectKeys, objectEntries, strip 等应移至 utils/
 * 4. 运行时常量不属于类型文件 - EFFORT_RATIO, WebSearchProviderIds, BuiltinMcpServerNames 等应移至 constants/
 * 5. 类型守卫应分离 - isThinkModelType, isWebSearchProviderId 等函数应独立到 typeGuards 文件
 * 6. 部分类型应迁移到 src/shared/data/types/ 以便 main/renderer 进程共享
 */
import type { LanguageModelV3Source } from '@ai-sdk/provider'
import type { WebSearchResultBlock } from '@anthropic-ai/sdk/resources'
import type OpenAI from '@cherrystudio/openai'
import type { GenerateImagesConfig, GroundingMetadata, PersonGeneration } from '@google/genai'
export * from './file'
export * from './note'
export type { LanguageVarious, TranslateLangCode } from '@shared/data/preference/preferenceTypes'

import type {
  Assistant as DataApiAssistant,
  AssistantSettings as DataApiAssistantSettings,
  McpMode as DataApiMcpMode
} from '@shared/data/types/assistant'
import type { McpServer } from '@shared/data/types/mcpServer'
import type { TranslateLanguage } from '@shared/data/types/translate'

export type { TranslateLanguage }
import * as z from 'zod'

import type { FileMetadata } from './file'
import type { KnowledgeBase, KnowledgeReference } from './knowledge'
import type { Message } from './newMessage'
import type { BaseTool, McpTool } from './tool'

export * from './agent'
export * from './apiGateway'
export * from './knowledge'
export * from './mcp'
export * from './notification'
export * from './ocr'
export * from './plugin'
export * from './provider'
export * from './skill'
export * from './websearch'

export type Assistant = DataApiAssistant
export type AssistantSettings = DataApiAssistantSettings
export type McpMode = DataApiMcpMode

/**
 * @deprecated removed in v2
 */
export type LegacyAssistantSettings = AssistantSettings & {
  contextCount?: number
  /** v1-only: tool-call mode (`function` | `prompt`). Removed from v2 AssistantSettings;
   *  retained here solely so the deprecated store migrations in `store/migrate.ts` compile. */
  toolUseMode?: 'function' | 'prompt'
}

/**
 * @deprecated removed in v2
 */
export type LegacyAssistant = {
  id: string
  name: string
  prompt: string
  knowledge_bases?: KnowledgeBase[]
  topics: Topic[]
  type: string
  group?: string[]
  emoji?: string
  description?: string
  model?: Model
  defaultModel?: Model
  settings?: Partial<LegacyAssistantSettings> & {
    /** legacy: only present in v1 settings */
    defaultModel?: Model
  }
  messages?: AssistantMessage[]
  enableWebSearch?: boolean
  // enableUrlContext 是 Gemini/Anthropic 的特有功能
  enableUrlContext?: boolean
  enableGenerateImage?: boolean
  /** MCP mode: 'disabled' (no MCP), 'auto' (hub server only), 'manual' (user selects servers) */
  mcpMode?: McpMode
  mcpServers?: McpServer[]
  knowledgeRecognition?: 'off' | 'on'
  regularPhrases?: QuickPhrase[] // Added for regular phrase
  tags?: string[] // 助手标签
  // for translate. 更好的做法是定义base assistant，把 Assistant 作为多种不同定义 assistant 的联合类型，但重构代价太大
  content?: string
  targetLanguage?: TranslateLanguage
}

export type TranslateAssistant = Assistant & {
  model: Model
  content: string
  targetLanguage: TranslateLanguage
}

export type AssistantMessage = {
  role: 'user' | 'assistant'
  content: string
}

/**
 * Get the effective MCP mode for an assistant with backward compatibility.
 * v2 keeps `mcpMode` inside `settings` and supplies a default — this helper
 * stays as a thin facade so existing callers don't have to change.
 */
export function getEffectiveMcpMode(assistant: Assistant): McpMode {
  return assistant.settings?.mcpMode ?? 'disabled'
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
  'gpt5_2_codex',
  'gpt5_2',
  'gpt5pro',
  'gpt52pro',
  'gpt_oss',
  'grok',
  'grok4_fast',
  'grok_4_3',
  'gemini2_flash',
  'gemini2_pro',
  'gemini3_flash',
  'gemini3_pro',
  'gemini3_1_pro',
  'gemma4_hosted',
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
  'deepseek_v4',
  'kimi_k2_5',
  'claude',
  'claude46',
  'mistral'
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
  enabledMCPs?: McpServer[]
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
    mcpTools?: McpToolResponse[]
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
  /**
   * Last-used assistant id. `undefined` means the topic has no associated
   * assistant (e.g. a first-launch temp topic, or a topic created before any
   * assistant was selected). Renderer code must NOT substitute a sentinel —
   * callers should branch on `undefined` and fall back to UI defaults.
   */
  assistantId: string | undefined
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

export type ModelType = 'text' | 'vision' | 'embedding' | 'reasoning' | 'function_calling' | 'web_search' | 'rerank'

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
  // provider that this painting belongs to (for new-api family separation)
  providerId?: string
}

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

export enum ThemeMode {
  light = 'light',
  dark = 'dark',
  system = 'system'
}

/** 有限的UI语言 */
// export type LanguageVarious =
//   | 'zh-CN'
//   | 'zh-TW'
//   | 'de-DE'
//   | 'el-GR'
//   | 'en-US'
//   | 'es-ES'
//   | 'fr-FR'
//   | 'ja-JP'
//   | 'pt-PT'
//   | 'ro-RO'
//   | 'ru-RU'
//   | 'vi-VN'

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
  /**
   * Input images for image-to-image / edit / remix / upscale flows. When
   * non-empty, painting callers ({@link AiProvider.generatePaintingImage})
   * forward these to AI SDK as `prompt: { text, images }` so the vendor
   * image-model picks the right edit endpoint.
   */
  inputImages?: (Buffer | Uint8Array | string)[]
  negativePrompt?: string
  imageSize?: string
  aspectRatio?: string
  /** Optional: painting callers may omit it; `AiProvider` falls back to `n: 1`. */
  batchSize?: number
  /**
   * Painting-only opt-in: when true and `imageSize` is undefined, `AiProvider`
   * skips the `'1024x1024'` default so `size` is omitted from the request body
   * entirely (matches the bespoke `painting.size === 'auto' → undefined`
   * handling for models whose server-side default differs from 1024×1024).
   * Chat callers must leave this unset to keep the legacy default.
   */
  allowAutoSize?: boolean
  seed?: string
  numInferenceSteps?: number
  guidanceScale?: number
  signal?: AbortSignal
  promptEnhancement?: boolean
  personGeneration?: PersonGeneration
  quality?: string
  /** OpenAI image-body field (e.g. 'transparent'/'opaque'/'auto') */
  background?: string
  /** OpenAI image-body field (e.g. 'low'/'auto') */
  moderation?: string
  /** OpenAI image-body field — DALL-E 3 only ('vivid' / 'natural') */
  style?: string
  /**
   * Extra AI SDK `providerOptions` merged into the built map, keyed by the
   * resolved provider id. Carries provider-specific params (and non-JSON
   * callbacks like the polling `onProgress`) that the structured params can't
   * express. Passed by reference through the plugin chain.
   */
  providerOptions?: Record<string, Record<string, unknown>>
}

/**
 * 图像编辑参数
 * 用于基于输入图像和文本提示生成编辑后的图像
 */
export type EditImageParams = {
  /** 模型 ID */
  model: string
  /** 编辑提示词 */
  prompt: string
  /** 需要编辑的输入图像（可以是 Buffer、Uint8Array 或 base64/URL 字符串） */
  inputImages: (Buffer | Uint8Array | string)[]
  /** 可选的 mask 图像用于 inpainting（指定需要编辑的区域） */
  mask?: Buffer | Uint8Array | string
  /** 输出图像尺寸 */
  imageSize?: string
  /** See {@link GenerateImageParams.allowAutoSize}. */
  allowAutoSize?: boolean
  /** OpenAI image-body quality (e.g. 'high'/'auto'); forwarded via providerOptions */
  quality?: string
  /** OpenAI image-body field (e.g. 'transparent'/'opaque'/'auto') */
  background?: string
  /** OpenAI image-body field (e.g. 'low'/'auto') */
  moderation?: string
  /**
   * Extra AI SDK `providerOptions` merged into the built map, keyed by the
   * resolved provider id. See {@link GenerateImageParams.providerOptions}.
   */
  providerOptions?: Record<string, Record<string, unknown>>
  /** 中止信号 */
  signal?: AbortSignal
}

export type GenerateImageResponse = {
  type: 'url' | 'base64'
  images: string[]
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

export type ExternalToolResult = {
  mcpTools?: McpTool[]
  toolUse?: McpToolResponse[]
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
  querit: 'querit',
  fetch: 'fetch',
  jina: 'jina'
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
  allowedTools?: string[]
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

export type AISDKWebSearchResult = Omit<Extract<LanguageModelV3Source, { sourceType: 'url' }>, 'sourceType'>

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

export type WebSearchResponse = {
  results?: WebSearchResults
  source: WebSearchSource
}

export type { WebSearchPhase, WebSearchStatus } from '@shared/data/types/webSearch'

// TODO: 把 mcp 相关类型定义迁移到独立文件中
export type McpArgType = 'string' | 'list' | 'number'
export type McpEnvType = 'string' | 'number'
export type McpArgParameter = { [key: string]: McpArgType }
export type McpEnvParameter = { [key: string]: McpEnvType }

export interface McpServerParameter {
  name: string
  type: McpArgType | McpEnvType
  description: string
}

export type { McpServer } from '@shared/data/types/mcpServer'

export type BuiltinMcpServer = McpServer & {
  type: 'inMemory'
  name: BuiltinMcpServerName
}

export const isBuiltinMcpServer = (server: McpServer): server is BuiltinMcpServer => {
  return server.type === 'inMemory' && isBuiltinMcpServerName(server.name)
}

export const BuiltinMcpServerNames = {
  flomo: '@cherry/flomo',
  mcpAutoInstall: '@cherry/mcp-auto-install',
  memory: '@cherry/memory',
  sequentialThinking: '@cherry/sequentialthinking',
  braveSearch: '@cherry/brave-search',
  fetch: '@cherry/fetch',
  filesystem: '@cherry/filesystem',
  difyKnowledge: '@cherry/dify-knowledge',
  python: '@cherry/python',
  didiMcp: '@cherry/didi-mcp',
  browser: '@cherry/browser',
  nowledgeMem: '@cherry/nowledge-mem',
  hub: '@cherry/hub'
} as const

export type BuiltinMcpServerName = (typeof BuiltinMcpServerNames)[keyof typeof BuiltinMcpServerNames]

export const BuiltinMcpServerNamesArray = Object.values(BuiltinMcpServerNames)

export const isBuiltinMcpServerName = (name: string): name is BuiltinMcpServerName => {
  return BuiltinMcpServerNamesArray.some((n) => n === name)
}

export interface McpPromptArguments {
  name: string
  description?: string
  required?: boolean
}

export interface McpPrompt {
  id: string
  name: string
  description?: string
  arguments?: McpPromptArguments[]
  serverId: string
  serverName: string
}

export interface GetMcpPromptResponse {
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

export interface McpConfig {
  servers: McpServer[]
  isUvInstalled: boolean
  isBunInstalled: boolean
}

export type McpToolResponseStatus = 'pending' | 'streaming' | 'cancelled' | 'invoking' | 'done' | 'error'

interface BaseToolResponse {
  id: string // unique id
  tool: BaseTool | McpTool
  arguments: Record<string, unknown> | Record<string, unknown>[] | string | undefined
  status: McpToolResponseStatus
  response?: any
  // Streaming arguments support
  partialArguments?: string // Accumulated partial JSON string during streaming
}

export interface ToolUseResponse extends BaseToolResponse {
  toolUseId: string
}

export interface ToolCallResponse extends BaseToolResponse {
  // gemini tool call id might be undefined
  toolCallId?: string
}

// export type McpToolResponse = ToolUseResponse | ToolCallResponse
export interface McpToolResponse extends Omit<ToolUseResponse | ToolCallResponse, 'tool'> {
  tool: McpTool
  toolCallId?: string
  toolUseId?: string
  parentToolUseId?: string
}

export interface NormalToolResponse extends Omit<ToolCallResponse, 'tool'> {
  tool: BaseTool
  toolCallId: string
  parentToolUseId?: string
}

export interface McpToolResultContent {
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

export interface McpCallToolResponse {
  content: McpToolResultContent[]
  structuredContent?: unknown
  isError?: boolean
}

export interface McpResource {
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
  contents: McpResource[]
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
 * 获取对象所有值的类型安全版本
 * @template T - 对象类型
 * @param obj - 要获取值的对象
 * @returns 对象值组成的数组
 * @example
 * const obj = { a: 1, b: 2 } as const;
 * const values = objectValues(obj); // (1 | 2)[]
 */
export function objectValues<T extends Record<string, unknown>>(obj: T): T[keyof T][] {
  return Object.values(obj) as T[keyof T][]
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

/**
 * Makes specified properties required while keeping others as is
 * @template T - The object type to modify
 * @template K - Keys of T that should be required
 * @example
 * type User = {
 *   name?: string;
 *   age?: number;
 * }
 *
 * type UserWithName = RequireSome<User, 'name'>
 * // Result: { name: string; age?: number; }
 */
export type RequireSome<T, K extends keyof T> = Omit<T, K> & Required<Pick<T, K>>

export type HexColor = string

/**
 * 检查字符串是否为有效的十六进制颜色值
 * @param value 待检查的字符串
 */
export const isHexColor = (value: string): value is HexColor => {
  return /^#([0-9A-F]{3}){1,2}$/i.test(value)
}

// More specific than NonNullable
export type NotUndefined<T> = Exclude<T, undefined>
export type NotNull<T> = Exclude<T, null>
