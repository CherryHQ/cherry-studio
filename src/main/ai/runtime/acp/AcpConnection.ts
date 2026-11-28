import type { ChildProcess } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { once } from 'node:events'
import fs from 'node:fs/promises'
import path from 'node:path'

import type { FinishReason } from 'ai'

import { runtimeId, type OperationResult } from '@cherrystudio/agent-runtime'
import {
  acpEffortOption,
  acpHostError,
  acpPermissionChoice,
  acpPermissionControl,
  advertisesAcpSubscriptionUsage,
  connectAcpStdio,
  mapAcpPermissionOptions,
  type AcpThreadHandle,
  type AcpTurnUsage,
  type AcpDesktopEvents,
  type AcpClientCallbacks,
  type AcpMcpServer,
  type AcpPromptCapabilities,
  type AcpSessionConfiguration
} from '@cherrystudio/agent-runtime-acp/v1'
import {
  hasPermissionModeChoices,
  selectedPermissionMode,
  type AgentPermissionMode
} from '@cherrystudio/agent-runtime/cli'
import { loggerService } from '@logger'
import { t } from '@main/i18n'
import { findExecutableInEnv } from '@main/utils/commandResolver'
import { crossPlatformSpawn } from '@main/utils/processRunner'
import { AgentSessionCostSnapshotSchema } from '@shared/ai/agentSessionCost'
import {
  ACP_HOST_PERMISSION_MODE_ID,
  ACP_NATIVE_PLAN_VALUE,
  getAcpHostPermissionModeSelection,
  getAcpLaunchBypassArgs,
  getAcpLaunchPermission,
  getAcpNativePlanModes,
  isAcpHostPermissionMode,
  isLocalAgentPlaceholderTitle,
  isLocalAllowDecision,
  localCliPresetById,
  type AcpHostPermissionMode,
  type LocalAcpTool,
  type LocalAgentConfigOption,
  type LocalAgentSelection,
  type LocalPermissionOption
} from '@shared/ai/localAgent'
import { LocalAgentTurnUsageSchema } from '@shared/ai/localAgentUsage'
import type { ToolTerminalDelta } from '@shared/ai/messageProjection'
import { NativeQuestionReplySchema } from '@shared/ai/nativeInteraction'

import {
  acquireLocalAgentBrowserLease,
  isHostBrowserControlAllowed,
  LOCAL_AGENT_AUTOMATION_SERVER_NAME
} from '../../mcp/localAgentBrowserBridge'
import type { LocalAgentBrowserLease } from '../../mcp/LocalAgentMcpBridgeService'
import { enrichLocalAgentModels } from '../localAgentModelMetadata'
import { LocalAgentSessionRestoreError } from '../LocalAgentSessionRestoreError'
import { LocalConnection } from '../LocalConnection'
import { stopLocalAgentProcess } from '../stdioProcess'
import type { AgentRuntimeInput, AgentRuntimeReconcileResult, AgentRuntimeUserInput } from '../types'
import { acpContent } from './acpContent'
import { acpError } from './acpError'
import { acpModelSelection, prepareAcpChatLaunch, resolveConfiguredAcpModel } from './acpLaunch'
import {
  classifyAcpToolKind,
  createAcpSessionPermissionGrants,
  evaluateAcpClientTerminal,
  evaluateAcpClientWrite,
  evaluateAcpPermissionRequest,
  isInjectedAcpAutomationTool,
  isPathWithinWorkspace,
  recordAcpAlwaysAllowGrant,
  selectAutoAllowPermissionOption
} from './acpPermissionPolicy'
import { acpPreset, bindAcpHarness } from './acpPresets'
import { AcpProcess } from './AcpProcess'
import { acpProtocolInfo } from './acpSessionInfo'
import { buildStdioHttpMcpShimConfig } from './stdioHttpMcpShim'

function requireAcpControl(result: OperationResult<void>): void {
  if (result.status !== 'confirmed') throw new Error(result.error.message)
}

const logger = loggerService.withContext('AcpConnection')
const HOST_ALLOW_SESSION_OPTION_ID = '__cherry_allow_session__'
const HOST_SCOPED_PERMISSION_OPTIONS: LocalPermissionOption[] = [
  { optionId: 'allow', decision: 'accept', label: 'allow', name: 'Allow' },
  { optionId: 'allow_session', decision: 'acceptForSession', label: 'allow_session', name: 'Allow for session' },
  { optionId: 'deny', decision: 'decline', label: 'deny', name: 'Deny' }
]

function selectedQuestionAnswer(input?: Record<string, unknown>): string | undefined {
  if (!input) return undefined
  const parsed = NativeQuestionReplySchema.safeParse(input)
  if (parsed.success && parsed.data.action === 'submit') {
    const first = parsed.data.selections[0]
    const candidate = first?.selected[0] ?? first?.notes?.trim()
    if (candidate) return candidate
  }
  const answers = input.answers
  if (!answers || typeof answers !== 'object' || Array.isArray(answers)) return undefined
  return Object.values(answers)
    .find((value): value is string => typeof value === 'string' && value.trim().length > 0)
    ?.trim()
}

function describeAcpSelection(option: Extract<LocalAgentConfigOption, { type: 'select' }>) {
  return {
    id: option.id,
    application: 'session' as const,
    currentValue: option.currentValue,
    options: option.options
      .flatMap((choice) => ('group' in choice ? choice.options : [choice]))
      .map((choice) => ({ ...choice, description: choice.description ?? undefined }))
  }
}
type Terminal = {
  child: ChildProcess
  tools: Set<string>
  output: string
  bytes: number
  truncated: boolean
  exitStatus?: { exitCode?: number; signal?: string }
  exited: Promise<{ exitCode?: number; signal?: string }>
}

export class AcpConnection extends LocalConnection {
  private gatewayLease?: { dispose: () => void | Promise<void> }
  private browserLease?: LocalAgentBrowserLease
  private readonly process = new AcpProcess()
  private promptCapabilities: AcpPromptCapabilities = {}
  private messageId?: string
  private session?: AcpThreadHandle<true>
  private shutdownRuntime?: () => Promise<void>
  private readonly terminals = new Map<string, Terminal>()
  private readonly harness = bindAcpHarness(
    this.config.presetId,
    async (target, tool, toolInput, requestSignal, settle) => {
      const turn = this.turnAbort.signal
      if (
        !this.active ||
        target.sessionId !== this.session?.thread.id ||
        this.session.acp.awaitingNativeTurn ||
        turn.aborted ||
        this.abort.signal.aborted ||
        requestSignal.aborted
      )
        return settle({ approved: false }).reply
      if (this.headless) return settle(this.denyUnattendedRequest()).reply
      this.detachToolTerminals(target.toolCallId, this.toolInputs.get(target.toolCallId)?.content)
      this.toolInputs.delete(target.toolCallId)
      const input = { ...toolInput, responseMode: 'native-request' }
      const answer = await this.approve(target.toolCallId, tool, input, requestSignal)
      if (turn.aborted || this.abort.signal.aborted) return settle({ approved: false }).reply
      if (requestSignal.aborted) {
        this.result(target.toolCallId, acpHostError.cancelled().message, true)
        return settle({ approved: false }).reply
      }
      const { reply, output } = settle(answer)
      this.result(target.toolCallId, output)
      return reply
    }
  )
  private configChange?: Promise<void>
  private hostPermissionOverride?: AcpHostPermissionMode
  private linkedNativePlan?: NonNullable<ReturnType<typeof getAcpNativePlanModes>> & { active: boolean }
  private booleanApprovalId?: string
  private launchMode?: LocalAgentSelection & { application: 'reconnect' }
  private launchBypass = false
  private legacyMode?: 'mode' | 'thoughtLevel'
  private planPart?: number
  private planId?: string
  private readonly approvedWrites: Array<{ path: string; content: string }> = []
  private readonly permissionGrants = createAcpSessionPermissionGrants()
  private readonly toolInputs = new Map<string, LocalAcpTool>()
  private hasContextUsageReading = false
  private gatewayContextWindow?: number
  private resumeTokenPublished = false
  private launchConfigSignature: string | undefined

  get threadInput(): AgentRuntimeInput | undefined {
    const steer = this.session?.acp.steer
    if (!steer || this.headless || !this.active) return
    const turn = this.turnAbort.signal
    return {
      steer: {
        whenIdle: steer.whenIdle,
        submit: async ({ inputId, ...input }) => {
          const content = await acpContent(input, this.promptCapabilities)
          if (!this.active || turn.aborted || this.turnAbort.signal !== turn || this.closed)
            return {
              status: 'rejected',
              inputId,
              error: { operation: 'steer', code: 'no-active-turn', message: 'ACP turn already ended' }
            }
          return steer.submit({ inputId, content })
        }
      }
    }
  }

  get compact() {
    return this.headless || this.closed ? undefined : this.session?.compact
  }

  get inspectContextUsage() {
    return this.session?.contextUsage
  }

  get predictPrompt() {
    return this.session?.acp.predictPrompt
  }

  private readonly preset = this.config.presetId ? localCliPresetById.get(this.config.presetId) : undefined
  private readonly permissionModes = this.preset?.permissionMode

  get effectivePermissionMode() {
    if (this.launchBypass) return 'bypassPermissions'
    const { mode, configOptions } = this.localSessionInfo
    const allowAllId = this.permissionModes?.allowAll
    const allowAll = allowAllId && configOptions?.find(({ id }) => id === allowAllId)
    if (
      allowAll &&
      (allowAll.currentValue === true || ['true', 'on'].includes(String(allowAll.currentValue).toLowerCase()))
    ) {
      return 'bypassPermissions'
    }
    const selected = selectedPermissionMode(mode)
    if (selected || !this.permissionModes) return selected
    for (const option of configOptions ?? []) {
      if (option.type !== 'select' || !option.application) continue
      const active = option.options
        .flatMap((choice) => ('group' in choice ? choice.options : [choice]))
        .find(({ value }) => value === option.currentValue)
      if (active?.permissionMode) return active.permissionMode
    }
    return undefined
  }

  private get hostPermissionMode() {
    const { mode, configOptions } = this.localSessionInfo
    if (selectedPermissionMode(mode) === 'plan') return 'plan'
    if (mode?.options.some(({ value, restrictHost }) => value === mode.currentValue && restrictHost)) return 'plan'
    if (
      configOptions?.some(
        (option) =>
          option.type === 'select' &&
          option.options
            .flatMap((choice) => ('group' in choice ? choice.options : [choice]))
            .some(({ value, restrictHost }) => value === option.currentValue && restrictHost)
      )
    )
      return 'plan'
    if (this.launchBypass) return 'bypassPermissions'
    const nativeMode = this.effectivePermissionMode
    const hostOverride = this.localSessionInfo.hostPermission && this.hostPermissionOverride
    if (this.permissionModes?.nativeApprovalOnly && !this.localSessionInfo.hostPermission) return 'default'
    return nativeMode === 'plan' ? nativeMode : (hostOverride ?? nativeMode)
  }

  // Reaping a non-resumable process would lose access to its native session.
  get retainWhileIdle(): boolean {
    return this.localSessionInfo.resume !== true
  }

  override async reconcile(target: { headless?: boolean } = {}): Promise<AgentRuntimeReconcileResult> {
    const base = await super.reconcile(target)
    if (base !== 'current') return base
    const signature = acpPreset(this.config.presetId)?.chatConfigSignature?.(this.config)
    return signature === this.launchConfigSignature ? 'current' : 'rebuild'
  }

  async start(cwd: string, resume?: string, launchBypass = false, permissionMode?: AgentPermissionMode): Promise<this> {
    try {
      return await this.startConnection(cwd, resume, launchBypass, permissionMode)
    } catch (error) {
      throw acpError(error, this.process.stderr)
    }
  }
  private async startConnection(
    cwd: string,
    resume: string | undefined,
    launchBypass: boolean,
    permissionMode?: AgentPermissionMode
  ): Promise<this> {
    this.launchBypass = !this.headless && launchBypass && !!getAcpLaunchBypassArgs(this.config)
    this.launchConfigSignature = acpPreset(this.config.presetId)?.chatConfigSignature?.(this.config)
    const { launch, gateway, mode, contextWindow } = await prepareAcpChatLaunch(
      this.config,
      this.sessionId,
      this.abort.signal,
      this.launchBypass,
      permissionMode
    )
    if (this.abort.signal.aborted) {
      await gateway?.dispose()
      this.abort.signal.throwIfAborted()
    }
    this.gatewayLease = gateway
    this.gatewayContextWindow = contextWindow
    this.launchMode = mode
    const client = await this.process.open(
      this.config,
      launch,
      cwd,
      this.abort.signal,
      (stdin, stdout, clientInfo) =>
        connectAcpStdio(stdin, stdout, {
          clientInfo,
          backendId: runtimeId<'backend'>(this.agentId),
          closeAndJoin: () => this.process.close(),
          report: (error) => logger.warn('ACP runtime operation failed', { error }),
          denyMutation: this.headless
            ? (id) => {
                this.requireSession(id)
                return acpHostError.invalidRequest(this.denyUnattendedRequest().reason)
              }
            : undefined,
          callbacks: this.hostCallbacks(cwd, launch.env),
          events: this.liveEvents,
          harness: this.harness
        }),
      (error) => {
        this.finish(error)
        this.dispose()
      }
    )
    this.shutdownRuntime = client.shutdown
    const agent = await client.initialize()
    const { response } = agent
    this.localSessionInfo.subscriptionUsage = advertisesAcpSubscriptionUsage(response) ? true : undefined
    this.localSessionInfo.protocolInfo = acpProtocolInfo(response)
    logger.info('ACP handshake completed', {
      agentId: this.agentId,
      protocolVersion: response.protocolVersion,
      agent: this.localSessionInfo.protocolInfo.agent
    })
    this.localSessionInfo.resume = !!agent.restore
    this.promptCapabilities = response.agentCapabilities?.promptCapabilities ?? {}
    this.localSessionInfo.images = this.promptCapabilities.image === true
    this.localSessionInfo.audio = this.promptCapabilities.audio === true
    if (acpPreset(this.config.presetId)?.sessionMcp !== 'unsupported') {
      this.browserLease = await acquireLocalAgentBrowserLease({
        sessionId: this.sessionId,
        agentId: this.agentId,
        config: this.config,
        headless: this.headless,
        signal: this.abort.signal,
        isReadOnly: () => this.hostPermissionMode === 'plan'
      })
    }
    const mcpServers = this.buildBrowserMcpServers(response.agentCapabilities?.mcpCapabilities?.http === true)
    const configure = async (session: AcpThreadHandle<true>) => {
      const selection = acpModelSelection(this.config, launch)
      const boundGateway = !!this.config.sourceModelId || !!this.gatewayLease
      if (!selection.model || (resume && !boundGateway && session.acp.model.activeModel?.id)) return
      const model = boundGateway
        ? resolveConfiguredAcpModel(
            this.config.presetId,
            selection.model,
            session.acp.model.models.map(({ id }) => id)
          )
        : selection.model
      requireAcpControl(await session.acp.selectInitialModel({ ...selection, model }))
    }
    if (resume && !agent.restore)
      throw new LocalAgentSessionRestoreError('This agent cannot restore the previous conversation')
    if (resume && agent.restore) {
      await agent.restore({ cwd, sessionId: resume, mcpServers }, configure).catch((error: unknown) => {
        const failure = acpError(error)
        if (
          failure instanceof Error &&
          'code' in failure &&
          (failure.code === -32601 ||
            (failure.code !== -32000 && /\b(?:session (?:was )?not found|unknown session)\b/i.test(failure.message)))
        )
          throw new LocalAgentSessionRestoreError(failure.message)
        throw error
      })
    } else await agent.create({ cwd, mcpServers }, configure)
    if (this.launchBypass && selectedPermissionMode(this.localSessionInfo.mode) === 'plan') {
      const nativePlan = getAcpNativePlanModes(this.localSessionInfo.mode)
      if (!nativePlan) throw new Error('Could not exit Plan for the launch permission')
      await this.setMode(nativePlan.configId, nativePlan.work)
      if (this.localSessionInfo.mode?.currentValue !== nativePlan.work)
        throw new Error('The agent did not exit Plan for the launch permission')
    }
    this.localSessionInfo.protocolInfo.verified.push('session')
    // Fresh ACP sessions with 0 turns may not be persisted on disk yet; defer resume-token until a turn runs.
    if (resume) this.publishSessionResumeToken()
    this.publishSessionInfo()
    return this
  }
  private hostCallbacks(cwd: string, env: NodeJS.ProcessEnv): AcpClientCallbacks {
    return {
      elicitation: async (params, { signal: requestSignal }) => {
        if (params.mode !== 'form') throw acpHostError.invalidRequest('Unsupported elicitation mode')
        if (
          !this.active ||
          !('sessionId' in params) ||
          params.sessionId !== this.session?.thread.id ||
          this.abort.signal.aborted
        )
          return { action: 'cancel' }
        try {
          return await this.elicit(
            params.message,
            params.requestedSchema,
            this.localSessionInfo.protocolInfo?.agent?.name ?? this.config.presetId ?? 'ACP',
            requestSignal
          )
        } catch (error) {
          if (error instanceof RangeError) throw acpHostError.invalidRequest(error.message)
          throw error
        }
      },
      permission: async (params, { signal: requestSignal }) => {
        if (
          !this.active ||
          params.sessionId !== this.session?.thread.id ||
          this.session.acp.awaitingNativeTurn ||
          this.abort.signal.aborted
        )
          return { outcome: { outcome: 'cancelled' } }
        if (this.headless) {
          this.denyUnattendedRequest()
          const rejection = params.options.find((option) => option.kind === 'reject_once')
          return {
            outcome: rejection
              ? { outcome: 'selected' as const, optionId: rejection.optionId }
              : { outcome: 'cancelled' as const }
          }
        }
        const id = params.toolCall.toolCallId
        const signal = AbortSignal.any([this.turnAbort.signal, requestSignal])
        const question = this.harness?.permissionQuestion?.(params)
        if (question) {
          const answer = await this.approve(
            id,
            'AskUserQuestion',
            {
              questions: [
                { id, question: question.text, header: 'Question', multiSelect: false, options: question.options }
              ],
              responseMode: 'native-request'
            },
            signal
          )
          if (this.abort.signal.aborted || signal.aborted) return { outcome: { outcome: 'cancelled' } }
          const choice = answer.approved ? selectedQuestionAnswer(answer.updatedInput) : undefined
          const optionId = choice ? question.optionIdFor(choice) : undefined
          const outcome =
            optionId && params.options.some((option) => option.optionId === optionId)
              ? { outcome: 'selected' as const, optionId }
              : { outcome: 'cancelled' as const }
          if (this.active) this.result(id, outcome)
          return { outcome }
        }
        const knownTool = this.tools.has(id)
        const options = params.options
        const previousTool = this.toolInputs.get(id)
        const tool = { ...previousTool, ...params.toolCall }
        const policyDecision =
          this.browserLease &&
          isHostBrowserControlAllowed(this.config) &&
          (isInjectedAcpAutomationTool(tool, this.config.presetId) ||
            (previousTool != null &&
              classifyAcpToolKind(tool) === 'other' &&
              isInjectedAcpAutomationTool(previousTool, this.config.presetId)))
            ? 'allow'
            : evaluateAcpPermissionRequest({
                mode: this.hostPermissionMode,
                tool,
                cwd,
                grants: this.permissionGrants
              })
        const autoSelected = policyDecision === 'allow' ? selectAutoAllowPermissionOption(options) : undefined
        let selected: (typeof options)[number] | undefined
        let grantedSession = false
        if (autoSelected) {
          selected = autoSelected
        } else {
          const allowOnceOption = options.find((o) => o.kind === 'allow_once')
          const promptOptions: LocalPermissionOption[] = mapAcpPermissionOptions(
            options,
            this.harness?.describePermissionOption
          )
          if (allowOnceOption && !options.some((option) => option.kind === 'allow_always')) {
            const allowOnceIndex = promptOptions.findIndex((option) => option.decision === 'accept')
            promptOptions.splice(allowOnceIndex + 1, 0, {
              optionId: HOST_ALLOW_SESSION_OPTION_ID,
              decision: 'acceptForSession',
              label: 'allow_session',
              name: 'Allow for session'
            })
          }
          const answer = await this.approve(
            id,
            `ACP: ${tool.title ?? 'Tool'}`,
            {
              localAcpTool: tool,
              localPermissionOptions: promptOptions
            },
            signal
          )
          const requested = answer.updatedInput?.localPermissionOption
          if (this.abort.signal.aborted || signal.aborted) {
            selected = undefined
          } else if (answer.approved && requested === HOST_ALLOW_SESSION_OPTION_ID && allowOnceOption) {
            selected = allowOnceOption
            grantedSession = true
          } else if (typeof requested === 'string') {
            selected = options.find(
              (o) => o.optionId === requested && o.kind.startsWith(answer.approved ? 'allow_' : 'reject_')
            )
            if (!selected && answer.approved) {
              // Fall back to allow_once rather than cancelling an approved turn if an option disappeared.
              const matchedPrompt = promptOptions.find(
                (o) => o.optionId === requested && isLocalAllowDecision(o.decision)
              )
              if (matchedPrompt?.decision === 'acceptForSession' && allowOnceOption) {
                selected = allowOnceOption
                grantedSession = true
              }
            }
          } else {
            selected = answer.approved
              ? (options.find((o) => o.kind === 'allow_once') ?? options.find((o) => o.kind === 'allow_always'))
              : (options.find((o) => o.kind === 'reject_once') ?? options.find((o) => o.kind === 'reject_always'))
          }
        }
        const outcome = selected
          ? { outcome: 'selected' as const, optionId: selected.optionId }
          : { outcome: 'cancelled' as const }
        if (selected?.kind.startsWith('allow_')) {
          if (!autoSelected && (grantedSession || selected.kind === 'allow_always')) {
            recordAcpAlwaysAllowGrant(this.permissionGrants, tool)
          }
          for (const content of params.toolCall.content ?? []) {
            if (content.type === 'diff')
              this.approvedWrites.push({ path: path.resolve(cwd, content.path), content: content.newText })
          }
        }
        if (!autoSelected && !knownTool && this.active) this.result(id, outcome)
        return { outcome }
      },
      readTextFile: async (params, { signal }) => {
        this.requireSession(params.sessionId)
        const readPath = this.headless ? path.resolve(cwd, params.path) : params.path
        if (this.headless && !isPathWithinWorkspace(readPath, cwd)) {
          throw acpHostError.invalidRequest(this.denyUnattendedRequest().reason)
        }
        const content = await fs.readFile(readPath, { encoding: 'utf8', signal }).catch((error) => {
          if (signal.aborted) throw acpHostError.cancelled()
          throw error
        })
        const lines = content.split('\n')
        return {
          content: lines
            .slice(
              Math.max(0, (params.line ?? 1) - 1),
              params.limit ? (params.line ?? 1) - 1 + params.limit : undefined
            )
            .join('\n')
        }
      },
      writeTextFile: async (params, { signal: requestSignal }) => {
        this.requireSession(params.sessionId)
        if (!this.active) throw acpHostError.invalidRequest('Inactive ACP session')
        const id = randomUUID()
        const signal = AbortSignal.any([this.turnAbort.signal, requestSignal])
        const grant = this.approvedWrites.findIndex(
          (write) => write.path === path.resolve(cwd, params.path) && write.content === params.content
        )
        if (grant >= 0) this.approvedWrites.splice(grant, 1)
        const decision = evaluateAcpClientWrite({
          mode: this.hostPermissionMode,
          targetPath: params.path,
          cwd,
          hasExactApprovedWrite: grant >= 0,
          grants: this.permissionGrants
        })
        const needsPrompt = decision === 'ask'
        try {
          if (needsPrompt) {
            const answer = await this.approve(
              id,
              'ACP: Write',
              {
                path: params.path,
                content: params.content,
                localPermissionOptions: HOST_SCOPED_PERMISSION_OPTIONS
              },
              signal
            )
            if (!answer.approved || this.abort.signal.aborted || signal.aborted) throw new Error('File write denied')
            if (answer.updatedInput?.localPermissionOption === 'allow_session') {
              this.permissionGrants.allowWrite = true
            }
          }
          if (signal.aborted) throw acpHostError.cancelled()
          await fs.writeFile(params.path, params.content, { signal })
          if (needsPrompt) this.result(id, { path: params.path })
          return {}
        } catch (error) {
          if (needsPrompt) this.result(id, String(error), true)
          if (signal.aborted) throw acpHostError.cancelled()
          throw error
        }
      },
      terminal: {
        create: async (params, { signal: requestSignal }) => {
          this.requireSession(params.sessionId)
          const id = randomUUID()
          const signal = AbortSignal.any([this.turnAbort.signal, requestSignal])
          const decision = evaluateAcpClientTerminal({
            mode: this.hostPermissionMode,
            grants: this.permissionGrants
          })
          const needsPrompt = decision === 'ask'
          if (needsPrompt) {
            const answer = await this.approve(
              id,
              'ACP: Terminal',
              {
                command: params.command,
                args: params.args,
                cwd: params.cwd ?? cwd,
                env: params.env ?? [],
                localPermissionOptions: HOST_SCOPED_PERMISSION_OPTIONS
              },
              signal
            )
            if (!answer.approved || this.abort.signal.aborted || signal.aborted) {
              this.result(id, 'Terminal execution denied', true)
              if (signal.aborted) throw acpHostError.cancelled()
              throw new Error('Terminal execution denied')
            }
            if (answer.updatedInput?.localPermissionOption === 'allow_session') {
              this.permissionGrants.allowExecute = true
            }
          }
          const terminalId = randomUUID()
          const terminalCwd = params.cwd ?? cwd
          const terminalEnv = Object.fromEntries(
            Object.entries({ ...env, ...Object.fromEntries((params.env ?? []).map((e) => [e.name, e.value])) }).filter(
              (entry): entry is [string, string] => typeof entry[1] === 'string'
            )
          )
          const shell =
            params.args === undefined &&
            /\s/.test(params.command) &&
            !(await fs.access(path.resolve(terminalCwd, params.command)).then(
              () => true,
              () => false
            )) &&
            !(await findExecutableInEnv(params.command, { env: terminalEnv, signal }))
          signal.throwIfAborted()
          const proc = crossPlatformSpawn(params.command, params.args ?? [], {
            cwd: terminalCwd,
            env: terminalEnv,
            shell,
            detached: process.platform !== 'win32'
          })
          const terminal: Terminal = {
            child: proc,
            tools: new Set(),
            output: '',
            bytes: 0,
            truncated: false,
            exited: new Promise((resolve) => {
              proc.once('close', (code, signal) =>
                resolve({ exitCode: code ?? undefined, signal: signal ?? undefined })
              )
              proc.once('error', (error) => {
                receive(error.message)
                resolve({ exitCode: 1 })
              })
            })
          }
          const limit = Math.min(params.outputByteLimit ?? 1024 * 1024, 1024 * 1024)
          const receive = (data: string) => {
            const bytes = Buffer.byteLength(data)
            let append = data
            let drop = 0
            if (terminal.bytes + bytes > limit) {
              terminal.truncated = true
              if (bytes >= limit) {
                const buffer = Buffer.from(data)
                let start = bytes - limit
                while (start < bytes && (buffer[start] & 0xc0) === 0x80) start++
                append = buffer.subarray(start).toString('utf8')
                drop = terminal.output.length
                terminal.bytes = bytes - start
              } else {
                let length = terminal.bytes + bytes
                for (const char of terminal.output) {
                  length -= Buffer.byteLength(char)
                  drop += char.length
                  if (length <= limit) break
                }
                terminal.bytes = length
              }
            } else terminal.bytes += bytes
            terminal.output = terminal.output.slice(drop) + append
            this.publishTerminal(terminalId, { append, drop, truncated: terminal.truncated })
          }
          proc.stdout?.setEncoding('utf8').on('data', receive)
          proc.stderr?.setEncoding('utf8').on('data', receive)
          this.terminals.set(terminalId, terminal)
          void terminal.exited.then((status) => {
            terminal.exitStatus = status
            this.publishTerminal(terminalId)
          })
          if (needsPrompt) this.result(id, { terminalId })
          return { terminalId }
        },
        output: async (params) => {
          this.requireSession(params.sessionId)
          const terminal = this.terminal(params.terminalId)
          return {
            output: terminal.output,
            truncated: terminal.truncated,
            ...(terminal.exitStatus ? { exitStatus: terminal.exitStatus } : {})
          }
        },
        waitForExit: async (params, { signal }) => {
          this.requireSession(params.sessionId)
          const terminal = this.terminal(params.terminalId)
          if (!terminal.exitStatus) {
            await once(terminal.child, 'close', { signal }).catch(() => {
              if (signal.aborted) throw acpHostError.cancelled()
            })
          }
          return terminal.exited
        },
        kill: async (params) => {
          this.requireSession(params.sessionId)
          await stopLocalAgentProcess(this.terminal(params.terminalId).child)
          return {}
        },
        release: async (params) => {
          this.requireSession(params.sessionId)
          await stopLocalAgentProcess(this.terminal(params.terminalId).child)
          this.terminals.delete(params.terminalId)
          return {}
        }
      }
    }
  }

  private buildBrowserMcpServers(supportsHttp: boolean): AcpMcpServer[] {
    if (!this.browserLease) return []
    if (supportsHttp) {
      return [
        {
          type: 'http',
          name: LOCAL_AGENT_AUTOMATION_SERVER_NAME,
          url: this.browserLease.url,
          headers: [{ name: 'Authorization', value: `Bearer ${this.browserLease.token}` }]
        }
      ]
    }
    return [
      {
        name: LOCAL_AGENT_AUTOMATION_SERVER_NAME,
        ...buildStdioHttpMcpShimConfig(this.browserLease.url, this.browserLease.token)
      }
    ]
  }
  async selectModel(modelId: string) {
    if (this.headless || !this.session || this.closed || this.active || this.configChange)
      throw new Error('ACP session is unavailable or busy')
    this.configChange = this.session.acp.selectModel(modelId).then(requireAcpControl)
    try {
      await this.configChange
      return this.localSessionInfo
    } finally {
      this.configChange = undefined
    }
  }
  async setConfigOption(configId: string, value: string | boolean) {
    return this.setSelection('config', configId, value)
  }
  async setMode(configId: string, value: string) {
    if (configId === ACP_HOST_PERMISSION_MODE_ID) {
      if (this.headless || !this.session || this.closed || this.active || this.configChange)
        throw new Error('ACP session is unavailable or busy')
      if (!isAcpHostPermissionMode(value)) throw new Error('This session option is no longer available')
      if (
        !this.localSessionInfo.hostPermission ||
        (value === 'bypassPermissions' && this.localSessionInfo.launchPermission)
      )
        return this.localSessionInfo
      this.hostPermissionOverride = value
      this.localSessionInfo.hostPermission = getAcpHostPermissionModeSelection(this.localSessionInfo.mode, value)
      if (this.localSessionInfo.launchPermission)
        this.localSessionInfo.launchPermission = getAcpLaunchPermission(
          this.localSessionInfo.hostPermission,
          this.launchBypass
        )
      this.publishSessionInfo()
      return this.localSessionInfo
    }
    if (this.localSessionInfo.mode?.application === 'reconnect')
      throw new Error('This session option applies when the agent starts')
    return this.setSelection('mode', configId, value)
  }
  async setThoughtLevel(configId: string, value: string) {
    return this.setSelection('thoughtLevel', configId, value)
  }
  private async setSelection(category: 'mode' | 'thoughtLevel' | 'config', configId: string, value: string | boolean) {
    if (this.headless) throw new Error('Scheduled tasks use the agent configuration')
    if (!this.session || this.closed || this.active || this.configChange)
      throw new Error('ACP session is unavailable or busy')
    const selection =
      category === 'config'
        ? this.localSessionInfo.configOptions?.find((option) => option.id === configId)
        : this.localSessionInfo[category]
    if (
      !selection ||
      selection.id !== configId ||
      ('type' in selection && selection.type === 'boolean'
        ? typeof value !== 'boolean'
        : typeof value !== 'string' ||
          !selection.options
            .flatMap((option) => ('group' in option ? option.options : [option]))
            .some((option) => option.value === value))
    )
      throw new Error('This session option is no longer available')
    const nativeValue = category === 'mode' && configId === this.booleanApprovalId ? value === 'true' : value
    const legacyEffort = category === 'thoughtLevel' ? this.session.acp.legacyEffort : undefined
    if (legacyEffort && typeof value === 'string' && legacyEffort.read()?.id === configId) {
      this.configChange = legacyEffort.set(value).then(() => {
        if (this.localSessionInfo.thoughtLevel !== selection) return
        this.localSessionInfo.thoughtLevel = legacyEffort.read()
        this.publishSessionInfo()
      })
    } else if (
      category === 'mode' &&
      this.linkedNativePlan &&
      (value === ACP_NATIVE_PLAN_VALUE || this.linkedNativePlan.active)
    ) {
      const { configId: workflowId, plan, work } = this.linkedNativePlan
      const native = this.session.acp
      const setWorkflow = (mode: string) =>
        workflowId === 'legacy-mode' ? native.setMode(mode) : native.setConfigOption(workflowId, mode)
      this.configChange = (async () => {
        if (value === ACP_NATIVE_PLAN_VALUE) {
          requireAcpControl(await setWorkflow(plan))
          if (!this.linkedNativePlan?.active) throw new Error('ACP rejected the switch to Plan')
          return
        }
        requireAcpControl(await setWorkflow(work))
        if (this.linkedNativePlan?.active !== false) throw new Error('ACP rejected the switch out of Plan')
        requireAcpControl(await native.setConfigOption(configId, nativeValue))
      })()
    } else if (category === this.legacyMode && typeof value === 'string') {
      this.configChange = this.session.acp.setMode(value).then(requireAcpControl)
    } else {
      this.configChange = this.session.acp.setConfigOption(configId, nativeValue).then(requireAcpControl)
    }
    try {
      await this.configChange
      return this.localSessionInfo
    } finally {
      this.configChange = undefined
    }
  }

  private readConfigOptions({
    configOptions: options,
    modes
  }: Pick<AcpSessionConfiguration, 'configOptions' | 'modes'>) {
    const { approvalConfigId, workflowConfigId } = this.permissionModes ?? {}
    const mode = options?.find(
      (option) =>
        option.type === 'select' &&
        (workflowConfigId
          ? option.id === workflowConfigId
          : option.category === 'mode' && option.id !== approvalConfigId)
    )
    const thought = acpEffortOption(options)
    const configOptions: LocalAgentConfigOption[] | undefined =
      options
        ?.filter(
          (option) =>
            option.id !== ACP_HOST_PERMISSION_MODE_ID &&
            !this.permissionModes?.persistentConfigIds?.includes(option.id) &&
            (option.type === 'select' || option.type === 'boolean')
        )
        .map((option) => {
          const { id, name, description, category } = option
          const control = acpPermissionControl(option, this.permissionModes)
          const role =
            option === mode
              ? ('mode' as const)
              : option === thought
                ? ('reasoning' as const)
                : control === 'allow_all' || control === 'sandbox'
                  ? ('security' as const)
                  : undefined
          const base = {
            id,
            name,
            description,
            category,
            ...(role ? { role } : {}),
            ...(control ? { application: 'session' as const } : {})
          }
          if (option.type === 'boolean') {
            return {
              ...base,
              type: 'boolean' as const,
              currentValue: option.currentValue,
              ...(control === 'allow_all' ? { confirmationValue: true } : {}),
              ...(control === 'sandbox' ? { confirmationValue: false } : {})
            }
          }
          const describe = (choice: { value: string; name: string; description?: string | null }) =>
            acpPermissionChoice(choice, control, this.permissionModes)
          return {
            ...base,
            type: 'select' as const,
            currentValue: option.currentValue,
            options: control
              ? option.options.map((choice) =>
                  'group' in choice ? { ...choice, options: choice.options.map(describe) } : describe(choice)
                )
              : option.options
          }
        }) ?? undefined

    this.legacyMode = undefined
    const modeOption = configOptions?.find((option) => option.role === 'mode')
    let permission: LocalAgentSelection | undefined =
      modeOption?.type === 'select' ? describeAcpSelection(modeOption) : undefined
    const legacySelection = modes
      ? {
          id: 'legacy-mode',
          application: 'session' as const,
          currentValue: modes.currentModeId,
          options: modes.availableModes.map(({ id, name, description }) =>
            acpPermissionChoice(
              { value: id, name, description: description ?? undefined },
              'mode',
              this.permissionModes
            )
          )
        }
      : undefined
    const approvalOption = configOptions?.find((option) => option.id === approvalConfigId)
    this.booleanApprovalId = approvalOption?.type === 'boolean' ? approvalOption.id : undefined
    const approval: LocalAgentSelection | undefined =
      approvalOption?.type === 'boolean'
        ? {
            id: approvalOption.id,
            application: 'session',
            currentValue: String(approvalOption.currentValue),
            options: [
              { value: 'false', name: 'Ask Before Acting', permissionMode: 'default' },
              { value: 'true', name: 'Auto-approve tools', permissionMode: 'bypassPermissions' }
            ]
          }
        : approvalOption && describeAcpSelection(approvalOption)
    this.linkedNativePlan = undefined
    if (approval && hasPermissionModeChoices(approval)) {
      const workflow = permission ?? (this.permissionModes?.legacyPlan ? legacySelection : undefined)
      const plan = getAcpNativePlanModes(workflow)
      this.linkedNativePlan = plan && { ...plan, active: workflow?.currentValue === plan.plan }
      permission = this.linkedNativePlan
        ? {
            ...approval,
            currentValue: this.linkedNativePlan.active ? ACP_NATIVE_PLAN_VALUE : approval.currentValue,
            options: [...approval.options, { value: ACP_NATIVE_PLAN_VALUE, name: 'Plan', permissionMode: 'plan' }]
          }
        : approval
    }
    if (!this.launchMode && !hasPermissionModeChoices(permission)) {
      for (const option of configOptions ?? []) {
        if (option.type !== 'select' || !option.application || option === modeOption) continue
        const selection = describeAcpSelection(option)
        if (!hasPermissionModeChoices(selection)) continue
        permission = selection
        break
      }
    }
    const legacy = options == null || (this.permissionModes?.legacyPlan && !permission) ? legacySelection : undefined
    if (legacy) {
      if (this.preset?.legacyModes === 'effort') {
        this.legacyMode = 'thoughtLevel'
      } else if (!this.launchMode) {
        this.legacyMode = 'mode'
        permission = legacy
      }
    }
    this.localSessionInfo.mode =
      this.launchMode ??
      (permission && this.permissionModes?.nativePermissionNames
        ? { ...permission, nativePermissionNames: true }
        : permission)
    this.localSessionInfo.hostPermission =
      this.headless || (approval && hasPermissionModeChoices(approval))
        ? undefined
        : getAcpHostPermissionModeSelection(this.localSessionInfo.mode, this.hostPermissionOverride)
    this.localSessionInfo.launchPermission =
      !this.headless && (this.localSessionInfo.resume || this.launchBypass) && getAcpLaunchBypassArgs(this.config)
        ? getAcpLaunchPermission(this.localSessionInfo.hostPermission ?? this.localSessionInfo.mode, this.launchBypass)
        : undefined
    const thoughtOption = configOptions?.find((option) => option.role === 'reasoning')
    const model = this.session?.acp.model
    this.localSessionInfo.activeModel = model?.activeModel
    this.localSessionInfo.models = enrichLocalAgentModels(model?.models ?? [], this.config.presetId)
    this.localSessionInfo.modelSelection = model?.status
    const effort =
      thoughtOption?.type === 'select'
        ? describeAcpSelection(thoughtOption)
        : this.legacyMode === 'thoughtLevel'
          ? legacy
          : undefined
    this.localSessionInfo.thoughtLevel = this.headless
      ? undefined
      : effort
        ? { ...effort, modelId: this.localSessionInfo.activeModel?.id }
        : this.session?.acp.legacyEffort?.read()
    this.localSessionInfo.configOptions = configOptions?.flatMap((option) => {
      if (option.id === effort?.id) return []
      const isPrimaryMode = option.id === this.localSessionInfo.mode?.id
      if (!isPrimaryMode) return [option]
      if (option.role !== 'mode' || option.type !== 'select') return []
      if (!hasPermissionModeChoices(this.localSessionInfo.mode)) return [option]
      const choices = option.options.flatMap((choice) => ('group' in choice ? choice.options : [choice]))
      const workflows = choices.filter(({ workflowOnly }) => workflowOnly)
      return workflows.length
        ? [
            {
              ...option,
              options: choices.filter((choice) => choice.workflowOnly || choice.permissionMode === 'default')
            }
          ]
        : []
    })
    this.publishSessionInfo()
  }
  private publishSessionResumeToken() {
    const id = this.session?.thread.id
    if (!id || this.resumeTokenPublished) return
    this.resumeTokenPublished = true
    this.publishResumeToken(id)
  }
  private publishSessionInfo() {
    if (!this.localSessionInfo.protocolInfo?.verified.includes('session')) return
    // oxlint-disable-next-line no-restricted-globals -- The queued event owns its session snapshot.
    this.events.push({ type: 'local-session-info', info: structuredClone(this.localSessionInfo) })
  }
  private requireSession(sessionId: string) {
    if (sessionId !== this.session?.thread.id || this.closed || this.abort.signal.aborted)
      throw acpHostError.invalidRequest('Inactive ACP session')
  }
  private terminal(id: string): Terminal {
    const terminal = this.terminals.get(id)
    if (!terminal) throw new Error('Unknown session terminal')
    return terminal
  }
  private readonly liveEvents: AcpDesktopEvents = {
    opened: (session, configuration) => {
      this.session = session
      this.readConfigOptions(configuration)
    },
    nativeTurn: (event) => {
      if (event.state === 'started') {
        if (this.headless || this.active || this.closed || !this.attachLocalContext(event.sessionId)) return false
        this.publishSessionResumeToken()
        this.planPart = undefined
        this.planId = undefined
        this.events.push({ type: 'autonomous-turn-state', state: 'started', origin: { kind: 'native-turn' } })
        this.begin(event.id)
      } else {
        if (event.usage)
          this.publishTurnUsage(event.usage, event.sessionId, this.localSessionInfo.activeModel?.id ?? null)
        this.finish(event.error ? new Error(event.error) : undefined, event.cancelled ? 'cancelled' : 'stop')
        this.events.push({ type: 'autonomous-turn-state', state: 'finished' })
      }
      return true
    },
    compaction: (event) => this.events.push(event),
    notice: (notice) => this.events.push({ type: 'notice', notice }),
    title: (title) => {
      if (!isLocalAgentPlaceholderTitle(title, () => this.config.presetId))
        this.events.push({ type: 'session-title', title })
    },
    options: (configOptions, modes) => this.readConfigOptions({ configOptions, modes }),
    commands: (commands) => this.publishCommands(commands),
    usage: ({ used, size, cost }) => {
      if (cost && this.session) {
        const snapshot = AgentSessionCostSnapshotSchema.safeParse({
          nativeSessionId: this.session.thread.id,
          reportedAt: Date.now(),
          cost: { amount: cost.amount, currency: cost.currency }
        })
        if (snapshot.success) this.events.push({ type: 'session-cost', snapshot: snapshot.data })
      }
      if (used < 0) return
      const model = this.localSessionInfo.activeModel?.id ?? this.config.nativeModel ?? ''
      const contextWindow =
        size > 0
          ? size
          : this.localSessionInfo.activeModel?.id === this.config.nativeModel
            ? this.gatewayContextWindow
            : undefined
      this.hasContextUsageReading = true
      this.events.push({
        type: 'context-usage',
        result: {
          status: 'confirmed',
          value: {
            model,
            revision: model,
            ...(contextWindow === undefined ? {} : { contextWindow }),
            basis: 'current-context',
            used: { tokens: used, precision: 'reported' }
          }
        }
      })
    },
    content: (kind, content, messageId) => {
      if (messageId !== this.messageId) this.endContent()
      this.messageId = messageId
      if (content.type === 'text') {
        this.content(content.text, kind, messageId === undefined ? undefined : { acp: { messageId } })
      } else {
        this.endContent()
        this.putData({
          type: 'data-acp-content',
          id: randomUUID(),
          data: { content, reasoning: kind === 'reasoning', ...(messageId !== undefined && { messageId }) }
        })
      }
    },
    plan: (entries) => {
      this.endContent()
      this.planId ??= randomUUID()
      this.planPart = this.putData({ type: 'data-agent-plan', id: this.planId, data: { entries } }, this.planPart)
    },
    tool: (id, patch) => {
      const owner = this.tools.get(id)?.name
      if (owner === 'AskUserQuestion' || owner === 'ExitPlanMode') return
      this.endContent()
      const previous = this.toolInputs.get(id)
      let tool: LocalAcpTool = { title: 'Tool', ...previous, ...patch }
      if (patch.content) {
        this.detachToolTerminals(id, previous?.content)
        delete tool.terminals
        delete tool.terminalDetails
        for (const item of patch.content) {
          if (item.type !== 'terminal') continue
          const terminal = this.terminals.get(item.terminalId)
          if (terminal) {
            terminal.tools.add(id)
            tool = this.withTerminal(tool, item.terminalId, terminal)
          } else if (
            previous?.terminals?.[item.terminalId] !== undefined &&
            previous.terminalDetails?.[item.terminalId]
          ) {
            ;(tool.terminals ??= {})[item.terminalId] = previous.terminals[item.terminalId]
            ;(tool.terminalDetails ??= {})[item.terminalId] = previous.terminalDetails[item.terminalId]
          }
        }
      }
      this.publishTool(id, tool)
    }
  }

  private detachToolTerminals(id: string, content: LocalAcpTool['content']) {
    for (const item of content ?? []) {
      if (typeof item === 'object' && item !== null && 'terminalId' in item && typeof item.terminalId === 'string')
        this.terminals.get(item.terminalId)?.tools.delete(id)
    }
  }

  private withTerminal(tool: LocalAcpTool, id: string, terminal: Terminal): LocalAcpTool {
    return {
      ...tool,
      terminals: { ...tool.terminals, [id]: terminal.output },
      terminalDetails: { ...tool.terminalDetails, [id]: { truncated: terminal.truncated, ...terminal.exitStatus } }
    }
  }

  private publishTool(id: string, tool: LocalAcpTool) {
    if (!this.active) return
    this.toolInputs.set(id, tool)
    const identity = { type: 'dynamic-tool' as const, toolCallId: id, toolName: `ACP: ${tool.title}` }
    if (tool.status === 'completed' || tool.status === 'failed') {
      const { rawOutput, content, ...metadata } = tool
      const output = rawOutput ?? content ?? tool.status
      const fromContent = rawOutput == null && content && tool.status === 'completed'
      const localAcpTool = fromContent
        ? {
            ...metadata,
            resultField: 'content',
            diffPaths: content.flatMap((item) =>
              item &&
              typeof item === 'object' &&
              'type' in item &&
              item.type === 'diff' &&
              'path' in item &&
              typeof item.path === 'string'
                ? [item.path]
                : []
            )
          }
        : { ...metadata, content, ...(rawOutput != null && { resultField: 'rawOutput' }) }
      const input = { localAcpTool }
      this.publishToolPart(
        tool.status === 'failed'
          ? {
              ...identity,
              state: 'output-error',
              input,
              errorText: typeof output === 'string' ? output : JSON.stringify(output)
            }
          : { ...identity, state: 'output-available', input, output }
      )
    } else {
      this.publishToolPart({ ...identity, state: 'input-available', input: { localAcpTool: tool } })
    }
  }

  private publishTerminal(terminalId: string, delta?: Pick<ToolTerminalDelta, 'append' | 'drop' | 'truncated'>) {
    const terminal = this.terminals.get(terminalId)
    if (!terminal || !this.active) return
    for (const id of terminal.tools) {
      const tool = this.toolInputs.get(id)
      if (!tool || (delta && (tool.status === 'completed' || tool.status === 'failed'))) continue
      const next = this.withTerminal(tool, terminalId, terminal)
      if (!delta) {
        this.publishTool(id, next)
        continue
      }
      this.toolInputs.set(id, next)
      const slot = this.tools.get(id)
      if (slot) {
        this.events.push({
          type: 'local-tool-terminal',
          contextId: this.source.contextId,
          itemId: this.source.ref.id,
          part: slot.part,
          delta: { toolCallId: id, terminalId, ...delta }
        })
      }
    }
  }

  async send(input: AgentRuntimeUserInput) {
    const prompt = await acpContent(input, this.promptCapabilities)
    await this.configChange?.catch(() => {})
    this.begin(input)
    this.planPart = undefined
    this.planId = undefined
    try {
      if (!this.session) throw new Error('ACP session is not connected')
      this.publishSessionResumeToken()
      const model = this.localSessionInfo.activeModel?.id ?? null
      const { stopReason, usage, context } = await this.session.acp.runPrompt({
        inputId: runtimeId<'input'>(input.message.id),
        content: prompt
      })
      if (context) {
        this.hasContextUsageReading = true
        this.events.push({ type: 'context-usage', result: { status: 'confirmed', value: context } })
      } else if (!this.hasContextUsageReading) {
        this.hasContextUsageReading = true
        this.events.push({
          type: 'context-usage',
          result: {
            status: 'unsupported',
            error: {
              operation: 'contextUsage',
              code: 'unsupported',
              message: 'This agent does not report context usage'
            }
          }
        })
      }
      if (usage) this.publishTurnUsage(usage, this.session.thread.id, model)
      if (!this.localSessionInfo.protocolInfo?.verified.includes('prompt'))
        this.localSessionInfo.protocolInfo?.verified.push('prompt')
      const truncated = stopReason === 'max_tokens' || stopReason === 'max_turn_requests'
      if (this.headless && truncated) {
        this.finish(new Error(t('local_agent.scheduled_output_limit')))
        return
      }
      if (this.headless && stopReason === 'refusal') {
        this.finish(new Error(t('local_agent.scheduled_refusal')))
        return
      }
      this.finish(
        undefined,
        stopReason === 'cancelled'
          ? 'cancelled'
          : stopReason === 'refusal'
            ? 'content-filter'
            : truncated
              ? 'length'
              : stopReason === 'end_turn'
                ? 'stop'
                : 'other'
      )
    } catch (error) {
      this.finish(error)
    } finally {
      this.session?.acp.drainNativeTurn()
    }
  }
  private publishTurnUsage(usage: AcpTurnUsage, nativeSessionId: string, model: string | null): void {
    // ACP totals already include cached tokens.
    const cachedRead = usage.cachedReadTokens ?? 0
    const cachedWrite = usage.cachedWriteTokens ?? 0
    const summary = LocalAgentTurnUsageSchema.safeParse({
      nativeSessionId,
      model,
      reportedAt: Date.now(),
      correlation: this.gatewayLease ? 'gateway' : 'unknown',
      usage: {
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        totalTokens: usage.totalTokens,
        noCacheTokens: Math.max(0, usage.inputTokens - cachedRead - cachedWrite),
        ...(usage.thoughtTokens != null ? { reasoningTokens: usage.thoughtTokens } : {}),
        ...(usage.cachedReadTokens != null ? { cacheReadTokens: usage.cachedReadTokens } : {}),
        ...(usage.cachedWriteTokens != null ? { cacheWriteTokens: usage.cachedWriteTokens } : {})
      }
    })
    if (summary.success) this.events.push({ type: 'local-turn-usage', summary: summary.data })
  }

  protected override finish(error?: unknown, finishReason: FinishReason | 'cancelled' = 'stop') {
    this.approvedWrites.length = 0
    if (this.active) {
      for (const [id, tool] of this.toolInputs) {
        let final = tool
        for (const item of tool.content ?? []) {
          if (!item || typeof item !== 'object' || !('terminalId' in item) || typeof item.terminalId !== 'string')
            continue
          const terminal = this.terminals.get(item.terminalId)
          if (!terminal) continue
          terminal.tools.delete(id)
          if (
            tool.terminals?.[item.terminalId] !== terminal.output ||
            tool.terminalDetails?.[item.terminalId]?.truncated !== terminal.truncated
          )
            final = this.withTerminal(final, item.terminalId, terminal)
        }
        if (tool.status !== 'completed' && tool.status !== 'failed') {
          this.publishTool(id, { ...final, turnEnded: true })
        } else if (final !== tool) this.publishTool(id, final)
      }
      this.toolInputs.clear()
    }
    super.finish(acpError(error, this.process.stderr), finishReason)
  }
  protected override dispose() {
    void this.browserLease?.dispose().catch(() => {})
    this.browserLease = undefined
    void this.gatewayLease?.dispose()
    this.gatewayLease = undefined
    super.dispose()
  }
  protected async stop() {
    try {
      await Promise.all([
        ...[...this.terminals.values()].map((terminal) => stopLocalAgentProcess(terminal.child)),
        this.shutdownRuntime?.() ?? this.process.close()
      ])
      await this.waitForTurn()
    } finally {
      await this.session?.release()
      this.terminals.clear()
    }
  }
}
