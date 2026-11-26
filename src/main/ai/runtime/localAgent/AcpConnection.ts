import type { ChildProcess } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { once } from 'node:events'
import fs from 'node:fs/promises'
import path from 'node:path'

import type { FinishReason } from 'ai'

import { application } from '@application'
import {
  acpHostError,
  acpModelCatalog,
  connectAcpStdio,
  type AcpHarnessSession,
  type AcpClientCallbacks,
  type AcpMcpServer,
  type AcpPromptCapabilities,
  type AcpSession,
  type AcpSessionConfiguration,
  type AcpSessionUpdate
} from '@cherrystudio/agent-runtime-acp/v1'
import { loggerService } from '@logger'
import { t } from '@main/i18n'
import { findExecutableInEnv } from '@main/utils/commandResolver'
import { crossPlatformSpawn } from '@main/utils/processRunner'
import { AgentSessionCostSnapshotSchema } from '@shared/ai/agentSessionCost'
import { isOpenClawTechnicalTitle } from '@shared/ai/agentSessionTopic'
import {
  ElicitationFormSchema,
  elicitationChoices,
  elicitationValidator,
  type ElicitationContent
} from '@shared/ai/elicitation'
import {
  DSH_LOCAL_MODE_ID,
  DSH_LOCAL_MODE_OPTIONS,
  isLocalAllowDecision,
  type LocalAcpTool,
  type LocalPermissionOption
} from '@shared/ai/localAgent'
import { resolveEffectiveLocalPermissionMode } from '@shared/ai/localAgentPermission'
import { LocalAgentTurnUsageSchema } from '@shared/ai/localAgentUsage'

import type { AgentRuntimeUserInput } from '../types'
import { acpError } from './acpError'
import { localAcpHarness } from './acpHarness'
import {
  classifyAcpToolKind,
  createAcpSessionPermissionGrants,
  evaluateAcpClientTerminal,
  evaluateAcpClientWrite,
  evaluateAcpPermissionRequest,
  isPathWithinWorkspace,
  recordAcpAlwaysAllowGrant,
  selectAutoAllowPermissionOption
} from './acpPermissionPolicy'
import { AcpProcess } from './AcpProcess'
import { acpProtocolInfo } from './acpSessionInfo'
import {
  buildAntigravityUserInputRequest,
  isAntigravityUserInputRequest,
  mapAcpPermissionOptions,
  resolveAntigravityUserInputOptionId
} from './antigravityProtocol'
import {
  acquireLocalAgentBrowserLease,
  isHostBrowserControlAllowed,
  isInjectedAcpAutomationTool,
  LOCAL_AGENT_AUTOMATION_SERVER_NAME
} from './browserBridge'
import { bindLocalGatewayUsage } from './gatewayUsage'
import { resolveLocalAgentLaunch } from './launch'
import type { LocalAgentBrowserLease } from './LocalAgentMcpBridgeService'
import { stopLocalAgentProcess } from './localAgentProcess'
import { LocalAgentSessionRestoreError } from './LocalAgentSessionRestoreError'
import { LocalConnection } from './LocalConnection'
import { acpContent } from './localContent'
import { resolveLocalModelContextWindow } from './modelContextWindow'
import { resolveConfiguredAcpModel } from './nativeModelConfig'
import { buildStdioHttpMcpShimConfig } from './stdioHttpMcpShim'

const logger = loggerService.withContext('AcpConnection')
const HOST_ALLOW_SESSION_OPTION_ID = '__cherry_allow_session__'
const HOST_SCOPED_PERMISSION_OPTIONS: LocalPermissionOption[] = [
  { optionId: 'allow', decision: 'accept', label: 'allow', name: 'Allow' },
  { optionId: 'allow_session', decision: 'acceptForSession', label: 'allow_session', name: 'Allow for session' },
  { optionId: 'deny', decision: 'decline', label: 'deny', name: 'Deny' }
]

function isAcpThoughtLevelOption(option: NonNullable<AcpSessionConfiguration['configOptions']>[number]): boolean {
  return option.type === 'select' && (option.category === 'thought_level' || option.category === 'thinking')
}
type Terminal = {
  child: ChildProcess
  output: string
  truncated: boolean
  exitStatus?: { exitCode?: number; signal?: string }
  exited: Promise<{ exitCode?: number; signal?: string }>
}

export class AcpConnection extends LocalConnection {
  private gatewayLease?: { dispose: () => void | Promise<void> }
  private browserLease?: LocalAgentBrowserLease
  private defaultModel?: string
  private launchNativeModel?: string
  private readonly process = new AcpProcess()
  private promptCapabilities: AcpPromptCapabilities = {}
  private messageId?: string
  private session?: AcpSession
  private readonly terminals = new Map<string, Terminal>()
  private readonly harness = localAcpHarness(
    this.config.presetId,
    async (target, tool, toolInput, requestSignal, settle) => {
      const turn = this.turnAbort.signal
      if (
        !this.active ||
        this.loading ||
        target.sessionId !== this.session?.id ||
        turn.aborted ||
        this.abort.signal.aborted ||
        requestSignal.aborted
      )
        return settle({ approved: false }).reply
      if (this.headless) return settle(this.denyUnattendedRequest()).reply
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
  private harnessSession?: AcpHarnessSession
  private loading = false
  private modelConfigId?: string
  private configChange?: Promise<void>
  private modeConfigId?: string
  private legacyMode?: NonNullable<AcpSessionConfiguration['modes']>
  private readonly compactions = new Map<string, boolean>()
  private planPart?: number
  private planId?: string
  private pendingUpdates: Array<{ sessionId: string; update: AcpSessionUpdate }> = []
  private readonly approvedWrites: Array<{ path: string; content: string }> = []
  private readonly permissionGrants = createAcpSessionPermissionGrants()
  private readonly toolInputs = new Map<string, LocalAcpTool>()
  private reportedContextUsageThisTurn = false
  private hasContextUsageReading = false

  get inspectContextUsage() {
    return this.harnessSession?.inspectContextUsage
  }

  get predictPrompt() {
    return this.harnessSession?.predictPrompt
  }

  private effectivePermissionMode() {
    return resolveEffectiveLocalPermissionMode(this.localSessionInfo, this.config.presetId)
  }

  // Reaping a non-resumable process would lose access to its native session.
  get retainWhileIdle(): boolean {
    return this.localSessionInfo.resume !== true
  }

  async start(cwd: string, resume?: string): Promise<this> {
    try {
      return await this.startConnection(cwd, resume)
    } catch (error) {
      throw acpError(error, this.process.stderr)
    }
  }
  private async startConnection(cwd: string, resume?: string): Promise<this> {
    const launch = await resolveLocalAgentLaunch(this.config, this.abort.signal)
    let dshPermissionMode: (typeof DSH_LOCAL_MODE_OPTIONS)[number]['value'] | undefined
    if (this.config.presetId === 'deepseek-harness') {
      let savedModeValue: string | undefined
      try {
        const savedMode = application.get('CacheService').getPersist?.('local_agent.session_overrides')?.[
          this.sessionId
        ]?.mode
        if (savedMode?.configId === DSH_LOCAL_MODE_ID) savedModeValue = savedMode.value
      } catch {
        // Standalone unit tests may construct AcpConnection without booting CacheService.
      }
      const envMode = this.config.env.DSH_PERMISSION_MODE
      const candidate = savedModeValue ?? envMode ?? 'workspace-write'
      const matched = DSH_LOCAL_MODE_OPTIONS.find((item) => item.value === candidate)
      dshPermissionMode = matched?.value ?? 'workspace-write'
      launch.env.DSH_PERMISSION_MODE = dshPermissionMode
    }
    if (this.config.presetId === 'deepseek-harness' && !this.config.env.DSH_HOME) {
      const usesDefaultProfile = launch.args.length === 2 && launch.args[0] === '--profile' && launch.args[1] === 'acp'
      const prepared = await application
        .get('DeepSeekHarnessService')
        .prepareAgent(usesDefaultProfile ? this.sessionId : undefined)
      if (prepared?.gateway) {
        if (this.abort.signal.aborted) {
          await prepared.gateway.dispose()
          this.abort.signal.throwIfAborted()
        }
        this.gatewayLease = prepared.gateway
        launch.args = [...launch.args, '--patch', prepared.gateway.patchPath]
        Object.assign(launch.env, prepared.gateway.env)
      }
      launch.nativeModel = prepared?.nativeModel
    }
    if (!this.gatewayLease) {
      const lease = await bindLocalGatewayUsage(this.config, this.sessionId, launch.env)
      if (this.abort.signal.aborted) {
        lease?.dispose()
        this.abort.signal.throwIfAborted()
      }
      this.gatewayLease = lease
    }
    this.launchNativeModel = launch.nativeModel
    if (this.config.presetId === 'cline') {
      this.defaultModel = launch.env.CLINE_MODEL || undefined
    } else {
      this.defaultModel =
        this.config.presetId === 'deepseek-harness'
          ? (launch.nativeModel ?? this.config.nativeModel)
          : (this.config.nativeModel ?? launch.nativeModel)
    }
    this.abort.signal.throwIfAborted()
    const client = await this.process.open(
      this.config,
      launch,
      cwd,
      this.abort.signal,
      (stdin, stdout, clientInfo) =>
        connectAcpStdio(stdin, stdout, {
          clientInfo,
          // Antigravity owns its native diff edits.
          denyMutation:
            this.headless || this.config.presetId === 'antigravity-acp'
              ? (id) => {
                  this.requireSession(id)
                  return acpHostError.invalidRequest(
                    this.headless ? this.denyUnattendedRequest().reason : 'Host writes and terminals are disabled'
                  )
                }
              : undefined,
          callbacks: this.hostCallbacks(cwd, launch.env),
          update: (params) => {
            if (this.loading) {
              if (
                params.update.sessionUpdate === 'available_commands_update' ||
                params.update.sessionUpdate === 'config_option_update' ||
                params.update.sessionUpdate === 'usage_update' ||
                params.update.sessionUpdate === 'session_info_update' ||
                params.update.sessionUpdate === 'notice' ||
                params.update.sessionUpdate === 'current_mode_update' ||
                params.update.sessionUpdate === this.harness?.setupUpdate
              )
                this.pendingUpdates.push(params)
            } else if (params.sessionId === this.session?.id) this.update(params.update)
          },
          harness: this.harness
        }),
      (error) => {
        this.finish(error)
        this.dispose()
      }
    )
    const agent = await client.initialize()
    const { response } = agent
    this.localSessionInfo.protocolInfo = acpProtocolInfo(response)
    logger.info('ACP handshake completed', {
      agentId: this.agentId,
      protocolVersion: response.protocolVersion,
      agent: this.localSessionInfo.protocolInfo.agent
    })
    // OpenClaw resume loses bridge UUID mappings across processes; load reads its persisted ledger.
    const restore = this.config.presetId === 'openclaw' ? (agent.load ?? agent.resume) : (agent.resume ?? agent.load)
    this.localSessionInfo.resume = !!restore
    this.promptCapabilities = response.agentCapabilities?.promptCapabilities ?? {}
    this.localSessionInfo.images = this.promptCapabilities.image === true
    this.localSessionInfo.audio = this.promptCapabilities.audio === true
    this.browserLease = await acquireLocalAgentBrowserLease({
      sessionId: this.sessionId,
      agentId: this.agentId,
      config: this.config,
      headless: this.headless,
      signal: this.abort.signal,
      isReadOnly: () => this.effectivePermissionMode() === 'plan'
    })
    const mcpServers = this.buildBrowserMcpServers(response.agentCapabilities?.mcpCapabilities?.http === true)
    this.loading = true
    try {
      if (resume && !restore)
        throw new LocalAgentSessionRestoreError(
          'This agent cannot restore the previous conversation; create a new session'
        )
      const { configuration, session } =
        resume && restore
          ? await restore({ cwd, sessionId: resume, mcpServers })
          : await agent.create({ cwd, mcpServers })
      this.session = session
      this.legacyMode = configuration.modes ?? undefined
      this.readConfigOptions(configuration.configOptions, session.legacyModels)
      this.harnessSession = session.bindHarness(() => this.localSessionInfo.activeModel?.id)
      for (const pending of this.pendingUpdates.splice(0)) {
        if (pending.sessionId === this.session?.id) this.update(pending.update)
      }
      if (this.defaultModel && this.config.sourceModelId) {
        this.defaultModel = resolveConfiguredAcpModel(
          this.config.presetId,
          this.defaultModel,
          (this.localSessionInfo.models ?? []).map((model) => model.id)
        )
      }
      if (this.defaultModel && this.localSessionInfo.activeModel?.id !== this.defaultModel) {
        const allowUnlistedModelSelection = this.config.presetId === 'cline' && Boolean(this.modelConfigId)
        if (
          !allowUnlistedModelSelection &&
          this.localSessionInfo.models?.length &&
          !this.localSessionInfo.models.some((model) => model.id === this.defaultModel)
        )
          throw new Error(t('local_agent.model_unavailable', { model: this.defaultModel }))
        if (this.modelConfigId) {
          const updated = await session.setConfigOption(this.modelConfigId, this.defaultModel)
          this.readConfigOptions(updated.configOptions)
        } else if (session.legacyModels) {
          await session.legacyModels.select(this.defaultModel)
          this.localSessionInfo.activeModel = { id: this.defaultModel }
        } else if (
          this.config.presetId === 'snow' &&
          this.launchNativeModel &&
          this.defaultModel === this.launchNativeModel &&
          !this.localSessionInfo.models?.length
        ) {
          // Snow follows its native config without advertising a model selector.
          this.localSessionInfo.activeModel = { id: this.defaultModel }
        } else throw new Error('This agent does not support model selection')
      }
      if (dshPermissionMode && !this.localSessionInfo.mode) {
        this.localSessionInfo.mode = {
          id: DSH_LOCAL_MODE_ID,
          currentValue: dshPermissionMode,
          options: DSH_LOCAL_MODE_OPTIONS.map((option) => ({ ...option }))
        }
      }
      this.localSessionInfo.protocolInfo.verified.push('session')
      this.publishResumeToken(session.id)
    } finally {
      this.loading = false
      for (const pending of this.pendingUpdates.splice(0)) {
        if (pending.sessionId === this.session?.id) this.update(pending.update)
      }
    }
    return this
  }
  private hostCallbacks(cwd: string, env: NodeJS.ProcessEnv): AcpClientCallbacks {
    return {
      elicitation: async (params, { signal: requestSignal }) => {
        if (params.mode !== 'form') throw acpHostError.invalidRequest('Unsupported elicitation mode')
        if (
          !this.active ||
          !('sessionId' in params) ||
          params.sessionId !== this.session?.id ||
          this.abort.signal.aborted
        )
          return { action: 'cancel' }
        const parsed = ElicitationFormSchema.safeParse(params.requestedSchema)
        if (!parsed.success) throw acpHostError.invalidRequest('Unsupported elicitation schema')
        let validator: ReturnType<typeof elicitationValidator>
        try {
          validator = elicitationValidator(parsed.data)
        } catch {
          throw acpHostError.invalidRequest('Invalid elicitation schema')
        }
        const questions = Object.entries(parsed.data.properties).map(([id, field]) => ({
          id,
          question: field.title ?? id,
          header: field.title ?? id,
          options: elicitationChoices(field),
          multiSelect: field.type === 'array'
        }))
        const id = randomUUID()
        const input = {
          questions: questions.length
            ? questions
            : [{ question: params.message, header: params.message, options: [], multiSelect: false }],
          elicitation: {
            schema: parsed.data,
            message: params.message,
            agentName: this.localSessionInfo.protocolInfo?.agent?.name ?? this.config.presetId ?? 'ACP'
          }
        }
        const signal = AbortSignal.any([this.turnAbort.signal, requestSignal])
        const answer = await this.approve(id, 'AskUserQuestion', input, signal)
        const validated = validator.safeParse(answer.updatedInput?.elicitationContent)
        const action =
          signal.aborted || this.abort.signal.aborted || answer.updatedInput?.elicitationAction === 'cancel'
            ? 'cancel'
            : !answer.approved
              ? 'decline'
              : validated.success
                ? 'accept'
                : 'cancel'
        const outcome =
          action === 'accept'
            ? ({ action, content: validated.data as ElicitationContent } as const)
            : ({ action } as const)
        if (this.active)
          this.result(id, {
            ...input,
            answers: action === 'accept' ? answer.updatedInput?.answers : {},
            elicitationOutcome: outcome
          })
        return outcome
      },
      permission: async (params, { signal: requestSignal }) => {
        if (!this.active || params.sessionId !== this.session?.id || this.abort.signal.aborted)
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
        const isAntigravity = this.config.presetId === 'antigravity-acp'
        if (isAntigravity && isAntigravityUserInputRequest(params)) {
          const input = buildAntigravityUserInputRequest(params)
          const answer = await this.approve(id, 'AskUserQuestion', input, signal)
          if (this.abort.signal.aborted || signal.aborted) return { outcome: { outcome: 'cancelled' } }
          const optionId = resolveAntigravityUserInputOptionId(params, answer.approved, answer.updatedInput)
          const outcome = optionId ? { outcome: 'selected' as const, optionId } : { outcome: 'cancelled' as const }
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
          (isInjectedAcpAutomationTool(tool) ||
            (previousTool != null &&
              classifyAcpToolKind(tool) === 'other' &&
              isInjectedAcpAutomationTool(previousTool)))
            ? 'allow'
            : evaluateAcpPermissionRequest({
                mode: this.effectivePermissionMode(),
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
          const promptOptions = mapAcpPermissionOptions(options, {
            isAntigravity,
            hostAllowSessionOptionId: HOST_ALLOW_SESSION_OPTION_ID
          })
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
          mode: this.effectivePermissionMode(),
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
            mode: this.effectivePermissionMode(),
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
            output: '',
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
            terminal.output += data
            const bytes = Buffer.from(terminal.output)
            if (bytes.length > limit) {
              let start = bytes.length - limit
              while ((bytes[start] & 0xc0) === 0x80) start++
              terminal.output = bytes.subarray(start).toString('utf8')
              terminal.truncated = true
            }
            this.publishTerminal(terminalId)
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
  async setConfigOption(configId: string, value: string | boolean) {
    return this.setSelection('config', configId, value)
  }
  async setMode(configId: string, value: string) {
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
    if (category === 'mode' && !this.modeConfigId && typeof value === 'string') {
      this.configChange = this.session.setMode(value).then(() => {
        if (this.legacyMode) this.legacyMode.currentModeId = value
        if (this.localSessionInfo.mode) this.localSessionInfo.mode.currentValue = value
        // oxlint-disable-next-line no-restricted-globals -- Snapshot mutable ACP session/tool state before queuing an event.
        this.events.push({ type: 'local-session-info', info: structuredClone(this.localSessionInfo) })
      })
    } else {
      this.configChange = this.session
        .setConfigOption(configId, value)
        .then((response) => this.readConfigOptions(response.configOptions))
    }
    try {
      await this.configChange
      return this.localSessionInfo
    } finally {
      this.configChange = undefined
    }
  }

  private readConfigOptions(
    options?: AcpSessionConfiguration['configOptions'],
    initialLegacy?: AcpSession['legacyModels']
  ) {
    if (options != null) this.legacyMode = undefined
    const mode = options?.find((option) => option.category === 'mode' && option.type === 'select')
    const thought = options?.find(isAcpThoughtLevelOption)
    this.localSessionInfo.configOptions =
      options
        ?.filter((option) => option.type === 'select' || option.type === 'boolean')
        .map((option) => {
          const { id, name, description, category } = option
          const role = option === mode ? ('mode' as const) : option === thought ? ('reasoning' as const) : undefined
          return {
            id,
            name,
            description,
            category,
            ...(role ? { role } : {}),
            ...(option.type === 'boolean'
              ? { type: 'boolean' as const, currentValue: option.currentValue }
              : { type: 'select' as const, currentValue: option.currentValue, options: option.options })
          }
        }) ?? undefined

    this.modeConfigId = mode?.id
    if (mode?.type === 'select') {
      this.localSessionInfo.mode = {
        id: mode.id,
        currentValue: mode.currentValue,
        options: mode.options
          .flatMap((option) => ('group' in option ? option.options : [option]))
          .map(({ value, name, description }) => ({ value, name, description: description ?? undefined }))
      }
    } else if (this.legacyMode) {
      this.localSessionInfo.mode = {
        id: 'legacy-mode',
        currentValue: this.legacyMode.currentModeId,
        options: this.legacyMode.availableModes.map(({ id, name, description }) => ({
          value: id,
          name,
          description: description ?? undefined
        }))
      }
    } else {
      this.localSessionInfo.mode = undefined
    }
    this.localSessionInfo.thoughtLevel =
      thought?.type === 'select'
        ? {
            id: thought.id,
            currentValue: thought.currentValue,
            options: thought.options
              .flatMap((option) => ('group' in option ? option.options : [option]))
              .map(({ value, name }) => ({ value, name }))
          }
        : undefined
    const catalog = acpModelCatalog(options, initialLegacy)
    this.modelConfigId = catalog.configId
    if (catalog.configId || initialLegacy || !this.session?.legacyModels) {
      this.localSessionInfo.activeModel = catalog.activeModel
      this.localSessionInfo.models = catalog.models
    }
    // oxlint-disable-next-line no-restricted-globals -- Snapshot mutable ACP session/tool state before queuing an event.
    this.events.push({ type: 'local-session-info', info: structuredClone(this.localSessionInfo) })
  }
  private requireSession(sessionId: string) {
    if (sessionId !== this.session?.id || this.closed || this.abort.signal.aborted)
      throw acpHostError.invalidRequest('Inactive ACP session')
  }
  private terminal(id: string): Terminal {
    const terminal = this.terminals.get(id)
    if (!terminal) throw new Error('Unknown session terminal')
    return terminal
  }
  private update(update: AcpSessionUpdate) {
    if (
      update.sessionUpdate === 'agent_message_chunk' &&
      update.content.type === 'text' &&
      this.harnessSession?.consumeAssistantText?.(update.content.text)
    )
      return

    if (update.sessionUpdate === 'compaction_update') {
      const { compactionId, status } = update
      if (!['in_progress', 'completed', 'failed', 'cancelled'].includes(status)) return
      const wasCompacting = [...this.compactions.values()].some(Boolean)
      if (status !== 'in_progress' || !this.compactions.has(compactionId))
        this.compactions.set(compactionId, status === 'in_progress')
      const isCompacting = [...this.compactions.values()].some(Boolean)
      if (!wasCompacting && isCompacting) this.events.push({ type: 'compaction-start' })
      if (wasCompacting && !isCompacting)
        this.events.push(
          status === 'failed' && update.error
            ? { type: 'compaction-error', error: update.error }
            : { type: 'compaction-complete' }
        )
      return
    }
    if (update.sessionUpdate === 'notice' && update.title.trim()) {
      this.events.push({
        type: 'notice',
        notice: {
          title: update.title,
          description: update.description ?? undefined,
          severity: update.severity === 'warning' || update.severity === 'error' ? update.severity : 'info'
        }
      })
    }
    if (
      update.sessionUpdate === 'session_info_update' &&
      update.title?.trim() &&
      !(this.config.presetId === 'openclaw' && isOpenClawTechnicalTitle(update.title))
    )
      this.events.push({ type: 'session-title', title: update.title })

    if (update.sessionUpdate === 'usage_update' && update.cost && this.session?.id) {
      const snapshot = AgentSessionCostSnapshotSchema.safeParse({
        nativeSessionId: this.session.id,
        reportedAt: Date.now(),
        cost: { amount: update.cost.amount, currency: update.cost.currency }
      })
      if (snapshot.success) this.events.push({ type: 'session-cost', snapshot: snapshot.data })
    }
    if (update.sessionUpdate === 'usage_update' && update.used >= 0) {
      const model = this.localSessionInfo.activeModel?.id ?? this.config.nativeModel ?? ''
      const contextWindow = update.size > 0 ? update.size : resolveLocalModelContextWindow(model)
      if (contextWindow) {
        this.reportedContextUsageThisTurn = true
        this.hasContextUsageReading = true
        this.events.push({
          type: 'context-usage',
          result: {
            status: 'confirmed',
            value: {
              model,
              revision: model,
              contextWindow,
              basis: 'current-context',
              used: { tokens: update.used, precision: 'reported' }
            }
          }
        })
      }
    }
    if (update.sessionUpdate === 'current_mode_update' && !this.modeConfigId && this.legacyMode) {
      this.legacyMode.currentModeId = update.currentModeId
      if (this.localSessionInfo.mode) this.localSessionInfo.mode.currentValue = update.currentModeId
      // oxlint-disable-next-line no-restricted-globals -- Snapshot mutable ACP session/tool state before queuing an event.
      this.events.push({ type: 'local-session-info', info: structuredClone(this.localSessionInfo) })
    }
    if (
      this.active &&
      (update.sessionUpdate === 'agent_thought_chunk' || update.sessionUpdate === 'agent_message_chunk')
    ) {
      const messageId = update.messageId ?? undefined
      if (messageId !== this.messageId) this.endContent()
      this.messageId = messageId
      const reasoning = update.sessionUpdate === 'agent_thought_chunk'
      if (update.content.type === 'text')
        this.content(
          update.content.text,
          reasoning ? 'reasoning' : 'text',
          messageId !== undefined ? { acp: { messageId } } : undefined
        )
      else {
        this.endContent()
        this.putData({
          type: 'data-acp-content',
          id: randomUUID(),
          data: { content: update.content, reasoning, ...(messageId !== undefined ? { messageId } : {}) }
        })
      }
    }
    if (update.sessionUpdate === 'plan' && this.active) {
      this.endContent()
      this.planId ??= randomUUID()
      this.planPart = this.putData(
        { type: 'data-agent-plan', id: this.planId, data: { entries: update.entries } },
        this.planPart
      )
    }
    if (update.sessionUpdate === 'config_option_update') this.readConfigOptions(update.configOptions)
    if ((update.sessionUpdate === 'tool_call' || update.sessionUpdate === 'tool_call_update') && this.active) {
      const owner = this.tools.get(update.toolCallId)?.value.toolName
      if (owner === 'AskUserQuestion' || owner === 'ExitPlanMode') return
      this.endContent()
      const previous = this.toolInputs.get(update.toolCallId)
      const tool: LocalAcpTool = { title: 'Tool', ...previous }
      for (const key of ['title', 'name', 'kind', 'status', 'content', 'locations', 'rawInput', 'rawOutput'] as const) {
        if (update[key] != null) Object.assign(tool, { [key]: update[key] })
      }
      this.toolInputs.set(update.toolCallId, tool)
      this.publishTool(update.toolCallId, tool)
    }
    if (update.sessionUpdate === 'available_commands_update')
      this.publishCommands(
        update.availableCommands.map((c) => ({
          name: c.name,
          description: c.description,
          argumentHint: c.input?.hint ?? ''
        }))
      )
  }
  private publishTool(id: string, tool: LocalAcpTool) {
    if (!this.active) return
    for (const item of tool.content ?? []) {
      if (typeof item === 'object' && item !== null && 'terminalId' in item && typeof item.terminalId === 'string') {
        const terminal = this.terminals.get(item.terminalId)
        if (terminal) {
          tool.terminals = { ...tool.terminals, [item.terminalId]: terminal.output }
          tool.terminalDetails = {
            ...tool.terminalDetails,
            [item.terminalId]: { truncated: terminal.truncated, ...terminal.exitStatus }
          }
        }
      }
    }
    // oxlint-disable-next-line no-restricted-globals -- Snapshot mutable ACP session/tool state before queuing an event.
    this.tool(id, `ACP: ${tool.title}`, { localAcpTool: structuredClone(tool) }, true)
    if (tool.status === 'completed' || tool.status === 'failed')
      this.result(id, tool.rawOutput ?? tool.content ?? tool.status, tool.status === 'failed')
  }

  private publishTerminal(terminalId: string) {
    for (const [id, tool] of this.toolInputs) {
      if (
        tool.content?.some(
          (item) => typeof item === 'object' && item !== null && 'terminalId' in item && item.terminalId === terminalId
        )
      )
        this.publishTool(id, tool)
    }
  }

  async send(input: AgentRuntimeUserInput) {
    const prompt = await acpContent(input, this.promptCapabilities)
    await this.configChange?.catch(() => {})
    this.planPart = undefined
    this.planId = undefined
    this.toolInputs.clear()
    this.reportedContextUsageThisTurn = false
    this.begin(input.message.id)
    try {
      if (!this.session) throw new Error('ACP session is not connected')
      const model = this.localSessionInfo.activeModel?.id ?? null
      const { response, usage } = await this.session.prompt(
        prompt,
        this.config.presetId === 'openclaw' ? { prefixCwd: false } : this.harnessSession?.promptMeta
      )
      const lastRequest = this.harnessSession?.contextAfterPrompt?.(response, input.message.id)
      if (lastRequest) {
        this.reportedContextUsageThisTurn = true
        this.hasContextUsageReading = true
        this.events.push({ type: 'context-usage', result: { status: 'confirmed', value: lastRequest } })
      } else if (!this.reportedContextUsageThisTurn) {
        const contextWindow = usage ? resolveLocalModelContextWindow(model) : undefined
        if (usage && contextWindow) {
          this.hasContextUsageReading = true
          this.events.push({
            type: 'context-usage',
            result: {
              status: 'confirmed',
              value: {
                model: model ?? '',
                revision: model ?? '',
                contextWindow,
                basis: 'last-request',
                used: { tokens: usage.inputTokens, precision: 'reported' }
              }
            }
          })
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
      }
      if (usage) {
        // ACP totals already include cached tokens.
        const cachedRead = usage.cachedReadTokens ?? 0
        const cachedWrite = usage.cachedWriteTokens ?? 0
        const summary = LocalAgentTurnUsageSchema.safeParse({
          nativeSessionId: this.session.id,
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
      if (!this.localSessionInfo.protocolInfo?.verified.includes('prompt'))
        this.localSessionInfo.protocolInfo?.verified.push('prompt')
      const truncated = response.stopReason === 'max_tokens' || response.stopReason === 'max_turn_requests'
      if (this.headless && truncated) {
        this.finish(new Error(t('local_agent.scheduled_output_limit')))
        return
      }
      if (this.headless && response.stopReason === 'refusal') {
        this.finish(new Error(t('local_agent.scheduled_refusal')))
        return
      }
      this.finish(
        undefined,
        response.stopReason === 'cancelled'
          ? 'cancelled'
          : response.stopReason === 'refusal'
            ? 'content-filter'
            : truncated
              ? 'length'
              : response.stopReason === 'end_turn'
                ? 'stop'
                : 'other'
      )
    } catch (error) {
      this.finish(error)
    }
  }
  private clearCompaction() {
    if ([...this.compactions.values()].some(Boolean)) this.events.push({ type: 'compaction-complete' })
    this.compactions.clear()
  }
  protected override finish(error?: unknown, finishReason: FinishReason | 'cancelled' = 'stop') {
    this.approvedWrites.length = 0
    if (this.active) {
      for (const [id, tool] of this.toolInputs) {
        if (tool.status !== 'completed' && tool.status !== 'failed') {
          tool.turnEnded = true
          this.publishTool(id, tool)
        }
      }
    }
    this.clearCompaction()
    super.finish(acpError(error, this.process.stderr), finishReason)
  }
  protected override dispose() {
    this.clearCompaction()
    void this.browserLease?.dispose().catch(() => {})
    this.browserLease = undefined
    void this.gatewayLease?.dispose()
    this.gatewayLease = undefined
    super.dispose()
  }
  protected async stop() {
    if (this.active && this.session) {
      await this.session.cancel().catch(() => {})
      await this.waitForTurn()
    }
    try {
      await Promise.all([
        ...[...this.terminals.values()].map((terminal) => stopLocalAgentProcess(terminal.child)),
        this.process.close(this.session?.close)
      ])
    } finally {
      this.terminals.clear()
    }
  }
}
