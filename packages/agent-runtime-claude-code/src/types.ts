import type {
  Options,
  Query,
  SDKMessage,
  SDKUserMessage,
  SessionMessage,
  WarmQuery
} from '@anthropic-ai/claude-agent-sdk'

import type {
  AgentRuntime,
  BackendId,
  BusyPolicy,
  ContentItem,
  InputId,
  ItemRef,
  Observation,
  ObservationPayload,
  OperationResult,
  SubmitResult,
  Thread,
  ThreadHandle
} from '@cherrystudio/agent-runtime'

export type ClaudeSessionOptions = Omit<
  Options,
  | 'continue'
  | 'resume'
  | 'resumeSessionAt'
  | 'resumeDropsTurn'
  | 'forkSession'
  | 'sessionStore'
  | 'persistSession'
  | 'includePartialMessages'
  | 'forwardSubagentText'
> & { cwd: string }

export interface ClaudeCodeRuntimeOptions {
  readonly backendId: BackendId
  readonly configDir: string
  /** Resolve the configuration of this exact saved root, without starting execution. */
  readonly load?: (root: Thread) => Promise<ClaudeSessionOptions | undefined>
  readonly onError?: (error: unknown) => void
}

export type ClaudeNativeMessage =
  | { readonly source: 'live'; readonly message: SDKMessage }
  | { readonly source: 'archive'; readonly message: SessionMessage }

export interface ClaudeObservation {
  readonly events: readonly ObservationPayload[]
  /** Native payload captured with this batch, never looked up at delivery time. */
  readonly native: readonly ClaudeNativeMessage[]
  /** Native UUID tombstones, including sources no longer present in a snapshot. */
  readonly retracted: readonly string[]
}

export type ClaudeObservationSink = (batch: ClaudeObservation) => void | Promise<void>

export interface ClaudeSource {
  readonly ref: ItemRef
  readonly uuid: string
  readonly block: number
}

export interface ClaudeArchive {
  readonly thread: Thread
  readonly coverage: 'current-view'
  readonly items: readonly ContentItem[]
  readonly sources: readonly ClaudeSource[]
  readonly messages: readonly SessionMessage[]
  /** Explicit native retractions; absence from the selected view is not a deletion. */
  readonly retracted: readonly string[]
}

export interface ClaudeThreadHandle extends ThreadHandle {
  readonly claude: {
    readonly sessionId: string
    readonly agentId?: string
    /** Start the native connection without submitting input; a warm handoff transfers sole ownership. */
    start(warm?: { query: WarmQuery; exited: Promise<void> }): OperationResult<void>
    supportedCommands(): Promise<OperationResult<Awaited<ReturnType<Query['supportedCommands']>>>>
    contextUsage(): Promise<OperationResult<Awaited<ReturnType<Query['getContextUsage']>>>>
    setPermissionMode(mode: Parameters<Query['setPermissionMode']>[0]): Promise<OperationResult<void>>
    submit(inputId: InputId, content: SDKUserMessage['message']['content'], whenBusy: BusyPolicy): Promise<SubmitResult>
    observe(sink: ClaudeObservationSink): Promise<OperationResult<Observation>>
    archive(): Promise<OperationResult<ClaudeArchive>>
    stopTask(taskId: string): Promise<OperationResult<{ readonly effect: 'requested' }>>
  }
}

export interface ClaudeCodeRuntime extends AgentRuntime {
  create(options: ClaudeSessionOptions): Promise<OperationResult<ClaudeThreadHandle>>
  open(thread: Thread): Promise<OperationResult<ClaudeThreadHandle>>
}
