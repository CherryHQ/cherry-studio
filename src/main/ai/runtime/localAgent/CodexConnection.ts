import type { ChildProcess } from 'node:child_process'
import { createInterface, type Interface } from 'node:readline'

import * as z from 'zod'

import { crossPlatformSpawn } from '@main/utils/processRunner'
import type { AgentSessionSlashCommand } from '@shared/ai/agentSessionSlashCommands'
import { LocalAgentTurnUsageSchema } from '@shared/ai/localAgentUsage'

import type { AgentRuntimeUserInput } from '../types'
import { bindLocalGatewayUsage } from './gatewayUsage'
import { resolveLocalAgentLaunch } from './launch'
import { LocalConnection } from './LocalConnection'
import { localContent } from './localContent'

const CODEX_SUPPORTED_COMMANDS: AgentSessionSlashCommand[] = [
  { name: 'clear', description: 'Start a new conversation with empty context', argumentHint: '', builtin: true },
  {
    name: 'compact',
    description: 'Free up context by summarizing the conversation so far',
    argumentHint: '',
    builtin: true
  },
  {
    name: 'usage',
    description: 'Show session cost, plan usage limits, and activity stats',
    argumentHint: '',
    builtin: true
  },
  { name: 'status', description: 'Show current session configuration and token usage', argumentHint: '' },
  { name: 'review', description: 'Review current changes and find issues', argumentHint: '[instructions]' },
  { name: 'diff', description: 'Show git diff (including untracked files)', argumentHint: '' },
  { name: 'init', description: 'Create an AGENTS.md file with instructions for Codex', argumentHint: '' },
  { name: 'mcp', description: 'List MCP tools and server status', argumentHint: '' },
  { name: 'skills', description: 'List skills available to Codex in this workspace', argumentHint: '' },
  { name: 'plan', description: 'Switch to Plan mode or outline a plan for a task', argumentHint: '[task]' },
  { name: 'fork', description: 'Fork the current chat into a new thread', argumentHint: '' },
  { name: 'undo', description: 'Undo the last turn in the current thread', argumentHint: '' },
  { name: 'rename', description: 'Rename the current thread', argumentHint: '<name>' },
  {
    name: 'goal',
    description: 'Set a goal to work toward until it is completed',
    argumentHint: '<goal>',
    builtin: true
  }
]

const CodexSkillsListSchema = z.object({
  data: z.array(
    z.object({
      skills: z.array(
        z.object({
          name: z.string(),
          description: z.string().optional(),
          shortDescription: z.string().optional(),
          path: z.string(),
          enabled: z.boolean().optional()
        })
      )
    })
  )
})

const RpcSchema = z.object({
  id: z.union([z.string(), z.number()]).optional(),
  method: z.string().optional(),
  params: z.record(z.string(), z.unknown()).optional(),
  result: z.unknown().optional(),
  error: z.object({ message: z.string() }).optional()
})
const ThreadSchema = z.object({ thread: z.object({ id: z.string() }) })
const ItemSchema = z.object({ id: z.string(), type: z.string() }).passthrough()

const CODEX_MODE_OPTIONS = [
  { value: 'readOnly', name: 'Read Only' },
  { value: 'workspace', name: 'Workspace' },
  { value: 'fullAccess', name: 'Full Access' }
] as const

type CodexModeValue = (typeof CODEX_MODE_OPTIONS)[number]['value']

const CODEX_TURN_MODE_PARAMS = {
  readOnly: {
    approvalPolicy: 'on-request' as const,
    sandboxPolicy: { type: 'readOnly' as const, networkAccess: false }
  },
  workspace: {
    approvalPolicy: 'on-request' as const,
    sandboxPolicy: {
      type: 'workspaceWrite' as const,
      writableRoots: [] as string[],
      networkAccess: false,
      excludeTmpdirEnvVar: false,
      excludeSlashTmp: false
    }
  },
  fullAccess: {
    approvalPolicy: 'never' as const,
    sandboxPolicy: { type: 'dangerFullAccess' as const }
  }
}

const tokenCount = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)
const TokenUsageSchema = z.object({
  inputTokens: tokenCount,
  outputTokens: tokenCount,
  totalTokens: tokenCount,
  cachedInputTokens: tokenCount,
  reasoningOutputTokens: tokenCount,
  cacheWriteInputTokens: tokenCount.optional()
})
const TokenUsageUpdateSchema = z.object({ total: TokenUsageSchema, last: TokenUsageSchema })

export class CodexConnection extends LocalConnection {
  private process?: ChildProcess
  private lines?: Interface
  private nextId = 0
  private cwd = ''
  private threadId?: string
  private turnId?: string
  private compacting = false
  private gatewayLease?: { dispose: () => void }
  private modeOverride?: CodexModeValue
  private readonly turnHistory: string[] = []
  private usageBaseline?: z.infer<typeof TokenUsageSchema>
  private lastTokenUsage?: z.infer<typeof TokenUsageSchema>
  private skillsLoaded = false
  private readonly skillByName = new Map<string, { name: string; path: string; description: string }>()
  private readonly approvalItems = new Map<string, z.infer<typeof ItemSchema>>()
  private readonly pending = new Map<
    number,
    { resolve: (value: unknown) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }
  >()

  override async getSupportedCommands(): Promise<AgentSessionSlashCommand[] | null> {
    if (!this.skillsLoaded && !this.closed && this.threadId) {
      this.skillsLoaded = true
      try {
        const parsed = CodexSkillsListSchema.safeParse(
          await this.request('skills/list', { cwds: this.cwd ? [this.cwd] : [] })
        )
        if (parsed.success) {
          const seen = new Set(CODEX_SUPPORTED_COMMANDS.map((cmd) => cmd.name))
          const dynamicSkillCommands: AgentSessionSlashCommand[] = []
          for (const entry of parsed.data.data) {
            for (const skill of entry.skills) {
              if (skill.enabled === false) continue
              const description = (skill.shortDescription || skill.description || '').trim()
              this.skillByName.set(skill.name, { name: skill.name, path: skill.path, description })
              if (seen.has(skill.name)) continue
              seen.add(skill.name)
              dynamicSkillCommands.push({
                name: skill.name,
                description,
                argumentHint: ''
              })
            }
          }
          this.supportedCommands = [...CODEX_SUPPORTED_COMMANDS, ...dynamicSkillCommands]
        }
      } catch {
        // Keep built-in Codex commands if skills/list is unsupported by an older binary.
      }
    }
    return this.supportedCommands
  }

  async start(cwd: string, resume?: string, probe: boolean | 'models' = false): Promise<this> {
    this.cwd = cwd
    const launch = await resolveLocalAgentLaunch(this.config, this.abort.signal)
    if (!probe) this.gatewayLease = await bindLocalGatewayUsage(this.config, this.sessionId, launch.env)
    this.abort.signal.throwIfAborted()
    const child = crossPlatformSpawn(launch.executable, launch.args, {
      cwd,
      env: launch.env,
      detached: process.platform !== 'win32'
    })
    this.process = child
    if (!child.stdout || !child.stdin) throw new Error('Codex stdio is unavailable')
    child.stderr?.resume()
    const failed = (error: Error) => {
      this.rejectPending(error)
      this.finish(error)
      this.dispose()
    }
    child.on('error', failed)
    child.on('exit', () => failed(new Error('Codex process exited')))
    this.lines = createInterface({ input: child.stdout })
    this.lines.on('line', (line) => {
      void this.receive(line).catch(failed)
    })
    await this.request('initialize', { clientInfo: { name: 'cherry_studio', title: 'Cherry Studio', version: '1' } })
    this.write({ method: 'initialized' })
    this.localSessionInfo.resume = true
    this.localSessionInfo.images = true
    if (probe === true) return this
    const models: Array<{ id: string; model?: string; displayName: string; inputModalities?: string[] }> = []
    let cursor: string | null = null
    do {
      const catalog = z
        .object({
          data: z.array(
            z.object({
              id: z.string(),
              model: z.string().optional(),
              displayName: z.string(),
              inputModalities: z.array(z.string()).optional()
            })
          ),
          nextCursor: z.string().nullish()
        })
        .parse(await this.request('model/list', { cursor }))
      models.push(...catalog.data)
      cursor = catalog.nextCursor ?? null
    } while (cursor)
    this.localSessionInfo.models = models.map((model) => ({ id: model.model ?? model.id, name: model.displayName }))
    if (probe === 'models') return this
    const threadParams = {
      cwd,
      ...(this.config.nativeModel ? { model: this.config.nativeModel } : {})
    }
    const response = resume
      ? await this.request('thread/resume', { threadId: resume, ...threadParams }).catch(async (error: unknown) => {
          if (error instanceof Error && /no rollout found/i.test(error.message)) {
            return await this.request('thread/start', threadParams)
          }
          throw error
        })
      : await this.request('thread/start', threadParams)
    const threadMeta = z
      .object({
        model: z.string().optional(),
        approvalPolicy: z.unknown().optional(),
        sandbox: z.object({ type: z.string().optional() }).passthrough().optional()
      })
      .parse(response)
    const nativeModel = threadMeta.model
    if (nativeModel) this.localSessionInfo.activeModel = { id: nativeModel }
    const selected = models.find((model) => (model.model ?? model.id) === nativeModel)
    this.localSessionInfo.images = (selected?.inputModalities ?? ['text', 'image']).includes('image')
    const initialMode: CodexModeValue =
      this.modeOverride ??
      (threadMeta.sandbox?.type === 'dangerFullAccess' && threadMeta.approvalPolicy === 'never'
        ? 'fullAccess'
        : threadMeta.sandbox?.type === 'readOnly'
          ? 'readOnly'
          : 'workspace')
    this.localSessionInfo.mode = {
      id: 'codex-mode',
      currentValue: initialMode,
      options: CODEX_MODE_OPTIONS.map((option) => ({ ...option }))
    }
    this.threadId = ThreadSchema.parse(response).thread.id
    this.supportedCommands = CODEX_SUPPORTED_COMMANDS
    this.events.push({ type: 'resume-token', token: this.threadId })
    return this
  }

  async setMode(configId: string, value: string) {
    if (this.closed || this.active) throw new Error('Codex session is unavailable or busy')
    const option = CODEX_MODE_OPTIONS.find((item) => item.value === value)
    if (configId !== 'codex-mode' || !option || !this.localSessionInfo.mode) {
      throw new Error('This session option is no longer available')
    }
    this.modeOverride = option.value
    this.localSessionInfo.mode.currentValue = option.value
    // oxlint-disable-next-line no-restricted-globals -- Snapshot mutable Codex session state before queuing an event.
    this.events.push({ type: 'local-session-info', info: structuredClone(this.localSessionInfo) })
    return this.localSessionInfo
  }
  private write(message: unknown) {
    if (!this.process?.stdin?.writable) throw new Error('Codex connection is closed')
    this.process.stdin.write(JSON.stringify(message) + '\n')
  }
  private request(method: string, params: unknown): Promise<unknown> {
    const id = ++this.nextId
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`Codex request timed out: ${method}`))
      }, 30000)
      this.pending.set(id, { resolve, reject, timer })
      try {
        this.write({ id, method, params })
      } catch (error) {
        clearTimeout(timer)
        this.pending.delete(id)
        reject(error)
      }
    })
  }
  private async receive(line: string) {
    const message = RpcSchema.parse(JSON.parse(line))
    if (!message.method && typeof message.id === 'number') {
      const pending = this.pending.get(message.id)
      if (!pending) return
      clearTimeout(pending.timer)
      this.pending.delete(message.id)
      if (message.error) pending.reject(new Error(message.error.message))
      else pending.resolve(message.result)
      return
    }
    const params = message.params ?? {}
    if (message.id !== undefined && message.method) {
      if (params.threadId && params.threadId !== this.threadId) {
        this.write({ id: message.id, error: { code: -32602, message: 'Unknown thread' } })
        return
      }
      if (
        message.method === 'item/commandExecution/requestApproval' ||
        message.method === 'item/fileChange/requestApproval'
      ) {
        const decisions = z
          .array(
            z.union([
              z.enum(['accept', 'acceptForSession', 'decline', 'cancel']),
              z.object({ acceptWithExecpolicyAmendment: z.object({ execpolicy_amendment: z.array(z.string()) }) }),
              z.object({
                applyNetworkPolicyAmendment: z.object({
                  network_policy_amendment: z.object({ host: z.string(), action: z.enum(['allow', 'deny']) })
                })
              })
            ])
          )
          .parse(params.availableDecisions ?? ['accept', 'acceptForSession', 'decline', 'cancel'])
        const formatDecisionName = (decision: (typeof decisions)[number]) => {
          if (typeof decision === 'string') return decision
          if ('acceptWithExecpolicyAmendment' in decision) {
            return `Always allow: ${decision.acceptWithExecpolicyAmendment.execpolicy_amendment.join(' ')}`
          }
          const { host, action } = decision.applyNetworkPolicyAmendment.network_policy_amendment
          return `${action === 'allow' ? 'Always allow' : 'Always deny'} host: ${host}`
        }
        const options = decisions.map((decision) => ({
          optionId: typeof decision === 'string' ? decision : JSON.stringify(decision),
          name: formatDecisionName(decision),
          label:
            typeof decision !== 'string'
              ? undefined
              : decision === 'accept'
                ? 'allow'
                : decision === 'acceptForSession'
                  ? 'allow_session'
                  : decision === 'decline'
                    ? 'deny'
                    : 'cancel',
          kind:
            typeof decision !== 'string'
              ? 'applyNetworkPolicyAmendment' in decision &&
                decision.applyNetworkPolicyAmendment.network_policy_amendment.action === 'deny'
                ? 'reject_always'
                : 'allow_always'
              : decision === 'acceptForSession'
                ? 'allow_always'
                : decision === 'accept'
                  ? 'allow_once'
                  : 'reject_once'
        }))
        const answer = await this.approve(
          String(params.itemId),
          message.method.includes('command') ? 'Codex: Command' : 'Codex: File change',
          { ...this.approvalItems.get(String(params.itemId)), ...params, localPermissionOptions: options }
        )
        const requested = answer.updatedInput?.localPermissionOption
        const index = options.findIndex(
          (option) => option.optionId === requested && option.kind.startsWith(answer.approved ? 'allow_' : 'reject_')
        )
        const decision = this.abort.signal.aborted
          ? 'cancel'
          : index >= 0
            ? decisions[index]
            : answer.approved && decisions.includes('accept')
              ? 'accept'
              : 'decline'
        this.write({ id: message.id, result: { decision } })
      } else if (message.method === 'item/permissions/requestApproval') {
        const answer = await this.approve(String(params.itemId), 'Codex: Permissions', params)
        this.write({
          id: message.id,
          result: {
            permissions: answer.approved && !this.abort.signal.aborted ? params.permissions : {},
            scope: 'turn'
          }
        })
      } else this.write({ id: message.id, error: { code: -32601, message: 'Unsupported client request' } })
      return
    }
    if (params.threadId && params.threadId !== this.threadId) return
    if (message.method === 'item/agentMessage/delta' && typeof params.delta === 'string') this.content(params.delta)
    if (message.method === 'turn/started') {
      const turn = z.object({ id: z.string() }).parse(params.turn)
      this.turnId = turn.id
    }
    if (message.method === 'thread/tokenUsage/updated' && this.active && params.turnId === this.turnId) {
      const parsed = TokenUsageUpdateSchema.safeParse(params.tokenUsage)
      if (!parsed.success || !this.threadId) return
      const { total, last } = parsed.data
      this.lastTokenUsage = total
      // Codex totals span the thread; last covers only the latest model request.
      this.usageBaseline ??= Object.fromEntries(
        Object.entries(total).map(([key, value]) => [key, value - (last[key as keyof typeof last] ?? 0)])
      ) as z.infer<typeof TokenUsageSchema>
      const usage = Object.fromEntries(
        Object.entries(total).map(([key, value]) => [
          key,
          value - (this.usageBaseline?.[key as keyof typeof total] ?? 0)
        ])
      ) as z.infer<typeof TokenUsageSchema>
      const summary = LocalAgentTurnUsageSchema.safeParse({
        nativeSessionId: this.threadId,
        model: this.localSessionInfo.activeModel?.id ?? null,
        reportedAt: Date.now(),
        correlation: this.gatewayLease ? 'gateway' : 'unknown',
        usage: {
          inputTokens: usage.inputTokens,
          outputTokens: usage.outputTokens,
          totalTokens: usage.totalTokens,
          cacheReadTokens: usage.cachedInputTokens,
          noCacheTokens: usage.inputTokens - usage.cachedInputTokens - (usage.cacheWriteInputTokens ?? 0),
          reasoningTokens: usage.reasoningOutputTokens,
          ...(usage.cacheWriteInputTokens !== undefined ? { cacheWriteTokens: usage.cacheWriteInputTokens } : {})
        }
      })
      if (summary.success) this.events.push({ type: 'local-turn-usage', summary: summary.data })
    }
    if (message.method === 'item/started' || message.method === 'item/completed') {
      const item = ItemSchema.parse(params.item)
      if (item.type === 'contextCompaction') {
        if (message.method === 'item/started' && !this.compacting) {
          this.compacting = true
          this.events.push({ type: 'compaction-start' })
        } else if (message.method === 'item/completed') {
          if (this.compacting) {
            this.compacting = false
            this.events.push({ type: 'compaction-complete' })
          }
          this.content('Conversation context compacted.')
        }
      }
      if (message.method === 'item/completed') this.approvalItems.delete(item.id)
      else if (item.type === 'commandExecution' || item.type === 'fileChange') this.approvalItems.set(item.id, item)
      if (
        item.type === 'commandExecution' ||
        item.type === 'fileChange' ||
        item.type === 'mcpToolCall' ||
        item.type === 'webSearch'
      ) {
        this.tool(item.id, item.type, item)
        if (message.method === 'item/completed')
          this.result(item.id, item, item.status === 'failed' || item.status === 'declined')
      }
    }
    if (message.method === 'thread/compacted') {
      if (this.compacting) {
        this.compacting = false
        this.events.push({ type: 'compaction-complete' })
      }
    }
    if (message.method === 'turn/completed') {
      const turn = z
        .object({ id: z.string().optional(), status: z.string(), error: z.object({ message: z.string() }).nullish() })
        .parse(params.turn)
      const finishedTurnId = turn.id ?? this.turnId
      if (finishedTurnId && turn.status === 'completed') this.turnHistory.push(finishedTurnId)
      this.turnId = undefined
      if (this.compacting) {
        this.compacting = false
        this.events.push(
          turn.status === 'failed'
            ? { type: 'compaction-error', error: turn.error?.message ?? 'Codex compaction failed' }
            : { type: 'compaction-complete' }
        )
      }
      this.finish(
        turn.status === 'failed' ? new Error(turn.error?.message ?? 'Codex turn failed') : undefined,
        turn.status === 'interrupted' ? 'cancelled' : 'stop'
      )
    }
    if (message.method === 'error' && params.willRetry !== true)
      this.finish(new Error(z.object({ message: z.string() }).parse(params.error).message))
  }
  async send(input: AgentRuntimeUserInput) {
    const content = await localContent(input, this.localSessionInfo.images)
    const textOnly = content.length === 1 && content[0]?.type === 'text' ? content[0].text.trim() : undefined
    this.approvalItems.clear()
    this.usageBaseline = undefined
    this.begin()
    try {
      if (textOnly === '/clear' || textOnly === '/new') {
        const response = await this.request('thread/start', {
          cwd: this.cwd,
          ...(this.config.nativeModel ? { model: this.config.nativeModel } : {})
        })
        this.threadId = ThreadSchema.parse(response).thread.id
        this.lastTokenUsage = undefined
        this.turnHistory.length = 0
        this.events.push({ type: 'resume-token', token: this.threadId })
        this.content('Started a new conversation with empty context.')
        this.finish()
        return
      }
      if (textOnly && /^\/compact(?:\s|$)/i.test(textOnly)) {
        this.compacting = true
        this.events.push({ type: 'compaction-start' })
        try {
          await this.request('thread/compact/start', { threadId: this.threadId })
        } catch (error) {
          this.compacting = false
          if (error instanceof Error && /no rollout found/i.test(error.message)) {
            this.events.push({ type: 'compaction-complete' })
            this.content('Nothing to compact yet — send a message first.')
            this.finish()
            return
          }
          this.events.push({
            type: 'compaction-error',
            error: error instanceof Error ? error.message : String(error)
          })
          this.finish(error)
        }
        return
      }
      if (textOnly === '/usage' || textOnly === '/status') {
        const usageResult = await this.request('account/usage/read', { threadId: this.threadId }).catch(() => null)
        const lines: string[] = []
        if (textOnly === '/status') {
          lines.push(`Thread ID: ${this.threadId ?? 'unknown'}`)
          lines.push(`Working directory: ${this.cwd || 'unknown'}`)
        }
        if (this.localSessionInfo.activeModel?.id) lines.push(`Model: ${this.localSessionInfo.activeModel.id}`)
        if (this.lastTokenUsage) {
          lines.push(
            `Thread tokens: ${this.lastTokenUsage.totalTokens} total (${this.lastTokenUsage.inputTokens} input, ${this.lastTokenUsage.outputTokens} output, ${this.lastTokenUsage.cachedInputTokens} cached)`
          )
        } else if (usageResult && typeof usageResult === 'object') {
          lines.push(`Usage: ${JSON.stringify(usageResult)}`)
        } else {
          lines.push('No token usage recorded for this session yet.')
        }
        this.content(lines.join('\n'))
        this.finish()
        return
      }
      if (textOnly && /^\/review(?:\s|$)/i.test(textOnly)) {
        const instructions = textOnly.slice('/review'.length).trim()
        await this.request('review/start', {
          threadId: this.threadId,
          target: instructions ? { type: 'custom', instructions } : { type: 'uncommittedChanges' }
        })
        return
      }
      if (textOnly === '/diff') {
        const diffResult = await this.request('gitDiffToRemote', { cwd: this.cwd }).catch(() => null)
        let diff =
          diffResult && typeof diffResult === 'object' && 'diff' in diffResult && typeof diffResult.diff === 'string'
            ? diffResult.diff.trim()
            : ''
        if (!diff) {
          const execResult = await this.request('command/exec', {
            command: ['git', 'status', '--short'],
            cwd: this.cwd
          }).catch(() => null)
          if (
            execResult &&
            typeof execResult === 'object' &&
            'stdout' in execResult &&
            typeof execResult.stdout === 'string'
          ) {
            diff = execResult.stdout.trim()
          }
        }
        this.content(diff ? `\`\`\`diff\n${diff}\n\`\`\`` : 'No git diff reported.')
        this.finish()
        return
      }
      if (textOnly === '/mcp') {
        const mcpResult = await this.request('mcpServerStatus/list', {}).catch(() => null)
        const servers =
          mcpResult && typeof mcpResult === 'object' && 'data' in mcpResult && Array.isArray(mcpResult.data)
            ? (mcpResult.data as Array<{ name?: string; tools?: Record<string, unknown>; authStatus?: string }>)
            : []
        this.content(
          servers.length > 0
            ? servers
                .map(
                  (s) =>
                    `- **${s.name ?? 'server'}**: ${Object.keys(s.tools ?? {}).length} tools (${s.authStatus ?? 'ready'})`
                )
                .join('\n')
            : 'No MCP servers configured in Codex.'
        )
        this.finish()
        return
      }
      if (textOnly === '/skills') {
        await this.getSupportedCommands()
        this.content(
          this.skillByName.size > 0
            ? [...this.skillByName.values()]
                .map((s) => `- **/${s.name}**${s.description ? `: ${s.description}` : ''}`)
                .join('\n')
            : 'No Codex skills discovered in this workspace.'
        )
        this.finish()
        return
      }
      if (textOnly && /^\/rename(?:\s|$)/i.test(textOnly)) {
        const name = textOnly.slice('/rename'.length).trim()
        if (name && this.threadId) {
          await this.request('thread/name/set', { threadId: this.threadId, name }).catch((error: unknown) => {
            if (error instanceof Error && /no rollout found/i.test(error.message)) return null
            throw error
          })
          this.events.push({ type: 'session-title', title: name })
          this.content(`Renamed thread to "${name}".`)
        } else {
          this.content('Usage: /rename <name>')
        }
        this.finish()
        return
      }
      if (textOnly === '/fork' && this.threadId) {
        try {
          const response = await this.request('thread/fork', { threadId: this.threadId })
          this.threadId = ThreadSchema.parse(response).thread.id
          this.events.push({ type: 'resume-token', token: this.threadId })
          this.content(`Forked into thread ${this.threadId}.`)
        } catch (error) {
          if (error instanceof Error && /no rollout found/i.test(error.message)) {
            this.content('Send at least one message before forking this conversation.')
          } else {
            throw error
          }
        }
        this.finish()
        return
      }
      if (textOnly === '/undo' && this.threadId) {
        const beforeTurnId = this.turnHistory.pop()
        if (!beforeTurnId) {
          this.content('No previous turn to undo in this session.')
        } else {
          await this.request('thread/revert', { threadId: this.threadId, beforeTurnId })
          this.content('Reverted the last turn.')
        }
        this.finish()
        return
      }
      const skillMatch = textOnly?.match(/^\/([^\s]+)(?:\s+([\s\S]*))?$/)
      const matchedSkill = skillMatch ? this.skillByName.get(skillMatch[1]) : undefined
      const rewrittenText =
        textOnly && /^\/init(?:\s|$)/i.test(textOnly)
          ? `Create or update an AGENTS.md file with project architecture, build/test commands, and conventions. ${textOnly.slice('/init'.length).trim()}`.trim()
          : textOnly && /^\/plan(?:\s|$)/i.test(textOnly)
            ? `First outline a clear step-by-step plan before making changes: ${textOnly.slice('/plan'.length).trim()}`.trim()
            : matchedSkill
              ? skillMatch?.[2]?.trim() || `Use the ${matchedSkill.name} skill.`
              : undefined

      await this.request('turn/start', {
        threadId: this.threadId,
        ...(this.modeOverride ? CODEX_TURN_MODE_PARAMS[this.modeOverride] : {}),
        input: [
          ...(matchedSkill ? [{ type: 'skill', name: matchedSkill.name, path: matchedSkill.path }] : []),
          ...content.map((part) =>
            part.type === 'image'
              ? { type: 'image', url: `data:${part.mimeType};base64,${part.data}` }
              : { type: 'text', text: rewrittenText ?? part.text, text_elements: [] }
          )
        ]
      })
    } catch (error) {
      this.finish(error)
    }
  }
  private rejectPending(error: Error) {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer)
      pending.reject(error)
    }
    this.pending.clear()
  }
  protected async stop() {
    if (this.turnId) {
      try {
        this.write({
          id: ++this.nextId,
          method: 'turn/interrupt',
          params: { threadId: this.threadId, turnId: this.turnId }
        })
      } catch {
        /* The process may already have exited. */
      }
    }
    if (this.active) await this.waitForTurn()
    this.rejectPending(new Error('Codex connection closed'))
    this.lines?.close()
    await this.stopProcess(this.process)
  }
  protected override dispose() {
    this.gatewayLease?.dispose()
    this.gatewayLease = undefined
    super.dispose()
  }
}
