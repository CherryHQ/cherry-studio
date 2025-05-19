import type { WebSearchResultBlock } from '@anthropic-ai/sdk/resources'
import type { GroundingMetadata } from '@google/genai'
import type OpenAI from 'openai'
import React from 'react'

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
  enableGenerateImage?: boolean
  mcpServers?: MCPServer[]
  knowledgeRecognition?: 'off' | 'on'
  regularPhrases?: QuickPhrase[] // Added for regular phrase
}

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
  hideMessages: boolean
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
  files?: FileType[]
  images?: string[]
  usage?: Usage
  metrics?: Metrics
  knowledgeBaseIds?: string[]
  type: 'text' | '@' | 'clear'
  isPreset?: boolean
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
  notes?: string
}

export type ProviderType = 'openai' | 'openai-response' | 'anthropic' | 'gemini' | 'qwenlm' | 'azure-openai'

export type ModelType = 'text' | 'vision' | 'embedding' | 'reasoning' | 'function_calling' | 'web_search'

export type Model = {
  id: string
  provider: string
  name: string
  group: string
  owned_by?: string
  description?: string
  type?: ModelType[]
}

export type Suggestion = {
  content: string
}

export type PaintingParams = {
  id: string
  urls: string[]
  files: FileType[]
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
}

export interface EditPainting extends PaintingParams {
  imageFile: string
  mask: FileType
  model: string
  prompt: string
  numImages?: number
  styleType?: string
  seed?: string
  magicPromptOption?: boolean
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
}

export interface ScalePainting extends PaintingParams {
  imageFile: string
  prompt: string
  resemblance?: number
  detail?: number
  numImages?: number
  seed?: string
  magicPromptOption?: boolean
}

export type PaintingAction = Partial<GeneratePainting & RemixPainting & EditPainting & ScalePainting> & PaintingParams

export interface PaintingsState {
  paintings: Painting[]
  generate: Partial<GeneratePainting> & PaintingParams[]
  remix: Partial<RemixPainting> & PaintingParams[]
  edit: Partial<EditPainting> & PaintingParams[]
  upscale: Partial<ScalePainting> & PaintingParams[]
}

export type MinAppType = {
  id: string
  name: string
  logo?: string
  url: string
  bodered?: boolean
  background?: string
  style?: React.CSSProperties
  addTime?: string
  type?: 'Custom' | 'Default' // Added the 'type' property
}

export interface FileType {
  id: string
  name: string
  origin_name: string
  path: string
  size: number
  ext: string
  type: FileTypes
  created_at: string
  count: number
  tokens?: number
}

export enum FileTypes {
  IMAGE = 'image',
  VIDEO = 'video',
  AUDIO = 'audio',
  TEXT = 'text',
  DOCUMENT = 'document',
  OTHER = 'other'
}

export enum ThemeMode {
  light = 'light',
  dark = 'dark',
  auto = 'auto'
}

export type LanguageVarious = 'zh-CN' | 'zh-TW' | 'el-GR' | 'en-US' | 'es-ES' | 'fr-FR' | 'ja-JP' | 'pt-PT' | 'ru-RU'

export type TranslateLanguageVarious =
  | 'chinese'
  | 'chinese-traditional'
  | 'greek'
  | 'english'
  | 'spanish'
  | 'french'
  | 'japanese'
  | 'portuguese'
  | 'russian'

export type CodeStyleVarious = 'auto' | string

export type WebDavConfig = {
  webdavHost: string
  webdavUser: string
  webdavPass: string
  webdavPath: string
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
}

export interface Shortcut {
  key: string
  shortcut: string[]
  editable: boolean
  enabled: boolean
  system: boolean
}

export type ProcessingStatus = 'pending' | 'processing' | 'completed' | 'failed'

export type KnowledgeItemType = 'file' | 'url' | 'note' | 'sitemap' | 'directory'

export type KnowledgeItem = {
  id: string
  baseId?: string
  uniqueId?: string
  uniqueIds?: string[]
  type: KnowledgeItemType
  content: string | FileType
  remark?: string
  created_at: number
  updated_at: number
  processingStatus?: ProcessingStatus
  processingProgress?: number
  processingError?: string
  retryCount?: number
}

export interface KnowledgeBase {
  id: string
  name: string
  model: Model
  dimensions: number
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
}

export type KnowledgeBaseParams = {
  id: string
  model: string
  dimensions: number
  apiKey: string
  apiVersion?: string
  baseURL: string
  chunkSize?: number
  chunkOverlap?: number
  rerankApiKey?: string
  rerankBaseURL?: string
  rerankModel?: string
  rerankModelProvider?: string
  documentCount?: number
}

export type GenerateImageParams = {
  model: string
  prompt: string
  negativePrompt?: string
  imageSize: string
  batchSize: number
  seed?: string
  numInferenceSteps: number
  guidanceScale: number
  signal?: AbortSignal
  promptEnhancement?: boolean
}

export type GenerateImageResponse = {
  type: 'url' | 'base64'
  images: string[]
}

export interface TranslateHistory {
  id: string
  sourceText: string
  targetText: string
  sourceLanguage: string
  targetLanguage: string
  createdAt: string
}

export type SidebarIcon = 'assistants' | 'agents' | 'paintings' | 'translate' | 'minapp' | 'knowledge' | 'files'

export type ExternalToolResult = {
  mcpTools?: MCPTool[]
  toolUse?: MCPToolResponse[]
  webSearch?: WebSearchResponse
  knowledge?: KnowledgeReference[]
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
  contentLimit?: number
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
  ZHIPU = 'zhipu'
}

export type WebSearchResponse = {
  results: WebSearchResults
  source: WebSearchSource
}

export type KnowledgeReference = {
  id: number
  content: string
  sourceUrl: string
  type: KnowledgeItemType
  file?: FileType
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
  configSample?: MCPConfigSample
  headers?: Record<string, string> // Custom headers to be sent with requests to this server
  searchKey?: string
  provider?: string // Provider name for this server like ModelScope, Higress, etc.
  providerUrl?: string // URL of the MCP server in provider's website or documentation
  logoUrl?: string // URL of the MCP server's logo
  tags?: string[] // List of tags associated with this server
  timeout?: number // Timeout in seconds for requests to this server, default is 60 seconds
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
}

interface BaseToolResponse {
  id: string // unique id
  tool: MCPTool
  arguments: Record<string, unknown> | undefined
  status: string // 'invoking' | 'done'
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
  hostname: string
  title?: string
  content?: string
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
