import { createHash } from 'node:crypto'

import { application } from '@application'
import { agentService } from '@data/services/AgentService'
import { agentSessionMessageService } from '@data/services/AgentSessionMessageService'
import { agentSessionService } from '@data/services/AgentSessionService'
import { mcpServerService } from '@data/services/McpServerService'
import { modelService } from '@data/services/ModelService'
import { providerService } from '@data/services/ProviderService'
import { ensureAgentDataDirectory } from '@main/ai/agents/agentDataDirectory'
import { resolveMountedMcpServers } from '@main/ai/agents/builtin/builtinAgentCapabilities'
import { resolveEffectiveEndpoint } from '@main/ai/provider/endpoint'
import {
  buildAgentMcpServers,
  resolveLinkedNotifyChannel,
  type McpServerSnapshotMap
} from '@main/ai/runtime/agentMcpServers'
import { buildAgentUserContent } from '@main/ai/runtime/agentUserContent'
import { warmMcpToolCatalogs } from '@main/ai/runtime/pi/piMcpToolAdapter'
import { skillService } from '@main/ai/skills/SkillService'
import { wrapSteerReminder } from '@main/ai/steerReminder'
import { toolApprovalRegistry } from '@main/ai/toolApproval/ToolApprovalRegistry'
import { createAiUsagePricingSnapshot } from '@main/ai/utils/usageCapture'
import type { AgentEntity } from '@shared/data/api/schemas/agents'
import type { AgentSessionMessageEntity } from '@shared/data/api/schemas/agentSessionMessages'
import type { AgentSessionEntity } from '@shared/data/api/schemas/agentSessions'
import { ENDPOINT_TYPE, parseUniqueModelId } from '@shared/data/types/model'
import { getRawModelId } from '@shared/utils/model'

import { AsyncEventQueue } from '../AsyncEventQueue'
import type {
  AgentRuntimeConnectInput,
  AgentRuntimeConnection,
  AgentRuntimeEvent,
  AgentRuntimeReconcileResult,
  AgentRuntimeUserInput,
  AgentSessionUsageCapture
} from '../types'
import { UarAguiAdapter } from './UarAguiAdapter'
import { buildUarHostHistory, type UarHistoryMessage } from './uarHostHistory'
import { createUarHostMcpBridge, type UarHostMcpBridge, type UarRunMcpServer } from './UarHostMcpBridge'
import { toUarToolName } from './uarToolNames'

const HISTORY_PAGE_SIZE = 200
const HISTORY_LIMIT = 1_000

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

export class UarRuntimeConnection implements AgentRuntimeConnection {
  private readonly eventQueue = new AsyncEventQueue<AgentRuntimeEvent>()
  private readonly principal: string
  private closed = false
  private runningTurn?: { runId: string; generation: number; abort: AbortController }
  private turnPromise: Promise<void> = Promise.resolve()
  private attachedGeneration?: number
  private resumeTokenEmitted = false
  private initialSignature = ''
  private _usageCapture?: AgentSessionUsageCapture

  readonly events = this.eventQueue

  get usageCapture(): AgentSessionUsageCapture | undefined {
    return this._usageCapture
  }

  constructor(private readonly input: AgentRuntimeConnectInput) {
    this.principal = `boss.${createHash('sha256')
      .update(`${application.getPath('app.userdata')}\0${input.sessionId}`)
      .digest('hex')}`
  }

  async start(): Promise<this> {
    await application.get('UarSidecarService').ensureReady()
    this._usageCapture = this.resolveProvider(this.input.modelId).usageCapture
    this.initialSignature = await this.signature()
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
      const current = await this.signature(input.modelId, input.reasoningEffort)
      return current === this.initialSignature ? 'current' : 'rebuild'
    } catch {
      return 'invalid'
    }
  }

  async close(): Promise<void> {
    if (this.closed) return
    this.closed = true
    toolApprovalRegistry.abort(this.input.sessionId, 'UAR session closed')
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
    const storedAgent = agentService.getAgent(this.input.agentId)
    if (!storedAgent || !storedAgent.model) {
      throw new Error(`UAR agent ${this.input.agentId} has no model configured`)
    }
    const { agent } = await application.get('PrometheusIntegrationService').resolveSession(session, storedAgent)
    const provider = this.resolveProvider(this.input.modelId)
    const coldSession = this.attachedGeneration !== sidecar.generation
    const [bridge, skillIds] = await Promise.all([this.createMcpBridge(session, agent), this.resolveSkillIds(agent.id)])
    try {
      const body = {
        artifact: this.buildArtifact(agent, this.input.modelId, provider.credential, bridge.servers, skillIds),
        input: this.buildInput(input),
        session_id: this.input.sessionId,
        run_credentials: [provider.credential],
        working_directory: session.workspace.path,
        ...(bridge.servers.length > 0 ? { mcp_servers: bridge.servers } : {}),
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
      const secrets = [provider.credential.api_key, provider.credential.base_url, ...bridge.redactions]
      if (!response.ok) throw await this.responseError(response, 'UAR rejected the run', secrets)
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
        const adapter = new UarAguiAdapter({
          sessionId: this.input.sessionId,
          agentId: this.input.agentId,
          runId: created.run_id,
          generation: sidecar.generation,
          principal: this.principal,
          signal: abort.signal,
          bridge,
          emit: (event) => this.eventQueue.push(event),
          isClosed: () => this.closed
        })
        let streamError: unknown = new Error('UAR stream ended before a terminal event')
        for (let attempt = 0; attempt < 2 && !adapter.isTerminal(); attempt += 1) {
          const replayCursor = adapter.replayCursor()
          if (attempt > 0) adapter.prepareReconnect()
          try {
            const stream = await application.get('UarSidecarService').request(
              `${created.stream_url}?stream_mode=agui_spec`,
              this.principal,
              {
                signal: abort.signal,
                headers: { 'last-event-id': attempt > 0 ? replayCursor : '0' }
              },
              sidecar.generation
            )
            if (!stream.ok) throw await this.responseError(stream, 'UAR stream failed', secrets)
            await adapter.consume(stream)
            streamError = new Error('UAR stream ended before a terminal event')
          } catch (error) {
            streamError = error
          }
          if (adapter.isTerminal()) break
          if (this.closed || abort.signal.aborted) throw streamError
        }
        if (!adapter.isTerminal()) {
          adapter.interrupt(streamError)
          throw streamError
        }
      } finally {
        if (this.runningTurn?.runId === created.run_id) this.runningTurn = undefined
      }
    } finally {
      await bridge.close()
    }
  }

  private async createMcpBridge(session: AgentSessionEntity, agent: AgentEntity): Promise<UarHostMcpBridge> {
    await warmMcpToolCatalogs(agent.mcps ?? [])
    const snapshots: McpServerSnapshotMap = new Map(
      (agent.mcps ?? []).map((idOrName) => [idOrName, mcpServerService.findByIdOrName(idOrName)] as const)
    )
    const linkedChannel = resolveLinkedNotifyChannel(session.id, agent.id)
    const mountedServers = resolveMountedMcpServers(agent, {
      browserEnabled: application.get('PreferenceService').get('app.browser.agent_control.enabled'),
      channelLinked: linkedChannel !== null
    })
    const agentDataPath = await ensureAgentDataDirectory(application.getPath('feature.agents.data'), agent.id)
    return createUarHostMcpBridge(
      buildAgentMcpServers(
        session,
        agent,
        mountedServers,
        snapshots,
        linkedChannel,
        agentDataPath,
        this.input.knowledgeBaseIds
      )
    )
  }

  private buildInput(input: AgentRuntimeUserInput): string {
    const content = buildAgentUserContent(input.message)
    return input.systemReminder ? wrapSteerReminder(content) : content
  }

  private resolveProvider(uniqueModelId: AgentRuntimeConnectInput['modelId']): {
    credential: UarRunCredential
    usageCapture: AgentSessionUsageCapture
  } {
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
      },
      usageCapture: {
        owner: 'agent-sdk',
        credentialReceipt: resolved.apiKeySelection,
        providerId: provider.id,
        providerName: provider.name ?? null,
        source: null,
        frozenModels: [
          {
            modelId: model.id,
            apiModelId: getRawModelId(model),
            modelName: model.name ?? model.id,
            aliases: [...new Set([model.id, getRawModelId(model)])],
            pricingSnapshot: createAiUsagePricingSnapshot(model.pricing)
          }
        ]
      }
    }
  }

  private buildArtifact(
    agent: NonNullable<ReturnType<typeof agentService.getAgent>>,
    uniqueModelId: AgentRuntimeConnectInput['modelId'],
    credential: UarRunCredential,
    mcpServers: readonly UarRunMcpServer[],
    skillIds: readonly string[]
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
        tools: {
          allow: ['*'],
          deny: (agent.disabledTools ?? []).map(toUarToolName),
          max_concurrent: 1,
          execution_mode: 'direct'
        },
        skills: { prefer: [...skillIds], max_active: 3 }
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
      extensions: {
        ...(mcpServers.length > 0
          ? {
              mcp_servers: {
                servers: mcpServers.map((server) => ({
                  id: server.name,
                  url: server.url,
                  transport: 'streamable_http',
                  tools: [],
                  env: {}
                }))
              }
            }
          : {}),
        'uar.run_policy': {
          version: 1,
          tools: {
            mode: agent.configuration?.permission_mode === 'plan' ? 'none' : 'all',
            ids: [],
            denied_ids: (agent.disabledTools ?? []).map(toUarToolName)
          },
          mcp_servers: {
            mode: mcpServers.length > 0 ? 'selected' : 'none',
            ids: mcpServers.map((server) => server.name),
            denied_ids: []
          },
          tool_approval: agent.configuration?.permission_mode === 'plan' ? 'deny' : 'ask'
        }
      }
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

    const chronological = newestFirst.slice(0, HISTORY_LIMIT).reverse()
    return buildUarHostHistory(chronological, excludeMessageId)
  }

  private async resolveSkillIds(agentId: string): Promise<string[]> {
    const skills = await skillService.list({ agentId })
    return skills
      .filter((skill) => skill.isEnabled && skill.source === 'builtin')
      .map((skill) => `builtin::${skill.name}`)
      .sort()
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

  private async signature(
    modelId: AgentRuntimeConnectInput['modelId'] = this.input.modelId,
    reasoningEffort: AgentRuntimeConnectInput['reasoningEffort'] = this.input.reasoningEffort
  ): Promise<string> {
    const storedAgent = agentService.getAgent(this.input.agentId)
    const session = agentSessionService.getById(this.input.sessionId)
    if (!storedAgent?.model) throw new Error('UAR agent is unavailable')
    const { agent } = await application.get('PrometheusIntegrationService').resolveSession(session, storedAgent)
    const linkedChannel = resolveLinkedNotifyChannel(session.id, agent.id)
    const mcpServers = (agent.mcps ?? []).map((idOrName) => mcpServerService.findByIdOrName(idOrName) ?? idOrName)
    const skillIds = await this.resolveSkillIds(agent.id)
    return createHash('sha256')
      .update(
        JSON.stringify([
          agent.id,
          agent.updatedAt,
          agent.configuration?.permission_mode,
          [...(agent.disabledTools ?? [])].sort(),
          modelId,
          reasoningEffort ?? 'default',
          session.workspace,
          mcpServers,
          skillIds,
          linkedChannel,
          application.get('PreferenceService').get('app.browser.agent_control.enabled'),
          [...(this.input.knowledgeBaseIds ?? [])].sort()
        ])
      )
      .digest('hex')
  }

  private async responseError(response: Response, prefix: string, secrets: readonly string[] = []): Promise<Error> {
    let detail = (await response.text()).slice(0, 1_000).trim()
    for (const secret of secrets) {
      if (secret) detail = detail.replaceAll(secret, '[REDACTED]')
    }
    return new Error(`${prefix} (HTTP ${response.status})${detail ? `: ${detail}` : ''}`)
  }
}
