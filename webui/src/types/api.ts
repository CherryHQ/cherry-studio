export type WebUiRole = 'user' | 'assistant' | 'system' | 'tool'

export type WebUiConversationSummary = {
  readonly id: string
  readonly agentId: string | null
  readonly title: string
  readonly updatedAt: string
  readonly workspaceLabel?: string
}

export type WebUiContextUsage = {
  readonly model: string
  readonly totalTokens: number
  readonly maxTokens: number
  readonly categories: readonly {
    readonly name: string
    readonly tokens: number
  }[]
}

export type WebUiContextUsageResponse = {
  readonly usage: WebUiContextUsage | null
}

export type WebUiSlashCommand = {
  readonly name: string
  readonly description?: string
}

export type WebUiSlashCommandsResponse = {
  readonly commands: readonly WebUiSlashCommand[]
}

export type WebUiMessageSnapshot = {
  readonly id: string
  readonly conversationId: string
  readonly role: WebUiRole
  readonly content: string
  readonly reasoning?: string
  readonly toolCalls?: readonly WebUiToolCallSnapshot[]
  readonly agentStatusEvents?: readonly WebUiAgentStatusEvent[]
  readonly attachments?: readonly WebUiMessageAttachmentSnapshot[]
  readonly status: 'pending' | 'success' | 'error' | 'paused'
  readonly processingTimeMs?: number
  readonly createdAt: string
}

export type WebUiAgentTaskStatus = 'pending' | 'in_progress' | 'completed' | 'error'

export type WebUiAgentTaskEventData = {
  readonly event: 'started' | 'progress' | 'updated' | 'notification'
  readonly taskId: string
  readonly status?: WebUiAgentTaskStatus
  readonly title?: string
  readonly activeText?: string
  readonly description?: string
  readonly summary?: string
}

export type WebUiAgentStatusEvent =
  | {
      readonly kind: 'tool'
      readonly id: string
      readonly name: string
      readonly state: WebUiToolCallState
      readonly input?: unknown
      readonly output?: unknown
    }
  | {
      readonly kind: 'task-event'
      readonly id: string
      readonly data: WebUiAgentTaskEventData
    }

export type WebUiMessageAttachmentSnapshot = {
  readonly name: string
  readonly mediaType?: string
}

export type WebUiSendAttachment = {
  readonly name: string
  readonly mediaType: string
  readonly size: number
  readonly dataUrl: string
}

export type WebUiToolCallState =
  | 'input-streaming'
  | 'input-available'
  | 'approval-requested'
  | 'output-available'
  | 'output-error'
  | 'output-denied'

export type WebUiToolCallSnapshot = {
  readonly id: string
  readonly name: string
  readonly state: WebUiToolCallState
  readonly input?: string
  readonly output?: string
  readonly errorText?: string
}

export type WebUiSseEventName = 'ready' | 'chunk' | 'sync' | 'error' | 'done'

export type WebUiSseMessage<TData = unknown> = {
  readonly event: WebUiSseEventName
  readonly data: TData
}

export type WebUiChunkPayload = {
  readonly conversationId: string
  readonly messageId: string
  readonly chunk: WebUiStreamChunk
}

export type WebUiStreamChunk = {
  readonly type: string
  readonly id?: string
  readonly data?: unknown
  readonly delta?: string
  readonly toolCallId?: string
  readonly toolName?: string
  readonly inputTextDelta?: string
  readonly input?: unknown
  readonly output?: unknown
  readonly errorText?: string
}

export type WebUiApiError = {
  readonly message: string
  readonly code?: string
}

export type WebUiHealthResponse = {
  readonly ok: true
  readonly appVersion?: string
  readonly language?: string | null
  readonly service: 'cherry-studio-webui'
  readonly startedAt: string
  readonly sseClients: number
  readonly timestamp: string
}

export type WebUiAuthStatusResponse = {
  readonly authRequired: boolean
  readonly language?: string | null
  readonly userName?: string | null
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

export type WebUiModel = {
  readonly id: string
  readonly name: string
  readonly providerId: string
  readonly group?: string
  readonly isEnabled: boolean
  readonly isHidden: boolean
  readonly capabilities: readonly string[]
  readonly reasoningOptions?: readonly string[]
}

export type WebUiModelGroup = {
  readonly id: string
  readonly name: string
  readonly models: readonly WebUiModel[]
}

export type WebUiModelsResponse = {
  readonly groups: readonly WebUiModelGroup[]
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
  readonly id?: string
  readonly data?: unknown
  readonly text?: string
  readonly toolCallId?: string
  readonly toolName?: string
  readonly state?: string
  readonly input?: unknown
  readonly output?: unknown
  readonly errorText?: string
  readonly filename?: string
  readonly mediaType?: string
  readonly providerMetadata?: {
    readonly cherry?: {
      readonly thinkingMs?: number
    }
  }
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
  readonly stats?: {
    readonly timeCompletionMs?: number
    readonly timeThinkingMs?: number
  } | null
  readonly createdAt: string
  readonly updatedAt: string
}
