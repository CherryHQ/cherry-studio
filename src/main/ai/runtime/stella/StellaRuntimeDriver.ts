import { agentService } from '@data/services/AgentService'
import { AGENT_RUNTIME_CAPABILITIES } from '@shared/ai/agentRuntimeCapabilities'
import type { Tool } from '@shared/ai/tool'
import type { AgentSessionEntity } from '@shared/data/api/schemas/agentSessions'
import type { CherryUIMessageChunk } from '@shared/data/types/message'

import { AsyncEventQueue } from '../asyncEventQueue'
import type {
  AgentRuntimeConnectInput,
  AgentRuntimeConnection,
  AgentRuntimeEvent,
  AgentRuntimeUserInput,
  AgentSessionRuntimeDriver
} from '../types'
import { stellaClient } from './StellaClient'

export const STELLA_TRANSPORT = AGENT_RUNTIME_CAPABILITIES.stella.transport

export class StellaRuntimeDriver implements AgentSessionRuntimeDriver {
  readonly type = 'stella'
  readonly capabilities = ['agent-session'] as const

  validateSession(session: AgentSessionEntity): void {
    if (!session.agentId) throw new Error(`Stella agent session ${session.id} has no agent`)
    const agent = agentService.getAgent(session.agentId)
    if (!agent || agent.type !== 'stella') throw new Error(`Stella agent ${session.agentId} is unavailable`)
    if (!getRemoteAgentId(agent.configuration))
      throw new Error(`Stella agent ${session.agentId} has no remote agent configured`)
  }

  async listAvailableTools(): Promise<Tool[]> {
    return []
  }

  async connect(input: AgentRuntimeConnectInput): Promise<AgentRuntimeConnection> {
    const agent = agentService.getAgent(input.agentId)
    const remoteAgentId = getRemoteAgentId(agent?.configuration)
    if (!remoteAgentId) throw new Error('Stella agent reference has no remote agent id')
    return new StellaRuntimeConnection(remoteAgentId, input.resumeToken).start()
  }
}

export class StellaRuntimeConnection implements AgentRuntimeConnection {
  private readonly eventQueue = new AsyncEventQueue<AgentRuntimeEvent>()
  private sessionId?: string
  private activeRequest?: AbortController
  private closed = false
  private terminalEmitted = false

  readonly events = this.eventQueue

  constructor(
    private readonly remoteAgentId: string,
    resumeToken?: string
  ) {
    this.sessionId = resumeToken
  }

  async start(): Promise<this> {
    if (!this.sessionId) {
      this.sessionId = await stellaClient.createSession(this.remoteAgentId)
      this.eventQueue.push({ type: 'resume-token', token: this.sessionId })
    }
    return this
  }

  send(input: AgentRuntimeUserInput): void {
    if (this.closed) return
    const text = textOnlyMessage(input)
    if (text === null) {
      this.eventQueue.push({ type: 'error', error: new Error('Stella POC supports text-only messages') })
      return
    }
    if (!this.sessionId) {
      this.eventQueue.push({ type: 'error', error: new Error('Stella session is not connected') })
      return
    }
    this.terminalEmitted = false
    this.activeRequest?.abort()
    const controller = new AbortController()
    this.activeRequest = controller
    void this.consumeTurn(this.sessionId, text, controller)
  }

  async close(): Promise<void> {
    if (this.closed) return
    this.closed = true
    this.activeRequest?.abort()
    this.activeRequest = undefined
    this.eventQueue.close()
  }

  private async consumeTurn(sessionId: string, text: string, controller: AbortController): Promise<void> {
    try {
      const response = await stellaClient.sendMessage(this.remoteAgentId, sessionId, text, controller.signal)
      let receivedTerminal = false
      for await (const frame of parseSse(response.body)) {
        if (this.closed || controller.signal.aborted) return
        if (frame === '[DONE]') {
          receivedTerminal = true
          break
        }
        const event = parseStellaFrame(frame)
        if (!event) continue
        if (event.type === 'error') {
          this.emitError(new Error('Stella agent turn failed'))
          return
        }
        if (event.type === 'finish') {
          receivedTerminal = true
          continue
        }
        const chunk = frameToChunk(event)
        if (chunk) this.eventQueue.push({ type: 'chunk', chunk })
      }
      if (!this.closed && !controller.signal.aborted && receivedTerminal) this.emitTurnComplete()
      else if (!this.closed && !controller.signal.aborted)
        this.emitError(new Error('Stella stream ended before completion'))
    } catch (error) {
      if (!this.closed && !controller.signal.aborted) this.emitError(error)
    } finally {
      if (this.activeRequest === controller) this.activeRequest = undefined
    }
  }

  private emitTurnComplete(): void {
    if (this.terminalEmitted) return
    this.terminalEmitted = true
    this.eventQueue.push({ type: 'turn-complete' })
  }

  private emitError(error: unknown): void {
    if (this.terminalEmitted) return
    this.terminalEmitted = true
    this.eventQueue.push({ type: 'error', error })
  }
}

function getRemoteAgentId(configuration: unknown): string | undefined {
  if (!configuration || typeof configuration !== 'object') return undefined
  const id = (configuration as { stella_remote_agent_id?: unknown }).stella_remote_agent_id
  return typeof id === 'string' && id ? id : undefined
}

function textOnlyMessage(input: AgentRuntimeUserInput): string | null {
  const parts = input.message.data.parts ?? []
  if (!parts.every((part) => part.type === 'text')) return null
  return parts.map((part) => (part.type === 'text' ? part.text : '')).join('\n')
}

type StellaFrame = { type: string; [key: string]: unknown }

function parseStellaFrame(data: string): StellaFrame | null {
  try {
    const value = JSON.parse(data) as unknown
    return typeof value === 'object' && value !== null && typeof (value as { type?: unknown }).type === 'string'
      ? (value as StellaFrame)
      : null
  } catch {
    return null
  }
}

function frameToChunk(frame: StellaFrame): CherryUIMessageChunk | null {
  switch (frame.type) {
    case 'text-start':
    case 'text-end':
    case 'reasoning-start':
    case 'reasoning-end':
      return typeof frame.id === 'string' ? ({ type: frame.type, id: frame.id } as CherryUIMessageChunk) : null
    case 'text-delta':
    case 'reasoning-delta':
      return typeof frame.id === 'string' && typeof frame.delta === 'string'
        ? ({ type: frame.type, id: frame.id, delta: frame.delta } as CherryUIMessageChunk)
        : null
    case 'tool-input-start':
      return toolInputFrame(frame, {})
    case 'tool-input-available':
      return toolInputFrame(frame, { input: frame.input ?? {} })
    case 'tool-output-available':
      return toolOutputFrame(frame, { output: frame.output ?? null })
    case 'tool-output-error':
      return toolOutputFrame(frame, {
        errorText: typeof frame.errorText === 'string' ? frame.errorText : 'Stella tool failed'
      })
    default:
      return null
  }
}

function toolInputFrame(frame: StellaFrame, payload: Record<string, unknown>): CherryUIMessageChunk | null {
  if (typeof frame.toolCallId !== 'string' || typeof frame.toolName !== 'string') return null
  return {
    type: frame.type,
    toolCallId: frame.toolCallId,
    toolName: frame.toolName,
    dynamic: true,
    providerExecuted: true,
    providerMetadata: { cherry: { transport: STELLA_TRANSPORT, tool: { type: 'remote', name: frame.toolName } } },
    ...payload
  } as CherryUIMessageChunk
}

function toolOutputFrame(frame: StellaFrame, payload: Record<string, unknown>): CherryUIMessageChunk | null {
  if (typeof frame.toolCallId !== 'string') return null
  // Stella output frames identify the existing call by id and deliberately omit toolName.
  return { type: frame.type, toolCallId: frame.toolCallId, ...payload } as CherryUIMessageChunk
}

async function* parseSse(body: ReadableStream<Uint8Array> | null): AsyncGenerator<string> {
  if (!body) throw new Error('Stella returned an empty stream')
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffered = ''
  try {
    while (true) {
      const { done, value } = await reader.read()
      buffered += decoder.decode(value, { stream: !done })
      let boundary: RegExpExecArray | null
      while ((boundary = /\r?\n\r?\n/.exec(buffered))) {
        const block = buffered.slice(0, boundary.index)
        buffered = buffered.slice(boundary.index + boundary[0].length)
        const data = block
          .split(/\r?\n/)
          .filter((line) => line.startsWith('data:'))
          .map((line) => line.slice(5).trimStart())
          .join('\n')
        if (data) yield data
      }
      if (done) break
    }
  } finally {
    reader.releaseLock()
  }
}
