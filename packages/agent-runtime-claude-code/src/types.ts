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
  RuntimeMessage,
  InputId,
  ItemRef,
  Observation,
  ObservationPayload,
  OperationResult,
  SubmitResult,
  Subagent,
  Thread,
  ThreadHandle
} from '@cherrystudio/agent-runtime'

import type { ClaudeControl } from './control'

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

/** Native SDK stream event omitted from the pinned SDKMessage declaration. */
export interface ClaudeCommandLifecycle {
  readonly type: 'command_lifecycle'
  readonly command_uuid: string
  readonly state: 'queued' | 'started' | 'completed' | 'cancelled' | 'discarded' | 'refused'
  readonly uuid: string
  readonly session_id: string
}

export type ClaudeNativeMessage =
  | { readonly source: 'live'; readonly message: SDKMessage | ClaudeCommandLifecycle }
  | { readonly source: 'archive'; readonly message: SessionMessage }

export interface ClaudeInvocation {
  readonly responseId: string
  readonly model?: string
  readonly usage?: {
    readonly inputTokens: number
    readonly outputTokens: number
    readonly totalTokens: number
    readonly noCacheTokens: number
    readonly cacheReadTokens: number
    readonly cacheWriteTokens: number
  }
  readonly metrics?: {
    readonly timeFirstTokenMs?: number
    readonly timeCompletionMs?: number
    readonly timeThinkingMs?: number
  }
}

export interface ClaudeObservation {
  readonly controls?: readonly ClaudeControl[]
  readonly state?: {
    readonly active: boolean
    readonly aborted: boolean
    readonly backgroundTasks?: Extract<ClaudeControl, { type: 'background-tasks' }>['tasks']
    readonly backgroundWorkActive?: boolean
  }
  readonly delivery?: 'baseline' | 'update' | 'recovery'
  /** Completed native invocations not yet delivered to this observation; absent from its baseline. */
  readonly invocations?: readonly ClaudeInvocation[]
  /** Sources produced by native execution, retained through observer recovery. */
  readonly live?: readonly string[]
  /** Provisional-to-committed source aliases retained after their update batch is folded. */
  readonly replaces?: Readonly<Record<string, string>>
  readonly legacy?: Readonly<Record<string, { messageId: string; parts: number[] }>>
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
  readonly coverage: 'current-view' | 'retained-view'
  readonly content: readonly RuntimeMessage[]
  readonly sources: readonly ClaudeSource[]
  readonly legacy: Readonly<Record<string, { messageId: string; parts: number[] }>>
  readonly messages: readonly SessionMessage[]
  /** Explicit native retractions; absence from the selected view is not a deletion. */
  readonly retracted: readonly string[]
}

export interface ClaudeThreadHandle extends ThreadHandle {
  readonly claude: {
    state(): { readonly active: boolean; readonly aborted: boolean }
    relation(): Subagent | undefined
    openChild(
      toolCallId: string,
      signal?: AbortSignal
    ): Promise<
      OperationResult<{
        readonly relation: Subagent & { readonly child: Thread }
        readonly handle: ClaudeThreadHandle
      }>
    >
    readonly sessionId: string
    readonly agentId?: string
    /** Start the native connection without submitting input; a warm handoff transfers sole ownership. */
    start(warm?: { query: WarmQuery; exited: Promise<void> }): OperationResult<void>
    supportedCommands(): Promise<OperationResult<Awaited<ReturnType<Query['supportedCommands']>>>>
    contextUsage(): Promise<OperationResult<Awaited<ReturnType<Query['getContextUsage']>>>>
    setPermissionMode(mode: Parameters<Query['setPermissionMode']>[0]): Promise<OperationResult<void>>
    submit(inputId: InputId, content: SDKUserMessage['message']['content'], whenBusy: BusyPolicy): Promise<SubmitResult>
    observe(sink: ClaudeObservationSink): Promise<OperationResult<Observation>>
    /** Without refresh, reads already observed committed sources without producing new observation events. */
    archive(options?: { readonly refresh: boolean }): Promise<OperationResult<ClaudeArchive>>
    stopTask(taskId: string): Promise<OperationResult<{ readonly effect: 'requested' }>>
  }
}

export interface ClaudeCodeRuntime extends AgentRuntime {
  /** Join admitted native input and background work without closing the owner. */
  settled(): Promise<void>
  create(options: ClaudeSessionOptions): Promise<OperationResult<ClaudeThreadHandle>>
  open(thread: Thread): Promise<OperationResult<ClaudeThreadHandle>>
}
