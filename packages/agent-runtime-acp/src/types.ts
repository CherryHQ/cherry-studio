import type {
  ClientRequestParamsByMethod,
  ClientRequestResponsesByMethod,
  ContentBlock,
  InitializeResponse,
  NewSessionRequest,
  NewSessionResponse,
  PromptResponse,
  RequestPermissionRequest,
  RequestPermissionResponse,
  SessionUpdate,
  Stream,
  ToolCallUpdate
} from '@agentclientprotocol/sdk'

import type {
  AgentRuntime,
  BackendId,
  InputDraft,
  InputId,
  Observation,
  ObservationPayload,
  OperationResult,
  SubmitResult,
  Thread,
  ThreadHandle
} from '@cherrystudio/agent-runtime'

export interface AcpTransportLease {
  readonly stream: Stream
  /** Close and join the owned source, including process exit when applicable. Must support retry after failure. */
  closeAndJoin(): Promise<void>
}

export interface AcpHostContext {
  readonly thread: Thread
  readonly signal: AbortSignal
}

type HostMethod = Exclude<keyof ClientRequestParamsByMethod, 'session/request_permission'>
export type AcpHostHandler<M extends HostMethod> = (
  params: ClientRequestParamsByMethod[M],
  context: AcpHostContext
) => Promise<ClientRequestResponsesByMethod[M]>

export interface AcpHostCallbacks {
  permission?: (params: RequestPermissionRequest, context: AcpHostContext) => Promise<RequestPermissionResponse>
  readTextFile?: AcpHostHandler<'fs/read_text_file'>
  writeTextFile?: AcpHostHandler<'fs/write_text_file'>
  terminal?: {
    create: AcpHostHandler<'terminal/create'>
    output: AcpHostHandler<'terminal/output'>
    release: AcpHostHandler<'terminal/release'>
    waitForExit: AcpHostHandler<'terminal/wait_for_exit'>
    kill: AcpHostHandler<'terminal/kill'>
  }
  elicitation?: AcpHostHandler<'elicitation/create'>
}

export interface AcpRuntimeOptions {
  readonly backendId: BackendId
  connect(): Promise<AcpTransportLease>
  loadConfiguration?(thread: Thread): Promise<NewSessionRequest>
  readonly callbacks?: AcpHostCallbacks
  report(error: unknown): void
}

export type AcpInputDraft = Omit<InputDraft, 'text'> & { readonly content: readonly ContentBlock[] }
export interface AcpNativeMessage {
  readonly id: string
  readonly kind: 'user_message_chunk' | 'agent_message_chunk' | 'agent_thought_chunk'
  readonly nativeId?: string
  readonly chunks: readonly Extract<SessionUpdate, { content: ContentBlock }>[]
}
export interface AcpSessionState {
  readonly configuration: Omit<NewSessionResponse, 'sessionId'>
  readonly turns: readonly { inputId: InputId; response: PromptResponse }[]
  readonly messages: readonly AcpNativeMessage[]
  readonly tools: readonly ToolCallUpdate[]
  readonly metadata: readonly SessionUpdate[]
}
export interface AcpObservationFrame {
  readonly revision: number
  readonly event: ObservationPayload
  readonly update?: SessionUpdate
  /** Included on baseline and overflow recovery; never reconstructed from display text. */
  readonly state?: AcpSessionState
}

export interface AcpThreadHandle extends ThreadHandle {
  readonly acp: {
    state(): AcpSessionState
    submit(input: AcpInputDraft): Promise<SubmitResult>
    observe(sink: (frame: AcpObservationFrame) => void | Promise<void>): Promise<OperationResult<Observation>>
    setMode(modeId: string): Promise<OperationResult<void>>
    setConfigOption(configId: string, value: string | boolean): Promise<OperationResult<void>>
  }
}
export interface AcpRuntime extends AgentRuntime {
  initialize(): Promise<OperationResult<InitializeResponse>>
  authenticate(methodId: string): Promise<OperationResult<void>>
  create(configuration: NewSessionRequest): Promise<OperationResult<AcpThreadHandle>>
  open(thread: Thread): Promise<OperationResult<AcpThreadHandle>>
}
