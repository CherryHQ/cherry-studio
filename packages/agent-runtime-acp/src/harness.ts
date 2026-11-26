import type {
  ClientConnection,
  InitializeResponse,
  NewSessionResponse,
  PromptRequest,
  PromptResponse,
  SessionUpdate
} from '@agentclientprotocol/sdk'

import type { RuntimeAccountResult, SubscriptionUsageResult } from '@cherrystudio/agent-runtime'
import type {
  CompactThread,
  OperationResult,
  ThreadInput,
  RuntimeEffortControl,
  RuntimeModelOption,
  ThreadContextUsage
} from '@cherrystudio/agent-runtime'

import type { AcpPermissionOption, AcpPermissionOptionDetails, AcpPermissionRequest } from './permissions'
import type { AcpLaunch } from './profile'
import type { AcpInputDraft } from './types'
import type { AcpTurnUsage } from './usage'

interface AcpPermissionQuestion {
  text: string
  options: { label: string }[]
  optionIdFor(answer: string): string | undefined
}

export type AcpSubscriptionUsageReader = (
  agent: Pick<ClientConnection['agent'], 'request'>,
  response: InitializeResponse,
  target: { readonly env: Readonly<Record<string, string>>; readonly model?: string }
) => Promise<SubscriptionUsageResult>

export type AcpAccountReader = (
  agent: Pick<ClientConnection['agent'], 'request'>,
  response: InitializeResponse,
  launch: AcpLaunch
) => Promise<RuntimeAccountResult>

export type AcpModelCatalogReader = (
  agent: Pick<ClientConnection['agent'], 'request'>
) => Promise<{ models: RuntimeModelOption[]; activeModel?: { id: string } } | undefined>

export type AcpNativeTurn =
  | { state: 'started'; sessionId: string; id: string }
  | { state: 'finished'; sessionId: string; id: string; error?: string; cancelled?: true; usage?: AcpTurnUsage }

export interface AcpHarnessSession {
  readonly steer?: ThreadInput<AcpInputDraft>['steer']
  readonly compact?: CompactThread
  observeUpdate?(update: SessionUpdate): void
  readonly promptMeta?: PromptRequest['_meta']
  readonly legacyEffort?: {
    read(): RuntimeEffortControl | undefined
    set(value: string): Promise<void>
  }
  predictPrompt?(signal: AbortSignal): Promise<string>
  inspectContextUsage?(): Promise<OperationResult<ThreadContextUsage>>
  contextAfterPrompt?(response: PromptResponse, revision: string): ThreadContextUsage | undefined
  consumeAssistantText?(text: string): boolean
}

export interface AcpHarnessAdapter {
  readonly preferredRestore?: 'load'
  readonly hostMutations?: 'disabled'
  permissionQuestion?(request: AcpPermissionRequest): AcpPermissionQuestion | undefined
  describePermissionOption?(option: AcpPermissionOption): AcpPermissionOptionDetails
  registerRequests?(
    onRequest: <P, R>(
      method: string,
      schema: { parse(value: unknown): P },
      handle: (params: P, signal: AbortSignal) => Promise<R>
    ) => void
  ): void
  registerProtocol?(host: {
    onNotification<T>(method: string, schema: { parse(params: unknown): T }, handle: (params: T) => void): void
    nativeTurn(event: AcpNativeTurn): void
  }): (sessionId: string) => {
    readonly metadata: NonNullable<PromptRequest['_meta']>
    read(response: PromptResponse): AcpTurnUsage | undefined
    release(): void
  }
  readonly setupUpdate?: 'agent_message_chunk'
  bind?(input: {
    readonly agent: Pick<ClientConnection['agent'], 'request'>
    readonly agentCapabilities: InitializeResponse['agentCapabilities']
    readonly initializeMetadata?: InitializeResponse['_meta']
    readonly sessionId: string
    readonly newSessionMetadata?: NewSessionResponse['_meta']
    readonly legacyModelState?: unknown
    currentModel(): string | undefined
  }): AcpHarnessSession
}
