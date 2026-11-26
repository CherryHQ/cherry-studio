import { randomUUID } from 'node:crypto'

import type { Options } from '@anthropic-ai/claude-agent-sdk'

import {
  localClaudeOptions,
  probeClaudeModels,
  type ClaudeControl,
  type ClaudeObservation
} from '@cherrystudio/agent-runtime-claude-code'
import { CLAUDE_PERMISSION_MODES } from '@cherrystudio/agent-runtime-claude-code/cli'
import { selectedPermissionMode } from '@cherrystudio/agent-runtime/cli'
import { agentService } from '@data/services/AgentService'
import { toolApprovalRegistry, type DispatchDecision } from '@main/ai/toolApproval/ToolApprovalRegistry'
import type { AgentSessionSlashCommand } from '@shared/ai/agentSessionSlashCommands'
import {
  CLAUDE_LOCAL_THOUGHT_LEVEL_ID,
  CLAUDE_LOCAL_THOUGHT_LEVEL_OPTIONS,
  getDefaultLocalAgentThoughtLevel,
  type LocalAgentConfiguration,
  type LocalAgentSessionInfo
} from '@shared/ai/localAgent'
import { LocalAgentTurnUsageSchema } from '@shared/ai/localAgentUsage'

import {
  acquireLocalAgentBrowserLease,
  isHostBrowserControlAllowed,
  LOCAL_AGENT_AUTOMATION_SERVER_NAME
} from '../../mcp/localAgentBrowserBridge'
import type { LocalAgentBrowserLease } from '../../mcp/LocalAgentMcpBridgeService'
import { resolveLocalModelContextWindow } from '../modelContextWindow'
import type {
  AgentRuntimeCommand,
  AgentRuntimeConnectInput,
  AgentRuntimeEvent,
  AgentRuntimeReconcileResult
} from '../types'
import { createClaudeCodeProcessDiagnostics, createSpawnClaudeCodeProcess } from './ClaudeCodeProcessManager'
import { prepareClaudeBranch } from './claudeContext'
import { ClaudeSdkConnection } from './ClaudeSdkConnection'
import { resolveClaudeLaunch } from './localClaudeLaunch'

const CLAUDE_DEFAULT_COMMANDS: AgentSessionSlashCommand[] = [
  { name: 'clear', description: 'Start a new conversation with empty context', argumentHint: '', builtin: true },
  {
    name: 'compact',
    description: 'Free up context by summarizing the conversation so far',
    argumentHint: '',
    builtin: true
  },
  {
    name: 'context',
    description: 'Visualize current context usage as a colored grid',
    argumentHint: '',
    builtin: true
  },
  {
    name: 'usage',
    description: 'Show session cost, plan usage limits, and activity stats',
    argumentHint: '',
    builtin: true
  },
  {
    name: 'goal',
    description: 'Set a goal to work toward until it is completed',
    argumentHint: '<goal>',
    builtin: true
  }
]

const UNSUPPORTED_CLAUDE_SLASH_COMMANDS = new Set([
  '__remote-workflow',
  'workflow-launch-exec',
  'auto-mode-setup',
  'color',
  'design-consent',
  'design-revoke',
  'effort',
  'fast',
  'focus',
  'heapdump',
  'ultraplan',
  'voice'
])

// Newer local CLIs report title changes ahead of the bundled SDK's message union.
function localSessionTitle(message: { subtype: string }): string | undefined {
  if (message.subtype === 'session_title_changed' && 'title' in message && typeof message.title === 'string')
    return message.title
  return undefined
}

export async function probeLocalClaude(config: LocalAgentConfiguration, cwd: string, abort: AbortController) {
  const launch = await resolveClaudeLaunch(config, cwd, abort.signal, 'models')
  const diagnostics = createClaudeCodeProcessDiagnostics()
  const models = await probeClaudeModels(
    launch,
    abort,
    createSpawnClaudeCodeProcess(diagnostics),
    () => diagnostics.exited
  )
  return { models }
}

export class LocalClaudeConnection extends ClaudeSdkConnection {
  readonly sessionCostScope = 'native-session' as const
  readonly localSessionInfo: LocalAgentSessionInfo = {
    models: [],
    images: true,
    resume: true,
    mode: { ...CLAUDE_PERMISSION_MODES, options: [...CLAUDE_PERMISSION_MODES.options] },
    thoughtLevel: getDefaultLocalAgentThoughtLevel('claude')
  }
  get effectivePermissionMode() {
    return this.permissionModeSource ? selectedPermissionMode(this.localSessionInfo.mode) : undefined
  }
  private browserLease?: LocalAgentBrowserLease
  private readonly sessionAllowedTools = new Set<string>()
  private unattendedDenial = false
  private permissionModeSource?: 'native' | 'selection'

  constructor(
    input: AgentRuntimeConnectInput,
    private readonly config: LocalAgentConfiguration
  ) {
    super(input, 'claude')
  }

  protected override prepareContext(_env: Options['env'], nativeId?: string, anchor?: string) {
    return prepareClaudeBranch(this.input.sessionId, { agentId: this.input.agentId }, nativeId, anchor)
  }

  async start(cwd: string): Promise<this> {
    const { sessionId, agentId, headless = false, branchHead } = this.input
    const { signal } = this.abortController
    const launch = await resolveClaudeLaunch(this.config, cwd, signal, headless ? 'scheduled-chat' : 'chat')
    signal.throwIfAborted()
    this.browserLease = await acquireLocalAgentBrowserLease({
      sessionId,
      agentId,
      config: this.config,
      headless,
      signal,
      isReadOnly: () => this.effectivePermissionMode === 'plan'
    })
    signal.throwIfAborted()
    this.processDiagnostics = createClaudeCodeProcessDiagnostics()
    const model = this.config.nativeModel ?? (headless ? launch.nativeModel : undefined)
    const options: Options = {
      ...localClaudeOptions(launch, this.abortController, createSpawnClaudeCodeProcess(this.processDiagnostics)),
      model,
      settingSources: headless ? [] : ['user', 'project', 'local'],
      ...(headless
        ? { permissionMode: 'dontAsk', tools: ['Read', 'Glob', 'Grep'], strictMcpConfig: true }
        : { allowDangerouslySkipPermissions: true }),
      ...(this.browserLease && {
        mcpServers: {
          [LOCAL_AGENT_AUTOMATION_SERVER_NAME]: {
            type: 'http',
            url: this.browserLease.url,
            headers: { ...this.browserLease.headers }
          }
        }
      }),
      canUseTool: async (name, input, options) => {
        if (this.input.headless) {
          this.unattendedDenial = true
          return { behavior: 'deny', message: 'Scheduled tasks cannot request approval or user input' }
        }
        if (
          this.browserLease &&
          (name === `mcp__${LOCAL_AGENT_AUTOMATION_SERVER_NAME}__js` ||
            name === `mcp__${LOCAL_AGENT_AUTOMATION_SERVER_NAME}__reset`)
        ) {
          return isHostBrowserControlAllowed(this.config)
            ? { behavior: 'allow' as const, updatedInput: input }
            : { behavior: 'deny' as const, message: 'Built-in browser control is disabled' }
        }
        if (name === 'AskUserQuestion') {
          const answer = await this.approve(options.toolUseID, name, input, options.signal)
          return answer.approved
            ? { behavior: 'allow' as const, updatedInput: answer.updatedInput ?? input }
            : { behavior: 'deny' as const, message: answer.reason ?? 'Denied by user' }
        }

        const effectiveMode = this.effectivePermissionMode
        if (effectiveMode === 'bypassPermissions' || this.sessionAllowedTools.has(name)) {
          return { behavior: 'allow' as const, updatedInput: input }
        }

        const answer = await this.approve(
          options.toolUseID,
          name,
          {
            ...input,
            localPermissionOptions: [
              { optionId: 'allow', decision: 'accept' as const, label: 'allow' as const, name: 'Allow' },
              {
                optionId: 'allow_session',
                decision: 'acceptForSession' as const,
                label: 'allow_session' as const,
                name: 'Allow for session'
              },
              { optionId: 'deny', decision: 'decline' as const, label: 'deny' as const, name: 'Deny' }
            ]
          },
          options.signal
        )
        if (!answer.approved) {
          return { behavior: 'deny' as const, message: answer.reason ?? 'Denied by user' }
        }
        if (answer.updatedInput?.localPermissionOption === 'allow_session') {
          this.sessionAllowedTools.add(name)
          const updatedPermissions = options.suggestions?.map((rule) => ({
            ...rule,
            destination: 'session' as const
          }))
          return {
            behavior: 'allow' as const,
            updatedInput: input,
            ...(updatedPermissions?.length ? { updatedPermissions } : {})
          }
        }
        return { behavior: 'allow' as const, updatedInput: input }
      }
    }
    if (this.config.sourceModelViaGateway && model) {
      options.settings = {
        env: {
          ANTHROPIC_DEFAULT_FABLE_MODEL: model,
          ANTHROPIC_DEFAULT_OPUS_MODEL: model,
          ANTHROPIC_DEFAULT_SONNET_MODEL: model,
          ANTHROPIC_DEFAULT_HAIKU_MODEL: model,
          CLAUDE_CODE_SUBAGENT_MODEL: model,
          CLAUDE_CODE_WORKFLOW_SUBAGENT_MODEL: model,
          CLAUDE_CODE_AUTO_MODE_MODEL: model
        }
      }
    }
    const traceEnv = await this.prepareTraceEnv()
    options.env = { ...options.env, ...traceEnv, CLAUDE_CODE_EMIT_SESSION_STATE_EVENTS: '1' }
    const context = this.prepareContext(options.env, this.resumeToken, branchHead)
    if (this.resumeToken || context.bindingState === 'bound')
      options.resume = this.resumeToken ?? context.nativeThreadId ?? undefined
    else options.sessionId = context.nativeThreadId ?? undefined
    const initialModel = model ?? this.localSessionInfo.activeModel?.id
    const initialWindow = resolveLocalModelContextWindow(initialModel)
    await this.startSdk(
      options,
      context,
      initialModel && initialWindow ? { model: initialModel, tokens: initialWindow } : undefined
    )
    const models = await this.handle!.claude.supportedModels()
    if (models.status === 'confirmed')
      this.localSessionInfo.models = models.value.map((m) => ({ id: m.value, name: m.displayName }))
    return this
  }

  override send(input: AgentRuntimeCommand) {
    this.unattendedDenial = false
    return super.send(input)
  }

  protected override commandAllowed(command: AgentSessionSlashCommand) {
    return !UNSUPPORTED_CLAUDE_SLASH_COMMANDS.has(command.name)
  }

  override async getSupportedCommands() {
    const commands = await super.getSupportedCommands()
    return commands?.length ? commands : CLAUDE_DEFAULT_COMMANDS
  }

  private approve(
    toolCallId: string,
    toolName: string,
    input: Record<string, unknown>,
    signal: AbortSignal
  ): Promise<DispatchDecision> {
    const approvalId = randomUUID()
    return new Promise((resolve) => {
      if (
        toolApprovalRegistry.register({
          sessionId: this.input.sessionId,
          approvalId,
          toolCallId,
          toolName,
          originalInput: input,
          signal: AbortSignal.any([signal, this.abortController.signal]),
          resolve
        })
      ) {
        this.eventQueue.push({
          type: 'tool-input-available',
          toolCallId,
          toolName,
          input,
          providerExecuted: true,
          dynamic: true
        })
        this.eventQueue.push({
          type: 'tool-approval-request',
          request: { approvalId, toolCallId, toolName, input, presentation: 'stream' }
        })
      }
    })
  }

  async setMode(configId: string, value: string) {
    if (this.input.headless) throw new Error('Scheduled tasks use the agent configuration')
    const selected = CLAUDE_PERMISSION_MODES.options.find((option) => option.value === value)
    if (configId !== CLAUDE_PERMISSION_MODES.id || !selected)
      throw new Error('This session option is no longer available')
    if (!this.handle || this.closing || this.handle.claude.state().active)
      throw new Error('Claude session is unavailable or busy')
    const result = await this.handle.claude.setPermissionMode(selected.value)
    if (result.status !== 'confirmed') throw new Error(result.error.message)
    this.permissionModeSource = 'selection'
    this.updateSessionInfo({ mode: { ...this.localSessionInfo.mode!, currentValue: selected.value } })
    return this.localSessionInfo
  }

  async setThoughtLevel(configId: string, value: string) {
    const selected = CLAUDE_LOCAL_THOUGHT_LEVEL_OPTIONS.find((option) => option.value === value)
    if (configId !== CLAUDE_LOCAL_THOUGHT_LEVEL_ID || !selected)
      throw new Error('This session option is no longer available')
    if (!this.handle || this.closing || this.handle.claude.state().active)
      throw new Error('Claude session is unavailable or busy')
    const result = await this.handle.claude.setEffort(selected.value === 'default' ? null : selected.value)
    if (result.status !== 'confirmed') throw new Error(result.error.message)
    this.updateSessionInfo({ thoughtLevel: { ...this.localSessionInfo.thoughtLevel!, currentValue: selected.value } })
    return this.localSessionInfo
  }

  private updateSessionInfo(patch: Partial<LocalAgentSessionInfo>) {
    Object.assign(this.localSessionInfo, patch)
    this.eventQueue.push({ type: 'local-session-info', info: { ...this.localSessionInfo } })
  }

  protected override acceptNative(batch: ClaudeObservation) {
    for (const item of batch.native) {
      if (item.source !== 'live') continue
      const message = item.message
      if (this.permissionModeSource !== 'selection' && message.type === 'system' && message.subtype === 'init') {
        const value = CLAUDE_PERMISSION_MODES.options.find((option) => option.value === message.permissionMode)?.value
        this.permissionModeSource = value && !this.input.headless ? 'native' : undefined
        const mode = this.localSessionInfo.mode
        if (mode && value && value !== mode.currentValue)
          this.updateSessionInfo({ mode: { ...mode, currentValue: value } })
      }
      if (
        message.type === 'assistant' &&
        !message.parent_tool_use_id &&
        message.message.model &&
        message.message.model !== '<synthetic>' &&
        message.message.model !== this.localSessionInfo.activeModel?.id
      ) {
        this.updateSessionInfo({ activeModel: { id: message.message.model } })
      }
      if (message.type === 'system' && message.subtype === 'local_command_output' && message.content.trim())
        this.eventQueue.push({ type: 'notice', notice: { severity: 'info', title: message.content } })
      if (message.type === 'system') {
        const title = localSessionTitle(message)
        if (title !== undefined) this.eventQueue.push({ type: 'session-title', title })
      }
      if (
        message.type === 'result' &&
        !('local_command' in message && message.local_command) &&
        'usage' in message &&
        message.usage
      ) {
        const noCacheTokens = message.usage.input_tokens ?? 0
        const cacheReadTokens = message.usage.cache_read_input_tokens ?? 0
        const cacheWriteTokens = message.usage.cache_creation_input_tokens ?? 0
        const inputTokens = noCacheTokens + cacheReadTokens + cacheWriteTokens
        const outputTokens = message.usage.output_tokens ?? 0
        const model = this.localSessionInfo.activeModel?.id ?? this.config.nativeModel ?? null
        const summary = LocalAgentTurnUsageSchema.safeParse({
          nativeSessionId: message.session_id,
          model,
          reportedAt: Date.now(),
          correlation: 'unknown',
          usage: {
            inputTokens,
            outputTokens,
            totalTokens: inputTokens + outputTokens,
            noCacheTokens,
            cacheReadTokens,
            cacheWriteTokens
          }
        })
        if (summary.success) this.eventQueue.push({ type: 'local-turn-usage', summary: summary.data })
        const modelUsageMap =
          'modelUsage' in message && message.modelUsage && typeof message.modelUsage === 'object'
            ? (message.modelUsage as Record<string, { contextWindow?: number } | undefined>)
            : undefined
        const matchedUsage =
          (model ? modelUsageMap?.[model] : undefined) ??
          Object.values(modelUsageMap ?? {}).find((u) => (u?.contextWindow ?? 0) > 0)
        const contextWindow = resolveLocalModelContextWindow(model, matchedUsage?.contextWindow)
        if (contextWindow && inputTokens > 0) {
          this.eventQueue.push({
            type: 'context-usage',
            result: {
              status: 'confirmed',
              value: {
                model: model ?? '',
                revision: `${message.session_id}:${message.uuid}`,
                contextWindow,
                basis: 'last-request',
                used: { tokens: inputTokens, precision: 'reported' }
              }
            }
          })
        }
      }
    }
  }

  protected override completedTurn(control: Extract<ClaudeControl, { type: 'result' }>): AgentRuntimeEvent {
    if (this.input.headless && (control.permissionDenied || this.unattendedDenial)) {
      this.unattendedDenial = false
      return {
        type: 'error',
        error: Object.assign(new Error('Claude denied a tool request during this scheduled task'), {
          providerErrorCategory: 'permission'
        })
      }
    }
    return {
      type: 'turn-complete',
      finishReason:
        control.stopReason === 'max_tokens' ? 'length' : control.stopReason === 'tool_use' ? 'tool-calls' : 'stop'
    }
  }

  async reconcile({ headless = false }: { headless?: boolean }): Promise<AgentRuntimeReconcileResult> {
    if (headless !== Boolean(this.input.headless) || this.closing) return 'rebuild'
    const current = agentService.getAgent(this.input.agentId)?.configuration?.localRuntime
    if (!current?.enabled) return this.handle?.claude.state().active ? 'rebuild' : 'invalid'
    return JSON.stringify(current) === JSON.stringify(this.config) ? 'current' : 'rebuild'
  }

  cancelStartup() {
    this.abortController.abort()
  }

  protected async disposeSettings() {
    this.abortController.abort()
    await this.browserLease?.dispose()
  }
}
