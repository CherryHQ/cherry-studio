import OpenAI from 'openai'
import React from 'react'
import { BuiltinTheme } from 'shiki'

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
  enableWebSearch?: boolean
  enableGenerateImage?: boolean
  mcpServers?: MCPServer[]
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
  reasoning_effort?: 'low' | 'medium' | 'high'
}

export type Agent = Omit<Assistant, 'model'>

export type Message = {
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
  usage?: OpenAI.Completions.CompletionUsage
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
    groundingMetadata?: any
    // Perplexity
    citations?: string[]
    // Web search
    webSearch?: WebSearchResponse
    // MCP Tools
    mcpTools?: MCPToolResponse[]
    // Generate Image
    generateImage?: GenerateImageResponse
  }
  // 多模型消息样式
  multiModelMessageStyle?: 'horizontal' | 'vertical' | 'fold' | 'grid'
  // fold时是否选中
  foldSelected?: boolean
}

export type Metrics = {
  completion_tokens?: number
  time_completion_millsec?: number
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
}

export type ProviderType = 'openai' | 'anthropic' | 'gemini' | 'qwenlm' | 'azure-openai'

export type ModelType = 'text' | 'vision' | 'embedding' | 'reasoning' | 'function_calling'

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

export interface Painting {
  id: string
  model?: string
  urls: string[]
  files: FileType[]
  prompt?: string
  negativePrompt?: string
  imageSize?: string
  numImages?: number
  seed?: string
  steps?: number
  guidanceScale?: number
  promptEnhancement?: boolean
}

export type MinAppType = {
  id: string
  name: string
  logo?: string
  url: string
  bodered?: boolean
  background?: string
  style?: React.CSSProperties
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

export type CodeStyleVarious = BuiltinTheme | 'auto'

export type WebDavConfig = {
  webdavHost: string
  webdavUser: string
  webdavPass: string
  webdavPath: string
  fileName?: string
}

export type AppInfo = {
  version: string
  isPackaged: boolean
  appPath: string
  appDataPath: string
  resourcesPath: string
  filesPath: string
  logsPath: string
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
  topN?: number
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
  topN?: number
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

export type WebSearchProvider = {
  id: string
  name: string
  apiKey?: string
  apiHost?: string
  engines?: string[]
}

export type WebSearchResponse = {
  query?: string
  results: WebSearchResult[]
}

export type WebSearchResult = {
  title: string
  content: string
  url: string
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

export interface MCPServer {
  id: string
  name: string
  description?: string
  baseUrl?: string
  command?: string
  registryUrl?: string
  args?: string[]
  env?: Record<string, string>
  isActive: boolean
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

export interface MCPConfig {
  servers: MCPServer[]
}

export interface MCPToolResponse {
  id: string // tool call id, it should be unique
  tool: MCPTool // tool info
  status: string // 'invoking' | 'done'
  response?: any
}
