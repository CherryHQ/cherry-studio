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
  ThreadInput,
  SubmitInput,
  InputDraft,
  InputId,
  Observation,
  ObservationPayload,
  OperationResult,
  Thread,
  ThreadHandle,
  ThreadContextUsage
} from '@cherrystudio/agent-runtime'

import type { AcpSessionControls } from './configuration'
import type { AcpHarnessSession } from './harness'
import type { AcpModelSelection } from './profile'
import type { AcpTurnUsage } from './usage'

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
export type AcpHostHandler<M extends HostMethod, Context = AcpHostContext> = (
  params: ClientRequestParamsByMethod[M],
  context: Context
) => Promise<ClientRequestResponsesByMethod[M]>

interface HostCallbacks<Context> {
  permission?: (params: RequestPermissionRequest, context: Context) => Promise<RequestPermissionResponse>
  readTextFile?: AcpHostHandler<'fs/read_text_file', Context>
  writeTextFile?: AcpHostHandler<'fs/write_text_file', Context>
  terminal?: {
    create: AcpHostHandler<'terminal/create', Context>
    output: AcpHostHandler<'terminal/output', Context>
    release: AcpHostHandler<'terminal/release', Context>
    waitForExit: AcpHostHandler<'terminal/wait_for_exit', Context>
    kill: AcpHostHandler<'terminal/kill', Context>
  }
  elicitation?: AcpHostHandler<'elicitation/create', Context>
}

export type AcpHostCallbacks = HostCallbacks<AcpHostContext>
export type AcpClientCallbacks = HostCallbacks<Pick<AcpHostContext, 'signal'>>

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
export type AcpSessionConfiguration = Omit<NewSessionResponse, 'sessionId'>
export interface AcpSessionState {
  readonly configuration: AcpSessionConfiguration
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

export interface AcpPromptOutcome {
  stopReason: PromptResponse['stopReason']
  usage?: AcpTurnUsage
  context?: ThreadContextUsage
}

interface AcpReplayAccess {
  state(): AcpSessionState
  observe(sink: (frame: AcpObservationFrame) => void | Promise<void>): Promise<OperationResult<Observation>>
}

interface AcpDesktopAccess extends Pick<AcpHarnessSession, 'legacyEffort' | 'predictPrompt' | 'steer'> {
  runPrompt(draft: AcpInputDraft): Promise<AcpPromptOutcome>
  selectInitialModel(selection: AcpModelSelection & { model: string }): Promise<OperationResult<void>>
  readonly awaitingNativeTurn: boolean
  drainNativeTurn(): void
}

export interface AcpThreadHandle<Desktop extends boolean = false> extends ThreadHandle {
  readonly input: Required<Pick<ThreadInput, 'submit'>>
  readonly acp: {
    readonly submit: SubmitInput<AcpInputDraft>
    readonly model: AcpSessionControls['model']
    selectModel(modelId: string): Promise<OperationResult<void>>
    setMode(modeId: string): Promise<OperationResult<void>>
    setConfigOption(configId: string, value: string | boolean): Promise<OperationResult<void>>
  } & (Desktop extends true ? AcpDesktopAccess : AcpReplayAccess)
}

export interface AcpRuntime extends AgentRuntime {
  initialize(): Promise<OperationResult<InitializeResponse>>
  authenticate(methodId: string): Promise<OperationResult<void>>
  create(configuration: NewSessionRequest): Promise<OperationResult<AcpThreadHandle>>
  open(thread: Thread): Promise<OperationResult<AcpThreadHandle>>
}
