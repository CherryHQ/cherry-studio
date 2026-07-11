export type WebUiRole = 'user' | 'assistant' | 'system' | 'tool'

export type WebUiConversationSummary = {
  readonly id: string
  readonly title: string
  readonly updatedAt: string
  readonly workspaceLabel?: string
}

export type WebUiMessageSnapshot = {
  readonly id: string
  readonly conversationId: string
  readonly role: WebUiRole
  readonly content: string
  readonly reasoning?: string
  readonly createdAt: string
}

export type WebUiSseEventName = 'ready' | 'chunk' | 'sync' | 'error' | 'done'

export type WebUiSseMessage<TData = unknown> = {
  readonly event: WebUiSseEventName
  readonly data: TData
}

export type WebUiChunkPayload = {
  readonly conversationId: string
  readonly messageId: string
  readonly kind: 'text' | 'reasoning' | 'meta'
  readonly delta: string
}

export type WebUiApiError = {
  readonly message: string
  readonly code?: string
}

export type WebUiHealthResponse = {
  readonly ok: true
  readonly service: 'cherry-studio-webui'
  readonly startedAt: string
  readonly sseClients: number
  readonly timestamp: string
}

export type WebUiCursorResponse<TItem> = {
  readonly items: readonly TItem[]
  readonly nextCursor?: string
}

export type WebUiOffsetResponse<TItem> = {
  readonly items: readonly TItem[]
  readonly total: number
  readonly page: number
}

export type WebUiAgentEntity = {
  readonly id: string
  readonly name: string
  readonly model: string | null
  readonly modelName: string | null
}

export type WebUiAgentSessionEntity = {
  readonly id: string
  readonly name: string
  readonly agentId: string | null
  readonly updatedAt: string
  readonly workspace?: {
    readonly name?: string
    readonly path?: string
  }
}

export type WebUiMessagePart = {
  readonly type: string
  readonly text?: string
}

export type WebUiAgentSessionMessageEntity = {
  readonly id: string
  readonly sessionId: string
  readonly role: Exclude<WebUiRole, 'tool'>
  readonly data: {
    readonly parts?: readonly WebUiMessagePart[]
  }
  readonly searchableText: string
  readonly status: 'pending' | 'success' | 'error' | 'paused'
  readonly createdAt: string
  readonly updatedAt: string
}
