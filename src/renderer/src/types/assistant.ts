import { Model } from './ai'
import { Topic } from './chat'
import { KnowledgeBase } from './knowledge'
import { MCPServer } from './mcp'
import { ReasoningEffortOption } from './reasoning'
import { TranslateLanguage } from './translate'
import { WebSearchProvider } from './websearch'

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

export type AssistantPreset = Omit<Assistant, 'model'> & {
  group?: string[]
}

export interface QuickPhrase {
  id: string
  title: string
  content: string
  createdAt: number
  updatedAt: number
  order?: number
}
