/** Context payload sent with each AI chat request via body. */
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
