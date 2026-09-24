import { createHash } from 'node:crypto'

import { application } from '@application'
import { agentService } from '@data/services/AgentService'
import { agentSessionMessageService } from '@data/services/AgentSessionMessageService'
import { agentSessionService } from '@data/services/AgentSessionService'
import { modelService } from '@data/services/ModelService'
import { providerService } from '@data/services/ProviderService'
import { resolveEffectiveEndpoint } from '@main/ai/provider/endpoint'
import { buildAgentUserContent } from '@main/ai/runtime/agentUserContent'
import { wrapSteerReminder } from '@main/ai/steerReminder'
import type { AgentSessionMessageEntity } from '@shared/data/api/schemas/agentSessionMessages'
import { ENDPOINT_TYPE, parseUniqueModelId } from '@shared/data/types/model'
import { getRawModelId } from '@shared/utils/model'

import { AsyncEventQueue } from '../AsyncEventQueue'
import type {
  AgentRuntimeConnectInput,
  AgentRuntimeConnection,
  AgentRuntimeEvent,
  AgentRuntimeReconcileResult,
  AgentRuntimeUserInput
} from '../types'

const HISTORY_PAGE_SIZE = 200
const HISTORY_LIMIT = 1_000

type UarHistoryMessage = { role: 'user' | 'assistant'; content: string }

type UarRunCredential = {
  provider_id: string
  provider_kind: 'openai_compatible' | 'anthropic'
  base_url: string
  api_key: string
}

type UarAgentArtifact = {
  version: string
  kind: 'agent'
  id: string
  metadata: { title: string; description: string; tags: string[] }
  runtime: { entry: string; protocols: Record<string, { enabled: boolean }> }
  policy: {
    provider: { default: { provider: string; model: string }; fallbacks: [] }
    tools: { allow: string[]; deny: string[]; max_concurrent: number; execution_mode: 'direct' }
    skills: { prefer: string[]; max_active: number }
  }
  schemas: { inputs: null; outputs: null; state: null }
  prompt: { system: string; instructions: string[] }
  memory: {
    conversation: { enabled: boolean }
    kb: { enabled: boolean; knowledge_bases: string[]; citation_required: boolean }
  }
  tools: { bundles: [] }
  ui: { forms: { enabled: boolean }; artifacts: { enabled: boolean; preferred_types: string[] } }
  extensions: Record<string, unknown>
}

type CreateRunResponse = { run_id?: unknown; stream_url?: unknown }

type AguiEvent = {
  type?: unknown
  messageId?: unknown
  delta?: unknown
  code?: unknown
  message?: unknown
}

export class UarRuntimeConnection implements AgentRuntimeConnection {
  private readonly eventQueue = new AsyncEventQueue<AgentRuntimeEvent>()
  private readonly principal: string
  private closed = false
  private runningTurn?: { runId: string; generation: number; abort: AbortController }
  private turnPromise: Promise<void> = Promise.resolve()
  private attachedGeneration?: number
  private resumeTokenEmitted = false
  private readonly initialSignature: string

  readonly events = this.eventQueue

  constructor(private readonly input: AgentRuntimeConnectInput) {
    this.principal = `boss.${createHash('sha256')
      .update(`${application.getPath('app.userdata')}\0${input.sessionId}`)
      .digest('hex')}`
    this.initialSignature = this.signature()
  }

  async start(): Promise<this> {
    await application.get('UarSidecarService').ensureReady()
    return this
  }

  async send(input: AgentRuntimeUserInput): Promise<void> {
    if (this.closed) throw new Error('UAR runtime connection is closed')
    const previous = this.turnPromise
    let admitted!: () => void
    const admittedPromise = new Promise<void>((resolve) => {
      admitted = resolve
    })
    this.turnPromise = previous.then(async () => {
      try {
        await this.runTurn(input, admitted)
      } catch (error) {
        admitted()
        if (!this.closed) this.eventQueue.push({ type: 'error', error })
      }
    })
    await admittedPromise
  }

  async reconcile(input: {
    modelId: AgentRuntimeConnectInput['modelId']
    reasoningEffort?: AgentRuntimeConnectInput['reasoningEffort']
  }): Promise<AgentRuntimeReconcileResult> {
    try {
      const current = this.signature(input.modelId, input.reasoningEffort)
      return current === this.initialSignature ? 'current' : 'rebuild'
    } catch {
      return 'invalid'
    }
  }

  async close(): Promise<void> {
    if (this.closed) return
    this.closed = true
    const running = this.runningTurn
    if (running) {
      await (
        application
          .get('UarSidecarService')
          .requestCurrent(
            `/api/uar/runs/${encodeURIComponent(running.runId)}/cancel`,
            this.principal,
            { method: 'POST' },
            running.generation
          ) ?? Promise.resolve()
      ).catch(() => undefined)
      running.abort.abort()
    }
    await this.turnPromise.catch(() => undefined)
    this.eventQueue.close()
  }

  private async runTurn(input: AgentRuntimeUserInput, admitted: () => void): Promise<void> {
    const sidecar = await application.get('UarSidecarService').ensureReady()
    const session = agentSessionService.getById(this.input.sessionId)
    const agent = agentService.getAgent(this.input.agentId)
    if (!agent || !agent.model) throw new Error(`UAR agent ${this.input.agentId} has no model configured`)
    const provider = this.resolveProvider(this.input.modelId)
    const coldSession = this.attachedGeneration !== sidecar.generation
    const body = {
      artifact: this.buildArtifact(agent, this.input.modelId, provider.credential),
      input: this.buildInput(input),
      session_id: this.input.sessionId,
      run_credentials: [provider.credential],
      working_directory: session.workspace.path,
      ...(this.mapReasoningEffort() ? { reasoning_effort: this.mapReasoningEffort() } : {}),
      ...(coldSession
        ? { history: { session_id: this.input.sessionId, messages: this.loadHistory(input.message.id) } }
        : {})
    }
    const response = await application.get('UarSidecarService').request(
      '/api/uar/runs',
      this.principal,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body)
      },
      sidecar.generation
    )
    if (!response.ok) {
      throw await this.responseError(response, 'UAR rejected the run', [
        provider.credential.api_key,
        provider.credential.base_url
      ])
    }
    const created = (await response.json()) as CreateRunResponse
    if (typeof created.run_id !== 'string' || typeof created.stream_url !== 'string') {
      throw new Error('UAR returned an invalid run response')
    }
    this.attachedGeneration = sidecar.generation
    if (!this.resumeTokenEmitted) {
      this.resumeTokenEmitted = true
      this.eventQueue.push({ type: 'resume-token', token: this.input.sessionId })
    }
    const abort = new AbortController()
    this.runningTurn = { runId: created.run_id, generation: sidecar.generation, abort }
    admitted()
    try {
      const stream = await application
        .get('UarSidecarService')
        .request(
          `${created.stream_url}?stream_mode=agui_spec`,
          this.principal,
          { signal: abort.signal },
          sidecar.generation
        )
      if (!stream.ok) {
        throw await this.responseError(stream, 'UAR stream failed', [
          provider.credential.api_key,
          provider.credential.base_url
        ])
      }
      await this.consumeStream(stream, created.run_id)
    } finally {
      if (this.runningTurn?.runId === created.run_id) this.runningTurn = undefined
    }
  }

  private buildInput(input: AgentRuntimeUserInput): string {
    const content = buildAgentUserContent(input.message)
    return input.systemReminder ? wrapSteerReminder(content) : content
  }

  private resolveProvider(uniqueModelId: AgentRuntimeConnectInput['modelId']): { credential: UarRunCredential } {
    const { providerId, modelId } = parseUniqueModelId(uniqueModelId)
    const provider = providerService.getByProviderId(providerId)
    const model = modelService.getByKey(providerId, modelId)
    const endpoint = resolveEffectiveEndpoint(provider, model)
    const providerKind =
      endpoint.endpointType === ENDPOINT_TYPE.ANTHROPIC_MESSAGES
        ? 'anthropic'
        : endpoint.endpointType === ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS ||
            endpoint.endpointType === ENDPOINT_TYPE.OPENAI_RESPONSES ||
            endpoint.endpointType === ENDPOINT_TYPE.OLLAMA_CHAT
          ? 'openai_compatible'
          : undefined
    if (!providerKind || !endpoint.baseUrl) {
      throw new Error(`Provider "${provider.name}" is not compatible with Universal Agent Runtime`)
    }
    const resolved = providerService.resolveApiKey(provider.id)
    const apiKey = resolved.value.trim() || (provider.authOptional ? 'no-key-required' : '')
    if (!apiKey) throw new Error(`Provider "${provider.name}" has no API key configured`)
    return {
      credential: {
        provider_id: provider.id,
        provider_kind: providerKind,
        base_url: endpoint.baseUrl,
        api_key: apiKey
      }
    }
  }

  private buildArtifact(
    agent: NonNullable<ReturnType<typeof agentService.getAgent>>,
    uniqueModelId: AgentRuntimeConnectInput['modelId'],
    credential: UarRunCredential
  ): UarAgentArtifact {
    const { providerId, modelId } = parseUniqueModelId(uniqueModelId)
    const model = modelService.getByKey(providerId, modelId)
    return {
      version: '1.0.0',
      kind: 'agent',
      id: agent.id,
      metadata: {
        title: agent.name,
        description: agent.description ?? '',
        tags: ['the-boss', 'uar']
      },
      runtime: { entry: 'default', protocols: {} },
      policy: {
        provider: {
          default: { provider: credential.provider_id, model: getRawModelId(model) },
          fallbacks: []
        },
        tools: { allow: [], deny: ['*'], max_concurrent: 1, execution_mode: 'direct' },
        skills: { prefer: [], max_active: 0 }
      },
      schemas: { inputs: null, outputs: null, state: null },
      prompt: {
        system: agent.instructions?.trim() || 'You are a helpful, accurate assistant.',
        instructions: []
      },
      memory: {
        conversation: { enabled: true },
        kb: { enabled: false, knowledge_bases: [], citation_required: false }
      },
      tools: { bundles: [] },
      ui: { forms: { enabled: false }, artifacts: { enabled: false, preferred_types: [] } },
      extensions: {}
    }
  }

  private loadHistory(excludeMessageId: string): UarHistoryMessage[] {
    const newestFirst: AgentSessionMessageEntity[] = []
    let cursor: string | undefined
    do {
      const page = agentSessionMessageService.listSessionMessages(this.input.sessionId, {
        cursor,
        limit: HISTORY_PAGE_SIZE
      })
      newestFirst.push(...page.items)
      cursor = page.nextCursor
    } while (cursor && newestFirst.length < HISTORY_LIMIT)

    return newestFirst
      .slice(0, HISTORY_LIMIT)
      .reverse()
      .filter((item) => item.id !== excludeMessageId && item.role !== 'system' && item.status !== 'pending')
      .map(
        (item): UarHistoryMessage => ({
          role: item.role === 'assistant' ? 'assistant' : 'user',
          content: this.messageText(item)
        })
      )
      .filter((item) => item.content.length > 0)
  }

  private messageText(message: AgentSessionMessageEntity): string {
    const text: string[] = []
    for (const part of message.data.parts ?? []) {
      if (part.type === 'text') text.push(part.text)
    }
    return text.join('\n').trim()
  }

  private mapReasoningEffort(): 'none' | 'low' | 'medium' | 'high' | 'max' | undefined {
    switch (this.input.reasoningEffort) {
      case 'none':
        return 'none'
      case 'minimal':
      case 'low':
        return 'low'
      case 'medium':
        return 'medium'
      case 'high':
        return 'high'
      case 'xhigh':
      case 'max':
      case 'ultra':
        return 'max'
      default:
        return undefined
    }
  }

  private async consumeStream(response: Response, runId: string): Promise<void> {
    if (!response.body) throw new Error('UAR stream returned no body')
    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    let textOpen = false
    let textId = `${runId}:assistant`
    let terminal = false
    const handleFrame = (frame: string) => {
      const data = frame
        .split('\n')
        .filter((line) => line.startsWith('data:'))
        .map((line) => line.slice(5).trimStart())
        .join('\n')
      if (!data) return
      const event = JSON.parse(data) as AguiEvent
      switch (event.type) {
        case 'TEXT_MESSAGE_CONTENT': {
          if (typeof event.delta !== 'string' || !event.delta) return
          const id = typeof event.messageId === 'string' ? event.messageId : `${runId}:assistant`
          if (!textOpen) {
            textOpen = true
            textId = id
            this.eventQueue.push({ type: 'chunk', chunk: { type: 'text-start', id } })
          }
          this.eventQueue.push({ type: 'chunk', chunk: { type: 'text-delta', id, delta: event.delta } })
          break
        }
        case 'RUN_FINISHED':
          terminal = true
          if (textOpen) this.eventQueue.push({ type: 'chunk', chunk: { type: 'text-end', id: textId } })
          this.eventQueue.push({ type: 'turn-complete' })
          break
        case 'RUN_ERROR':
          terminal = true
          this.eventQueue.push({
            type: 'error',
            error: new Error(
              typeof event.message === 'string' ? event.message : `UAR run failed (${String(event.code)})`
            )
          })
          break
      }
    }
    for (;;) {
      const { value, done } = await reader.read()
      buffer += decoder.decode(value, { stream: !done }).replaceAll('\r\n', '\n')
      let boundary: number
      while ((boundary = buffer.indexOf('\n\n')) >= 0) {
        const frame = buffer.slice(0, boundary)
        buffer = buffer.slice(boundary + 2)
        handleFrame(frame)
      }
      if (done) break
    }
    if (buffer.trim()) handleFrame(buffer)
    if (!terminal && !this.closed) throw new Error('UAR stream ended before a terminal event')
  }

  private signature(
    modelId: AgentRuntimeConnectInput['modelId'] = this.input.modelId,
    reasoningEffort: AgentRuntimeConnectInput['reasoningEffort'] = this.input.reasoningEffort
  ): string {
    const agent = agentService.getAgent(this.input.agentId)
    const session = agentSessionService.getById(this.input.sessionId)
    if (!agent?.model) throw new Error('UAR agent is unavailable')
    return JSON.stringify([agent.id, agent.updatedAt, modelId, reasoningEffort ?? 'default', session.workspace.path])
  }

  private async responseError(response: Response, prefix: string, secrets: readonly string[] = []): Promise<Error> {
    let detail = (await response.text()).slice(0, 1_000).trim()
    for (const secret of secrets) {
      if (secret) detail = detail.replaceAll(secret, '[REDACTED]')
    }
    return new Error(`${prefix} (HTTP ${response.status})${detail ? `: ${detail}` : ''}`)
  }
}
