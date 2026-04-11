/** Context payload sent with each AI chat request via body. */
export interface AiAssistantRuntimeOverrides {
  prompt?: string
  settings?: {
    maxTokens?: number
    enableMaxTokens?: boolean
    temperature?: number
    enableTemperature?: boolean
    topP?: number
    enableTopP?: boolean
    contextCount?: number
    streamOutput?: boolean
    customParameters?: Array<{
      name: string
      value: string | number | boolean | object
      type: 'string' | 'number' | 'boolean' | 'json'
    }>
    reasoning_effort?: string
    reasoning_effort_cache?: string
    qwenThinkMode?: boolean
    toolUseMode?: 'function' | 'prompt'
    maxToolCalls?: number
    enableMaxToolCalls?: boolean
  }
  enableWebSearch?: boolean
  webSearchProviderId?: string
  enableUrlContext?: boolean
  enableGenerateImage?: boolean
}

export interface AiChatRequestBody {
  /** Topic ID for message routing and persistence. */
  topicId: string
  /** Assistant configuration ID. */
  assistantId?: string
  /** Models mentioned via @ in the input (multi-model fan-out). */
  mentionedModels?: Array<{ id: string; name?: string }>
  /** Uploaded file metadata. */
  files?: Array<{ id: string; name: string; type: string; size: number; url: string }>
  /** OpenTelemetry trace ID for request tracing. */
  traceId?: string
  /** Runtime assistant overrides for ephemeral chat flows. */
  assistantOverrides?: AiAssistantRuntimeOverrides

  // ── Capability flags (Renderer → Main) ──
  // Renderer extracts these from the Assistant config and passes them as IDs/booleans.
  // Main uses the IDs to look up full configs from SQLite — no sensitive data crosses IPC.

  /** Enabled MCP tool IDs in "serverId__toolName" format. */
  mcpToolIds?: string[]
  /** Knowledge base IDs for RAG search. */
  knowledgeBaseIds?: string[]
  /** Enable provider-native web search (model built-in). */
  enableWebSearch?: boolean
  /** External web search provider ID (mutually exclusive with enableWebSearch). */
  webSearchProviderId?: string
  /** Enable URL context for Gemini/Anthropic models. */
  enableUrlContext?: boolean
  /** Enable inline image generation. */
  enableGenerateImage?: boolean
}
