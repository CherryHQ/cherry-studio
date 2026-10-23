import { stepCountIs, type ToolSet, type UIMessage, type UIMessageChunk } from 'ai'

import { application } from '@application'
import { agentService } from '@data/services/AgentService'
import { agentSessionService } from '@data/services/AgentSessionService'
import { modelService } from '@data/services/ModelService'
import { providerService } from '@data/services/ProviderService'
import { ensureAgentDataDirectory } from '@main/ai/agents/agentDataDirectory'
import { readAllConversationMessages } from '@main/ai/messages/readConversation'
import { resolveEffectiveEndpoint } from '@main/ai/provider/endpoint'
import { resolveSdkConfig } from '@main/ai/provider/sdkConfig'
import { buildAgentRuntimePrompt } from '@main/ai/runtime/agentPrompt'
import { buildAgentUserContent } from '@main/ai/runtime/agentUserContent'
import { Agent } from '@main/ai/runtime/aiSdk/Agent'
import { createPiToolAuthorizer, type PiToolAuthorizer } from '@main/ai/runtime/pi/approvalExtension'
import { PiStreamAdapter } from '@main/ai/runtime/pi/piStreamAdapter'
import type {
  AgentRuntimeConnectInput,
  AgentRuntimeConnection,
  AgentRuntimeEvent,
  AgentRuntimeReconcileResult,
  AgentRuntimeUserInput
} from '@main/ai/runtime/types'
import { wrapSteerReminder } from '@main/ai/steerReminder'
import { toolApprovalRegistry } from '@main/ai/toolApproval/ToolApprovalRegistry'
import { normalizePiDisabledToolId } from '@shared/ai/piBuiltinTools'
import type { AgentEntity } from '@shared/data/api/schemas/agents'
import { parseUniqueModelId } from '@shared/data/types/model'
import { AsyncEventQueue } from '@shared/utils/async'

import { createCodeTools } from './codeTools'
import { createFileTools, REPORT_ARTIFACTS_TOOL } from './fileTools'
import { isLocalFolderPath } from './localFolders'

/** Pi's own default: the turn ends when the model stops calling tools, so this only stops runaway loops. */
const MAX_STEPS = 100

type PiEvent = Parameters<PiStreamAdapter['handleEvent']>[0]

function basePrompt(workspacePath: string): string {
  const location = isLocalFolderPath(workspacePath)
    ? "a folder on the user's computer that they opened for you; your changes go to their real files"
    : "a folder in the browser's private storage"
  return `You are an agent running in Cherry Studio's Web edition. Your workspace is ${workspacePath}, ${location}; relative paths resolve against it.

Tools:
- read, write, edit: read, create and change files
- ls, find, grep: list folders, find files by name, search file contents

There is no shell and no network access from tools. Prefer editing files over describing changes.`
}

/** Pi's tool results carry the model-facing text in `content`; the rest is for the tool card. */
function withTextModelOutput(tools: ToolSet): ToolSet {
  return Object.fromEntries(
    Object.entries(tools).map(([name, tool]) => [
      name,
      {
        ...tool,
        toModelOutput: ({ output }: { output: unknown }) => {
          const content = (output as { content?: Array<{ text?: string }> } | undefined)?.content
          return { type: 'text', value: content?.map((block) => block.text ?? '').join('\n') ?? String(output) }
        }
      }
    ])
  ) as ToolSet
}

/**
 * One agent session's runtime in the browser: each turn runs the desktop AI SDK agent loop with the
 * browser file tools, approved through the desktop Pi policy, and streams Pi-shaped chunks so the
 * host stores and the renderer shows the turn as it does for the desktop's Pi.
 */
export class BrowserAgentConnection implements AgentRuntimeConnection {
  readonly events = new AsyncEventQueue<AgentRuntimeEvent>()
  private readonly adapter = new PiStreamAdapter({ enqueue: (chunk) => this.events.push({ type: 'chunk', chunk }) })
  /** Resolved once a tool's call has reached the host, so its approval card has a tool part to attach to. */
  private readonly forwardedToolCalls = new Map<string, PromiseWithResolvers<void>>()
  private turn?: AbortController
  private closed = false

  constructor(private readonly input: AgentRuntimeConnectInput) {}

  send(input: AgentRuntimeUserInput): void {
    const controller = new AbortController()
    this.turn = controller
    void this.runTurn(input, controller.signal).then(
      () => {
        if (!controller.signal.aborted) this.events.push({ type: 'turn-complete' })
      },
      (error) => {
        if (!controller.signal.aborted) this.events.push({ type: 'error', error })
      }
    )
  }

  /** The model, agent and session are read at each turn; only a different model needs a new connection. */
  async reconcile({ modelId }: { modelId: string }): Promise<AgentRuntimeReconcileResult> {
    if (!agentService.getAgent(this.input.agentId)) return 'invalid'
    return modelId === this.input.modelId ? 'current' : 'rebuild'
  }

  close(): void {
    if (this.closed) return
    this.closed = true
    this.turn?.abort()
    // Deny approvals still waiting for the user so their tool calls settle.
    toolApprovalRegistry.abort(this.input.sessionId, 'web-session-closed')
    this.events.close()
  }

  private async runTurn(input: AgentRuntimeUserInput, signal: AbortSignal): Promise<void> {
    const { sessionId, agentId } = this.input
    const session = agentSessionService.getById(sessionId)
    const agent = agentService.getAgent(agentId)
    if (!agent) throw new Error(`Agent ${agentId} no longer exists`)
    const workspacePath = session.workspace.path
    const agentDataPath = await ensureAgentDataDirectory(application.getPath('feature.agents.data'), agent.id)
    const prompt = await buildAgentRuntimePrompt({ workspacePath, agentDataPath, agent })
    const system = [prompt.base.kind === 'custom' ? prompt.base.content : basePrompt(workspacePath), prompt.append]
      .filter(Boolean)
      .join('\n\n')

    const { providerId, modelId } = parseUniqueModelId(this.input.modelId)
    const provider = providerService.getByProviderId(providerId)
    const model = modelService.getByKey(providerId, modelId)
    const { sdkConfig } = await resolveSdkConfig(provider, model, resolveEffectiveEndpoint(provider, model))
    const tools = this.authorizeTools(
      { ...createFileTools(workspacePath), ...createCodeTools() },
      agent,
      workspacePath,
      agentDataPath
    )

    const loop = new Agent({
      providerId: sdkConfig.providerId,
      providerSettings: sdkConfig.providerSettings,
      modelId: sdkConfig.modelId,
      errorContext: { providerId: provider.id, modelId: model.apiModelId ?? model.id },
      tools: withTextModelOutput(tools),
      system,
      options: { stopWhen: stepCountIs(MAX_STEPS) }
    })
    const reader = loop.stream(this.readHistory(input), signal).getReader()
    const textIndices = new Map<string, number>()
    const toolNames = new Map<string, string>()
    this.adapter.handleEvent({ type: 'agent_start' })
    while (true) {
      const { done, value } = await reader.read()
      if (done || signal.aborted) break
      this.forward(value, textIndices, toolNames)
    }
  }

  /** The session's stored turns, then this turn's message as the runtimes receive it. */
  private readHistory(input: AgentRuntimeUserInput): UIMessage[] {
    const stored = readAllConversationMessages({ sessionId: this.input.sessionId }).messages
    const end = stored.findIndex((message) => message.id === input.message.id)
    const history = (end < 0 ? stored : stored.slice(0, end))
      .filter((message) => message.role !== 'system' && (message.status === 'success' || message.status === 'paused'))
      .map((message) => ({ id: message.id, role: message.role, parts: message.data.parts ?? [] }) as UIMessage)
    const text = buildAgentUserContent(input.message)
    return [
      ...history,
      {
        id: input.message.id,
        role: 'user',
        parts: [{ type: 'text', text: input.systemReminder ? wrapSteerReminder(text) : text }]
      }
    ]
  }

  /** Disabled tools are left out; every call waits for the desktop Pi policy before it runs. */
  private authorizeTools(tools: ToolSet, agent: AgentEntity, workspacePath: string, agentDataPath: string): ToolSet {
    const disabled = new Set((agent.disabledTools ?? []).map(normalizePiDisabledToolId))
    // Pi applies a permission-mode change at the next turn boundary.
    const permissionMode = agent.configuration?.permission_mode ?? 'default'
    const authorize: PiToolAuthorizer = createPiToolAuthorizer({
      sessionId: this.input.sessionId,
      workspacePath,
      agentDataPath,
      additionalReadOnlyRoots: [],
      emit: (event) => this.events.push(event),
      getInteractionState: () =>
        application.get('AgentSessionRuntimeService').getInteractionState(this.input.sessionId),
      getPermissionMode: () => permissionMode,
      isDisabled: (name) => disabled.has(name),
      autoApprovedTools: new Set([REPORT_ARTIFACTS_TOOL]),
      approvalRequiredTools: new Set(),
      nonBypassableApprovalTools: new Set(),
      delegationTools: new Set()
    })
    return Object.fromEntries(
      Object.entries(tools)
        .filter(([name]) => !disabled.has(name))
        .map(([name, tool]) => [
          name,
          {
            ...tool,
            execute: async (input: unknown, options: Parameters<NonNullable<typeof tool.execute>>[1]) => {
              await this.toolCallForwarded(options.toolCallId).promise
              this.forwardedToolCalls.delete(options.toolCallId)
              const blocked = await authorize({
                toolName: name,
                toolCallId: options.toolCallId,
                input: input as Record<string, unknown>,
                signal: options.abortSignal
              })
              if (blocked) throw new Error(blocked.reason)
              return tool.execute!(input, options)
            }
          }
        ])
    )
  }

  private toolCallForwarded(toolCallId: string): PromiseWithResolvers<void> {
    let forwarded = this.forwardedToolCalls.get(toolCallId)
    if (!forwarded) {
      forwarded = Promise.withResolvers<void>()
      this.forwardedToolCalls.set(toolCallId, forwarded)
    }
    return forwarded
  }

  /** Replays the loop's chunks as the Pi events they correspond to, so `PiStreamAdapter` shapes them. */
  private forward(chunk: UIMessageChunk, textIndices: Map<string, number>, toolNames: Map<string, string>): void {
    const contentIndex = (id: string) => {
      if (!textIndices.has(id)) textIndices.set(id, textIndices.size)
      return textIndices.get(id)!
    }
    const update = (assistantMessageEvent: Record<string, unknown>) =>
      this.adapter.handleEvent({ type: 'message_update', assistantMessageEvent } as unknown as PiEvent)
    const toolEnd = (toolCallId: string, result: unknown, isError: boolean) =>
      this.adapter.handleEvent({
        type: 'tool_execution_end',
        toolCallId,
        toolName: toolNames.get(toolCallId) ?? '',
        result,
        isError
      })

    switch (chunk.type) {
      case 'start-step':
        textIndices.clear()
        this.adapter.handleEvent({ type: 'message_start', message: { role: 'assistant' } } as PiEvent)
        return
      case 'text-start':
      case 'text-end':
        update({ type: chunk.type === 'text-start' ? 'text_start' : 'text_end', contentIndex: contentIndex(chunk.id) })
        return
      case 'text-delta':
        update({ type: 'text_delta', contentIndex: contentIndex(chunk.id), delta: chunk.delta })
        return
      case 'reasoning-start':
      case 'reasoning-end':
        update({
          type: chunk.type === 'reasoning-start' ? 'thinking_start' : 'thinking_end',
          contentIndex: contentIndex(chunk.id)
        })
        return
      case 'reasoning-delta':
        update({ type: 'thinking_delta', contentIndex: contentIndex(chunk.id), delta: chunk.delta })
        return
      case 'tool-input-available':
        toolNames.set(chunk.toolCallId, chunk.toolName)
        this.adapter.handleEvent({
          type: 'tool_execution_start',
          toolCallId: chunk.toolCallId,
          toolName: chunk.toolName,
          args: chunk.input
        })
        this.toolCallForwarded(chunk.toolCallId).resolve()
        return
      case 'tool-input-error':
        toolNames.set(chunk.toolCallId, chunk.toolName)
        toolEnd(chunk.toolCallId, chunk.errorText, true)
        return
      case 'tool-output-available':
        toolEnd(chunk.toolCallId, chunk.output, false)
        return
      case 'tool-output-error':
        toolEnd(chunk.toolCallId, chunk.errorText, true)
        return
      case 'message-metadata':
        this.events.push({ type: 'chunk', chunk })
        return
      default:
        // Message and step boundaries belong to the host; Pi streams none either.
        return
    }
  }
}
