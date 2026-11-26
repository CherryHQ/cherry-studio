import type {
  ClientConnection,
  InitializeResponse,
  NewSessionResponse,
  PromptRequest,
  PromptResponse
} from '@agentclientprotocol/sdk'

import type { OperationResult, ThreadContextUsage } from '@cherrystudio/agent-runtime'

import type { AcpTurnUsage } from './usage'

export interface AcpHarnessSession {
  readonly promptMeta?: PromptRequest['_meta']
  predictPrompt?(signal: AbortSignal): Promise<string>
  inspectContextUsage?(): Promise<OperationResult<ThreadContextUsage>>
  contextAfterPrompt?(response: PromptResponse, revision: string): ThreadContextUsage | undefined
  consumeAssistantText?(text: string): boolean
}

export interface AcpHarnessAdapter {
  registerRequests?(
    onRequest: <P, R>(
      method: string,
      schema: { parse(value: unknown): P },
      handle: (params: P, signal: AbortSignal) => Promise<R>
    ) => void
  ): void
  registerPromptUsage?(host: {
    onNotification<T>(method: string, schema: { parse(params: unknown): T }, handle: (params: T) => void): void
  }): (sessionId: string) => {
    readonly metadata: NonNullable<PromptRequest['_meta']>
    read(response: PromptResponse): AcpTurnUsage | undefined
    release(): void
  }
  readonly setupUpdate?: 'agent_message_chunk'
  bind?(input: {
    readonly agent: Pick<ClientConnection['agent'], 'request'>
    readonly agentCapabilities: InitializeResponse['agentCapabilities']
    readonly sessionId: string
    readonly newSessionMetadata?: NewSessionResponse['_meta']
    currentModel(): string | undefined
  }): AcpHarnessSession
}
