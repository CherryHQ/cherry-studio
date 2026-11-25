import type {
  ClientApp,
  ClientConnection,
  InitializeResponse,
  NewSessionResponse,
  PromptRequest,
  PromptResponse,
  SessionUpdate
} from '@agentclientprotocol/sdk'

import type { OperationResult, ThreadContextUsage } from '@cherrystudio/agent-runtime'

export interface AcpHarnessSession {
  readonly promptMeta?: PromptRequest['_meta']
  inspectContextUsage?(): Promise<OperationResult<ThreadContextUsage>>
  contextAfterPrompt?(response: PromptResponse, revision: string): ThreadContextUsage | undefined
  consumeUpdate?(update: SessionUpdate): boolean
}

export interface AcpHarnessHost {
  readonly signal: AbortSignal
  isActive(): boolean
  isActiveSession(sessionId: string): boolean
  usage(value: NonNullable<PromptResponse['usage']>): void
  approve(
    id: string,
    name: string,
    input: Record<string, unknown>,
    signal?: AbortSignal
  ): Promise<{ approved: boolean; updatedInput?: Record<string, unknown> }>
  text(text: string): void
  result(id: string, output: unknown): void
}

export interface AcpHarnessAdapter {
  register?(app: ClientApp, host: AcpHarnessHost): void
  retainSetupUpdate?(update: SessionUpdate): boolean
  bind?(input: {
    readonly agent: Pick<ClientConnection['agent'], 'request'>
    readonly agentCapabilities: InitializeResponse['agentCapabilities']
    readonly sessionId: string
    readonly newSessionMetadata?: NewSessionResponse['_meta']
    currentModel(): string | undefined
  }): AcpHarnessSession
}
