import type {
  ClientConnection,
  InitializeResponse,
  NewSessionResponse,
  PromptRequest,
  PromptResponse
} from '@agentclientprotocol/sdk'

import type { OperationResult, ThreadContextUsage } from '@cherrystudio/agent-runtime'

export interface AcpHarnessSession {
  readonly promptMeta?: PromptRequest['_meta']
  inspectContextUsage?(): Promise<OperationResult<ThreadContextUsage>>
  contextAfterPrompt?(response: PromptResponse, revision: string): ThreadContextUsage | undefined
  consumeAssistantText?(text: string): boolean
}

export interface AcpHarnessHost {
  onNotification<T>(method: string, schema: { parse(params: unknown): T }, handle: (params: T) => void): void
  isActiveSession(sessionId: string): boolean
  usage(value: NonNullable<PromptResponse['usage']>): void
}

export interface AcpHarnessAdapter {
  register?(host: AcpHarnessHost): void
  readonly setupUpdate?: 'agent_message_chunk'
  bind?(input: {
    readonly agent: Pick<ClientConnection['agent'], 'request'>
    readonly agentCapabilities: InitializeResponse['agentCapabilities']
    readonly sessionId: string
    readonly newSessionMetadata?: NewSessionResponse['_meta']
    currentModel(): string | undefined
  }): AcpHarnessSession
}
