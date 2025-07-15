import type { WebSearchResultBlock } from '@anthropic-ai/sdk/resources'
import type { GenerateImagesConfig, GroundingMetadata, PersonGeneration } from '@google/genai'
import type OpenAI from 'openai'
import type { CSSProperties } from 'react'

export * from './file'
import type { FileMetadata } from './file'
import type { Message } from './newMessage'

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

export type ReasoningEffortOptions = 'low' | 'medium' | 'high' | 'auto'
export type EffortRatio = Record<ReasoningEffortOptions, number>

export const EFFORT_RATIO: EffortRatio = {
  low: 0.2,
  medium: 0.5,
  high: 0.8,
  auto: 2
}

export type AssistantSettings = {
  contextCount: number
  temperature: number
  topP: number
  maxTokens: number | undefined
  enableMaxTokens: boolean
  streamOutput: boolean
  defaultModel?: Model
  customParameters?: AssistantSettingCustomParameters[]
  reasoning_effort?: ReasoningEffortOptions
  qwenThinkMode?: boolean
  toolUseMode?: 'function' | 'prompt'
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
  isNotSupportArrayContent?: boolean
  isVertex?: boolean
  notes?: string
  extra_headers?: Record<string, string>
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

export type ModelType = 'text' | 'vision' | 'embedding' | 'reasoning' | 'function_calling' | 'web_search'

export type EndpointType = 'openai' | 'openai-response' | 'anthropic' | 'gemini' | 'image-generation' | 'jina-rerank'

export type ModelPricing = {
  input_per_million_tokens: number
  output_per_million_tokens: number
  currencySymbol?: string
}

export type Model = {
  id: string
  provider: string
  name: string
  group: string
  owned_by?: string
  description?: string
  type?: ModelType[]
  pricing?: ModelPricing
  endpoint_type?: EndpointType
  supported_endpoint_types?: EndpointType[]
}

export type Suggestion = {
  content: string
}

export type PaintingParams = {
  id: string
  urls: string[]
  files: FileMetadata[]
}

export type PaintingProvider = 'aihubmix' | 'silicon' | 'dmxapi' | 'new-api'

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
  paintings: Painting[]
  generate: Partial<GeneratePainting> & PaintingParams[]
  remix: Partial<RemixPainting> & PaintingParams[]
  edit: Partial<EditPainting> & PaintingParams[]
  upscale: Partial<ScalePainting> & PaintingParams[]
  DMXAPIPaintings: DmxapiPainting[]
  tokenFluxPaintings: TokenFluxPainting[]
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

export type LanguageVarious = 'zh-CN' | 'zh-TW' | 'el-GR' | 'en-US' | 'es-ES' | 'fr-FR' | 'ja-JP' | 'pt-PT' | 'ru-RU'

export type TranslateLanguageVarious = LanguageCode

export type CodeStyleVarious = 'auto' | string

export type WebDavConfig = {
  webdavHost: string
  webdavUser?: string
  webdavPass?: string
  webdavPath?: string
  fileName?: string
  skipBackupFile?: boolean
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
  preprocessOrOcrProvider?: {
    type: 'preprocess' | 'ocr'
    provider: PreprocessProvider | OcrProvider
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
  preprocessOrOcrProvider?: {
    type: 'preprocess' | 'ocr'
    provider: PreprocessProvider | OcrProvider
  }
}

export interface PreprocessProvider {
  id: string
  name: string
  apiKey?: string
  apiHost?: string
  model?: string
  options?: any
  quota?: number
}

export interface OcrProvider {
  id: string
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
}

export type GenerateImageResponse = {
  type: 'url' | 'base64'
  images: string[]
}

export type LanguageCode =
  | 'en-us'
  | 'zh-cn'
  | 'zh-tw'
  | 'ja-jp'
  | 'ko-kr'
  | 'fr-fr'
  | 'de-de'
  | 'it-it'
  | 'es-es'
  | 'pt-pt'
  | 'ru-ru'
  | 'pl-pl'
  | 'ar-ar'
  | 'tr-tr'
  | 'th-th'
  | 'vi-vn'
  | 'id-id'
  | 'ur-pk'
  | 'ms-my'

// langCode应当能够唯一确认一种语言
export type Language = {
  value: string
  langCode: LanguageCode
  label: () => string
  emoji: string
}

export interface TranslateHistory {
  id: string
  sourceText: string
  targetText: string
  sourceLanguage: LanguageCode
  targetLanguage: LanguageCode
  createdAt: string
}

export type SidebarIcon = 'assistants' | 'agents' | 'paintings' | 'translate' | 'minapp' | 'knowledge' | 'files'

export type ExternalToolResult = {
  mcpTools?: MCPTool[]
  toolUse?: MCPToolResponse[]
  webSearch?: WebSearchResponse
  knowledge?: KnowledgeReference[]
  memories?: MemoryItem[]
}

export type WebSearchProvider = {
  id: string
  name: string
  apiKey?: string
  apiHost?: string
  engines?: string[]
  url?: string
  basicAuthUsername?: string
  basicAuthPassword?: string
  usingBrowser?: boolean
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

export type MCPArgType = 'string' | 'list' | 'number'
export type MCPEnvType = 'string' | 'number'
export type MCPArgParameter = { [key: string]: MCPArgType }
export type MCPEnvParameter = { [key: string]: MCPEnvType }

export interface MCPServerParameter {
  name: string
  type: MCPArgType | MCPEnvType
  description: string
}

export interface MCPConfigSample {
  command: string
  args: string[]
  env?: Record<string, string> | undefined
}

export interface MCPServer {
  id: string
  name: string
  type?: 'stdio' | 'sse' | 'inMemory' | 'streamableHttp'
  description?: string
  baseUrl?: string
  command?: string
  registryUrl?: string
  args?: string[]
  env?: Record<string, string>
  isActive: boolean
  disabledTools?: string[] // List of tool names that are disabled for this server
  disabledAutoApproveTools?: string[] // Whether to auto-approve tools for this server
  configSample?: MCPConfigSample
  headers?: Record<string, string> // Custom headers to be sent with requests to this server
  searchKey?: string
  provider?: string // Provider name for this server like ModelScope, Higress, etc.
  providerUrl?: string // URL of the MCP server in provider's website or documentation
  logoUrl?: string // URL of the MCP server's logo
  tags?: string[] // List of tags associated with this server
  timeout?: number // Timeout in seconds for requests to this server, default is 60 seconds
  dxtVersion?: string // Version of the DXT package
  dxtPath?: string // Path where the DXT package was extracted
}

export interface MCPToolInputSchema {
  type: string
  title: string
  description?: string
  required?: string[]
  properties: Record<string, object>
}

export interface MCPTool {
  id: string
  serverId: string
  serverName: string
  name: string
  description?: string
  inputSchema: MCPToolInputSchema
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

export type OpenAISummaryText = 'auto' | 'concise' | 'detailed' | 'off'
export type OpenAIServiceTier = 'auto' | 'default' | 'flex'

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
// ========================================================================
