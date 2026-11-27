import { randomUUID } from 'node:crypto'
import { isDeepStrictEqual } from 'node:util'

import type { ModelInfo, Options } from '@anthropic-ai/claude-agent-sdk'

import { application } from '@application'
import {
  claudeEffortControl,
  localClaudeOptions,
  probeClaudeModels,
  readClaudeSubscriptionUsage,
  type ClaudeControl,
  type ClaudeObservation
} from '@cherrystudio/agent-runtime-claude-code'
import { CLAUDE_PERMISSION_MODES } from '@cherrystudio/agent-runtime-claude-code/cli'
import { selectedPermissionMode } from '@cherrystudio/agent-runtime/cli'
import type { AgentSessionContextRow } from '@data/db/schemas/agentSessionContext'
import { agentProviderService } from '@data/services/AgentProviderService'
import { agentSessionContextService } from '@data/services/AgentSessionContextService'
import { agentSessionMessageService } from '@data/services/AgentSessionMessageService'
import { toolApprovalRegistry, type DispatchDecision } from '@main/ai/toolApproval/ToolApprovalRegistry'
import type { AgentSessionSlashCommand } from '@shared/ai/agentSessionSlashCommands'
import type { LocalAgentConfiguration, LocalAgentRuntime, LocalAgentSessionInfo } from '@shared/ai/localAgent'
import { LocalAgentTurnUsageSchema } from '@shared/ai/localAgentUsage'

import { localBindingMatches, localContext, type LocalLaunchTarget } from '../../agentSession/localContext'
import {
  acquireLocalAgentBrowserLease,
  isHostBrowserControlAllowed,
  LOCAL_AGENT_AUTOMATION_SERVER_NAME
} from '../../mcp/localAgentBrowserBridge'
import type { LocalAgentBrowserLease } from '../../mcp/LocalAgentMcpBridgeService'
import type {
  AgentRuntimeCommand,
  AgentRuntimeEvent,
  AgentRuntimeReconcileResult,
  LocalRuntimeConnectInput
} from '../types'
import { createClaudeCodeProcessDiagnostics, createSpawnClaudeCodeProcess } from './ClaudeCodeProcessManager'
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

export async function probeLocalClaude(config: LocalAgentConfiguration, cwd: string, signal: AbortSignal) {
  return { models: await withLocalClaudeProbe(config, cwd, signal, probeClaudeModels) }
}

export function probeLocalClaudeSubscription(config: LocalAgentConfiguration, cwd: string, signal: AbortSignal) {
  return withLocalClaudeProbe(config, cwd, signal, readClaudeSubscriptionUsage)
}

async function withLocalClaudeProbe<T>(
  config: LocalAgentConfiguration,
  cwd: string,
  signal: AbortSignal,
  read: (...args: Parameters<typeof probeClaudeModels>) => Promise<T>
) {
  const launch = await resolveClaudeLaunch(config, cwd, signal, 'models')
  const diagnostics = createClaudeCodeProcessDiagnostics()
  const abort = new AbortController()
  const cancel = () => abort.abort(signal.reason)
  signal.throwIfAborted()
  signal.addEventListener('abort', cancel, { once: true })
  try {
    const result = await read(launch, abort, createSpawnClaudeCodeProcess(diagnostics), () => diagnostics.exited)
    signal.throwIfAborted()
    return result
  } finally {
    signal.removeEventListener('abort', cancel)
  }
}

export class LocalClaudeConnection extends ClaudeSdkConnection<LocalRuntimeConnectInput> {
  private effortModels: readonly ModelInfo[] = []
  readonly sessionCostScope = 'native-session' as const
  readonly localSessionInfo: LocalAgentSessionInfo = {
    models: [],
    images: true,
    resume: true,
    mode: this.input.headless
      ? undefined
      : { ...CLAUDE_PERMISSION_MODES, options: [...CLAUDE_PERMISSION_MODES.options] }
  }
  get effectivePermissionMode() {
    return this.permissionModeSource ? selectedPermissionMode(this.localSessionInfo.mode) : undefined
  }
  private browserLease?: LocalAgentBrowserLease
  private modelBinding?: { dispose(): Promise<void> }
  private readonly sessionAllowedTools = new Set<string>()
  private unattendedDenial = false
  private permissionModeSource?: 'native' | 'selection'
  private target: LocalLaunchTarget = this.input.localTarget

  get localRuntime(): LocalAgentRuntime {
    return this.config
  }

  override get contextId() {
    return this.target.kind === 'resume' ? super.contextId : undefined
  }

  constructor(
    input: LocalRuntimeConnectInput,
    private readonly config: LocalAgentRuntime
  ) {
    super(input, 'claude')
  }

  protected override prepareContext(_env: Options['env'], nativeId?: string, anchor?: string): AgentSessionContextRow {
    const { sessionId } = this.input
    if (!this.context && this.target.kind === 'resume') return this.target.context
    if (this.target.kind === 'new') {
      if (this.context) return { ...this.context, nativeThreadId: nativeId ?? this.context.nativeThreadId }
      const { id: backendId } = application
        .get('DbService')
        .withWriteTx((tx) => agentSessionContextService.ensureLocalBackendTx(tx, this.target.providerId))
      return {
        id: randomUUID(),
        backendId,
        sessionId,
        nativeThreadId: nativeId ?? randomUUID(),
        localModel: this.target.model,
        bindingState: 'pending',
        parentContextId: null,
        spawnToolCallId: null,
        anchorMessageId: null,
        checkpointMapping: null,
        createdAt: Date.now(),
        updatedAt: Date.now()
      }
    }
    const context = this.reserveContext(anchor ?? agentSessionMessageService.captureHead(sessionId), nativeId)
    if (!context) throw new Error('Local agent binding changed before its native context was claimed')
    return context
  }

  protected override bindNativeContext(context: AgentSessionContextRow, nativeId: string): AgentSessionContextRow {
    return this.target.kind === 'new'
      ? { ...context, nativeThreadId: nativeId, bindingState: 'bound' }
      : super.bindNativeContext(context, nativeId)
  }

  private reserveContext(anchor: string, nativeId?: string) {
    return localContext(
      this.input.sessionId,
      this.input.agentId,
      anchor,
      this.target,
      this.config.browserControl,
      nativeId,
      this.target.kind === 'new' && this.context
        ? { id: this.context.id, nativeConfirmed: this.context.bindingState === 'bound' }
        : undefined
    )
  }

  claimLocalContext(anchor: string): boolean {
    if (
      this.target.kind === 'resume' &&
      this.context &&
      isDeepStrictEqual(this.context.localModel, this.target.model)
    ) {
      return localBindingMatches(
        this.target,
        agentProviderService.getBinding(this.input.agentId),
        this.config.browserControl
      )
    }
    const nativeId = this.context?.nativeThreadId ?? undefined
    const context = this.reserveContext(anchor, nativeId)
    if (!context) return false
    const binding = this.context?.bindingState
    this.target = { ...this.target, kind: 'resume', context }
    this.context =
      nativeId && binding === 'bound' && !context.nativeThreadId ? this.bindNativeContext(context, nativeId) : context
    return true
  }

  async start(cwd: string): Promise<this> {
    const { sessionId, agentId, headless = false, branchHead } = this.input
    const { signal } = this.abortController
    const launch = await resolveClaudeLaunch(this.config, cwd, signal, headless ? 'scheduled-chat' : 'chat', sessionId)
    this.modelBinding = launch.modelBinding
    if (signal.aborted) {
      await this.releaseModelBinding()
      signal.throwIfAborted()
    }
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
    const model = launch.modelBinding?.model ?? this.config.nativeModel ?? (headless ? launch.nativeModel : undefined)
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
    if (launch.modelBinding?.settingsEnv) options.settings = { env: launch.modelBinding.settingsEnv }
    const traceEnv = await this.prepareTraceEnv()
    options.env = { ...options.env, ...traceEnv, CLAUDE_CODE_EMIT_SESSION_STATE_EVENTS: '1' }
    const context = this.prepareContext(options.env, this.resumeToken, branchHead)
    if (this.resumeToken || context.bindingState === 'bound')
      options.resume = this.resumeToken ?? context.nativeThreadId ?? undefined
    else options.sessionId = context.nativeThreadId ?? undefined
    await this.startSdk(options, context, launch.contextWindow)
    const models = await this.handle!.claude.supportedModels()
    if (models.status === 'confirmed') {
      this.effortModels = models.value
      this.localSessionInfo.models = models.value.map((m) => ({ id: m.value, name: m.displayName }))
      const modelId = this.localSessionInfo.activeModel?.id ?? model
      if (modelId) this.updateActiveModel(modelId)
    }
    return this
  }

  override send(input: AgentRuntimeCommand) {
    this.unattendedDenial = false
    if (this.target.kind === 'new' && !this.claimLocalContext(input.message.id))
      throw new Error('Local agent binding changed before input was admitted')
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
    const modelId = this.localSessionInfo.activeModel?.id
    const effort =
      modelId && claudeEffortControl(this.effortModels, modelId, this.localSessionInfo.thoughtLevel?.currentValue)
    const selected = effort && effort.options.find((option) => option.value === value)
    if (!effort || this.input.headless || configId !== effort.id || !selected)
      throw new Error('This session option is no longer available')
    if (!this.handle || this.closing || this.handle.claude.state().active)
      throw new Error('Claude session is unavailable or busy')
    const result = await this.handle.claude.setEffort(selected.value === 'default' ? null : selected.value)
    if (result.status !== 'confirmed') throw new Error(result.error.message)
    if (this.localSessionInfo.activeModel?.id !== modelId) throw new Error('This session option is no longer available')
    this.updateSessionInfo({ thoughtLevel: { ...effort, currentValue: selected.value } })
    return this.localSessionInfo
  }

  private updateSessionInfo(patch: Partial<LocalAgentSessionInfo>) {
    Object.assign(this.localSessionInfo, patch)
    this.eventQueue.push({ type: 'local-session-info', info: { ...this.localSessionInfo } })
  }

  private updateActiveModel(modelId: string, selected = this.localSessionInfo.thoughtLevel?.currentValue) {
    this.updateSessionInfo({
      activeModel: { id: modelId },
      thoughtLevel: this.input.headless ? undefined : claudeEffortControl(this.effortModels, modelId, selected)
    })
  }

  protected override acceptNative(batch: ClaudeObservation) {
    for (const item of batch.native) {
      if (item.source !== 'live') continue
      const message = item.message
      if (message.type === 'system' && message.subtype === 'init' && message.model) {
        this.updateActiveModel(message.model, message.effort === null ? 'default' : message.effort)
      }
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
        this.updateActiveModel(message.message.model)
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
    const current = agentProviderService.getBinding(this.input.agentId)
    if (!current?.enabled) return this.handle?.claude.state().active ? 'rebuild' : 'invalid'
    return localBindingMatches(this.target, current, this.config.browserControl) ? 'current' : 'rebuild'
  }

  cancelStartup() {
    this.abortController.abort()
  }

  protected async disposeSettings() {
    this.abortController.abort()
    await Promise.all([this.browserLease?.dispose(), this.releaseModelBinding()])
  }

  private releaseModelBinding() {
    const binding = this.modelBinding
    this.modelBinding = undefined
    return binding?.dispose()
  }
}
