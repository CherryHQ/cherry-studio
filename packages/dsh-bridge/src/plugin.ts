/**
 * Cherry's dsh (Cordis) plugin: the control plane of a runtime connection.
 * Session open (create/resume) and prompts arrive over the side-channel socket;
 * tool policy runs locally (`tools/pre-execute` + guard) and interactive
 * approvals round-trip to the host. Named exports only — a default export
 * would be unwrapped by the loader and drop `inject` (dsh postmortem 0001).
 */
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-commands'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type {} from '@deepseek-ai/dsh-plan-mode'
import { SessionId } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-session-projection'
import type {} from '@deepseek-ai/dsh-subagent'
import type {} from '@deepseek-ai/dsh-token-meter'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import type { ApprovalRequest } from '@deepseek-ai/dsh-user-approval'
import { type AskUserQuestionRequest, UserQuestionError } from '@deepseek-ai/dsh-user-questions'

import { type BridgeLink, connectBridgeLink } from './link'
import { decideDelegatedToolCall, decideToolCall, detectGlobalInstall } from './policy'
import {
  BRIDGE_SOCKET_ENV,
  BRIDGE_TOKEN_ENV,
  type BridgeCommandResult,
  type BridgeContextUsage,
  type BridgeHostParams,
  type BridgePolicy,
  type BridgeSubagentChild,
  type BridgeToolDescriptor
} from './protocol'

export const name = 'cherry-bridge'
export const inject = ['approval', 'agents', 'tools', 'tokenMeter', 'subagents', 'userQuestions', 'planMode']

/** Canonical value a bridged execute resolves; `output.schema` states the same contract. */
interface BridgeToolOutputValue {
  text: string
  data?: unknown
}

interface RegisteredBridgeTool {
  descriptorKey: string
  sessions: Set<string>
  dispose: () => void
}

// No Config schema: env is the channel (a YAML `config` would need a Schemastery schema).
export function apply(ctx: Context): void {
  const socketPath = process.env[BRIDGE_SOCKET_ENV]
  const bridgeToken = process.env[BRIDGE_TOKEN_ENV]
  if (!socketPath || !bridgeToken) {
    // stderr only — stdout is the SDK's JSON-RPC channel.
    console.error(`[cherry-bridge] ${!socketPath ? BRIDGE_SOCKET_ENV : BRIDGE_TOKEN_ENV} is not set; bridge disabled`)
    return
  }
  delete process.env[BRIDGE_TOKEN_ENV]

  const policies = new Map<string, BridgePolicy>()
  const registeredTools = new Map<string, RegisteredBridgeTool>()
  const sessionTools = new Map<string, Set<string>>()
  /** Live command dispatches by sessionId — aborted by a `session/cancel` request. */
  const pendingCommands = new Map<string, AbortController>()

  const link: BridgeLink = connectBridgeLink({ socketPath, onRequest: handleRequest })
  // The host destroys the socket unless this is the first request and the token matches.
  link.request('ready', { pid: process.pid, token: bridgeToken }).catch((error) => {
    console.error('[cherry-bridge] host rejected the ready handshake:', error)
  })
  ctx.effect(
    () => () => {
      for (const sessionId of [...sessionTools.keys()]) disposeTools(sessionId)
    },
    'cherry-bridge.tools'
  )

  /** Host→plugin dispatch; a rejection becomes the JSON-RPC error response. */
  async function handleRequest(method: string, params: Record<string, unknown>): Promise<unknown> {
    switch (method) {
      case 'session/open':
        return openSession(params as BridgeHostParams<'session/open'>)
      case 'session/prompt': {
        const { sessionId, contentBlocks } = params as BridgeHostParams<'session/prompt'>
        requireAgent(sessionId).followup(createUserMessage({ content: contentBlocks, source: { kind: 'user' } }))
        return {}
      }
      case 'session/cancel': {
        const { sessionId } = params as BridgeHostParams<'session/cancel'>
        pendingCommands.get(sessionId)?.abort()
        requireAgent(sessionId).cancel({ kind: 'user' })
        return {}
      }
      case 'command/execute':
        return executeCommand(params as BridgeHostParams<'command/execute'>)
      case 'policy/update': {
        const { sessionId, policy } = params as BridgeHostParams<'policy/update'>
        policies.set(sessionId, policy)
        return {}
      }
      case 'plan/set': {
        const { sessionId, active } = params as BridgeHostParams<'plan/set'>
        return { outcome: ctx.planMode.set(requireAgent(sessionId), active) }
      }
      case 'subagent/interrupt': {
        const { sessionId, childSessionId } = params as BridgeHostParams<'subagent/interrupt'>
        ctx.subagents.interrupt(SessionId(childSessionId), {
          kind: 'user',
          parentSessionId: SessionId(sessionId)
        })
        return {}
      }
      case 'subagent/list': {
        const { sessionId } = params as BridgeHostParams<'subagent/list'>
        const entries = await ctx.subagents.listChildren(SessionId(sessionId))
        const children: BridgeSubagentChild[] = []
        for (const entry of entries) {
          // One-shot children cannot be continued and diagnostics are not tasks.
          if (entry.kind !== 'child' || entry.mode !== 'continuable') continue
          const live = ctx.agents.get(entry.id)
          children.push({
            id: entry.id,
            label: entry.label,
            status: live === undefined ? 'ready' : live.status === 'running' ? 'running' : 'idle'
          })
        }
        return { children }
      }
      case 'context/usage': {
        const { sessionId } = params as BridgeHostParams<'context/usage'>
        const agent = requireAgent(sessionId)
        const usage: BridgeContextUsage = { totalTokens: ctx.tokenMeter.measure(agent.session).totalTokens }
        // Heuristic composition rides the optional projection seam; totals stand alone without it.
        const breakdown = ctx.get('sessionProjections')?.snapshot(agent.session).values.contextBreakdown
        if (breakdown) {
          usage.systemTokens = breakdown.systemTokens
          usage.toolsTokens = breakdown.toolsTokens
          usage.messageTokens = breakdown.messageTokens
        }
        return usage
      }
      default:
        throw new Error(`unknown cherry bridge method "${method}"`)
    }
  }

  async function openSession(params: BridgeHostParams<'session/open'>): Promise<Record<string, never>> {
    policies.set(params.sessionId, params.policy)
    const agentOptions = {
      provider: params.provider,
      model: params.model,
      ...(params.maxTokens === undefined ? {} : { maxTokens: params.maxTokens })
    }
    try {
      replaceTools(params.sessionId, params.tools)
      if (params.resume) {
        try {
          const resumed = await ctx.agents.resume({ resumeSessionId: SessionId(params.sessionId), agentOptions })
          if (resumed.agent.session.header.cwd !== params.cwd) {
            await resumed.dispose()
            throw new Error(
              `persisted dsh session cwd ${JSON.stringify(resumed.agent.session.header.cwd)} does not match ${JSON.stringify(params.cwd)}`
            )
          }
        } catch (error) {
          if (!isMissingSessionError(error)) throw error
          // No persisted log for this id yet — degrade to a fresh create (pi parity).
          await ctx.agents.create({
            sessionId: SessionId(params.sessionId),
            meta: { cwd: params.cwd },
            agentOptions
          })
        }
      } else {
        await ctx.agents.create({
          sessionId: SessionId(params.sessionId),
          meta: { cwd: params.cwd },
          agentOptions
        })
      }
      return {}
    } catch (error) {
      policies.delete(params.sessionId)
      disposeTools(params.sessionId)
      throw error
    }
  }

  async function executeCommand(params: BridgeHostParams<'command/execute'>): Promise<BridgeCommandResult> {
    const agent = requireAgent(params.sessionId)
    const commands = ctx.get('commands')
    // No registry composed — the host treats the line as ordinary prose.
    if (!commands) return { handled: false }
    const controller = new AbortController()
    pendingCommands.set(params.sessionId, controller)
    try {
      const execution = await commands.execute(agent, params.line, controller.signal)
      if (execution === undefined) return { handled: false }
      return {
        handled: true,
        kind: execution.result.kind,
        ...(execution.result.text === undefined ? {} : { text: execution.result.text })
      }
    } finally {
      if (pendingCommands.get(params.sessionId) === controller) pendingCommands.delete(params.sessionId)
    }
  }

  function requireAgent(sessionId: string) {
    const agent = ctx.agents.get(SessionId(sessionId))
    if (!agent) throw new Error(`no live agent for session "${sessionId}"`)
    return agent
  }

  function replaceTools(sessionId: string, tools: BridgeToolDescriptor[]): void {
    const descriptors = new Map<string, { tool: BridgeToolDescriptor; key: string }>()
    for (const tool of tools) {
      if (descriptors.has(tool.name)) throw new Error(`duplicate bridge tool descriptor "${tool.name}"`)
      const key = JSON.stringify(tool)
      const existing = registeredTools.get(tool.name)
      if (existing && existing.descriptorKey !== key && [...existing.sessions].some((id) => id !== sessionId)) {
        throw new Error(`bridge tool "${tool.name}" has conflicting descriptors across sessions`)
      }
      descriptors.set(tool.name, { tool, key })
    }

    disposeTools(sessionId)
    const attached: string[] = []
    try {
      for (const [toolName, { tool, key }] of descriptors) {
        let registration = registeredTools.get(toolName)
        if (!registration) {
          registration = {
            descriptorKey: key,
            sessions: new Set(),
            dispose: ctx.tools.register(toToolDefinition(tool))
          }
          registeredTools.set(toolName, registration)
        }
        registration.sessions.add(sessionId)
        attached.push(toolName)
      }
      sessionTools.set(sessionId, new Set(attached))
    } catch (error) {
      for (const toolName of attached.reverse()) detachTool(toolName, sessionId)
      throw error
    }
  }

  function disposeTools(sessionId: string): void {
    const toolNames = sessionTools.get(sessionId)
    sessionTools.delete(sessionId)
    for (const toolName of [...(toolNames ?? [])].reverse()) detachTool(toolName, sessionId)
  }

  function detachTool(toolName: string, sessionId: string): void {
    const registration = registeredTools.get(toolName)
    if (!registration) return
    registration.sessions.delete(sessionId)
    if (registration.sessions.size > 0) return
    registeredTools.delete(toolName)
    registration.dispose()
  }

  function toToolDefinition(tool: BridgeToolDescriptor): ToolDefinition {
    return {
      name: tool.name,
      description: tool.description,
      parameters: tool.inputSchema,
      output: {
        schema: {
          type: 'object',
          properties: { text: { type: 'string' }, data: {} },
          required: ['text'],
          additionalProperties: false
        },
        render(_args, value) {
          // The registry validated `value` against output.schema before render — the cast restates it.
          return [{ type: 'text', text: (value as unknown as BridgeToolOutputValue).text }]
        }
      },
      execute(args, exec) {
        // Delegated agents resolve to their root: sessionTools and the host both key by root session id.
        const sessionId = exec.agent === undefined ? undefined : rootSessionOf(exec.agent)
        if (!sessionId || !sessionTools.get(sessionId)?.has(tool.name)) {
          return Promise.reject(new Error(`bridge tool "${tool.name}" is unavailable for this session`))
        }
        return link.callTool({ sessionId, name: tool.name, args }, exec.signal)
      }
    }
  }

  // Relay `ctx.userQuestions` asks (plan review) to the host UI; abort is the
  // caller's teardown/dismissal and must surface as the seam's own error code.
  ctx.effect(
    () =>
      ctx.userQuestions.registerProvider({
        async ask(request) {
          try {
            return await link.request(
              'question/ask',
              {
                sessionId: request.agent?.id ?? '',
                callId: correlatePlanReviewCallId(request),
                questions: request.questions
              },
              request.signal
            )
          } catch (error) {
            if (request.signal?.aborted) {
              throw new UserQuestionError('the ask was aborted before the user answered', 'ASK_ABORTED', {
                cause: error instanceof Error ? error : undefined
              })
            }
            throw error
          }
        }
      }),
    'cherry-bridge.userQuestions'
  )

  // Per-epoch residency edges (a cold resume opens a new epoch). The parent id is
  // read at start while the child agent is live and cached for the end edge.
  const subagentRunParents = new Map<string, string>()
  ctx.on('subagent/start', (info) => {
    const parentSessionId = ctx.agents.get(info.id)?.session.header.parentSession
    if (parentSessionId === undefined) return
    subagentRunParents.set(info.runId, parentSessionId)
    link.notify('subagent/lifecycle', {
      phase: 'start',
      runId: info.runId,
      childSessionId: info.id,
      parentSessionId,
      provider: info.provider
    })
  })
  ctx.on('subagent/end', (info) => {
    const parentSessionId = subagentRunParents.get(info.runId)
    subagentRunParents.delete(info.runId)
    if (parentSessionId === undefined) return
    link.notify('subagent/lifecycle', {
      phase: 'end',
      runId: info.runId,
      childSessionId: info.id,
      parentSessionId,
      provider: info.provider,
      stopReason: info.stopReason
    })
  })

  /** The bridge policy key: the root ancestor's session id (host policies are per root). */
  function rootSessionOf(agent: Agent): string {
    let current = agent
    while (true) {
      const parentId = current.session.header.parentSession
      if (parentId === undefined) return current.id
      const parent = ctx.agents.get(parentId)
      // A dead intermediate cannot be walked past; its id still names the policy when it was the root.
      if (parent === undefined) return parentId
      current = parent
    }
  }

  ctx.on('tools/pre-execute', async (exec, next) => {
    const agent = exec.agent
    // Not an agent call: delegate to dsh's own chain (which fail-closes on ask).
    if (agent === undefined) return next()
    const delegated = agent.session.header.parentSession !== undefined
    const policy = policies.get(rootSessionOf(agent))
    if (policy === undefined) {
      // Non-bridge root sessions keep dsh's chain; a delegated agent whose root
      // policy is unreachable fails closed (every root here is bridge-opened).
      if (!delegated) return next()
      return {
        kind: 'deny' as const,
        reason: `no bridge policy is reachable for delegated agent "${agent.id}"`
      }
    }
    return delegated
      ? decideDelegatedToolCall(policy, exec.name, exec.arguments)
      : decideToolCall(policy, exec.name, exec.arguments)
  })

  // Hard guard, active in every mode (bypass included) and immune to later listeners.
  ctx.tools.guard((exec) => {
    if (exec.name !== 'bash' && exec.name !== 'pwsh') return undefined
    const command = (exec.arguments as { command?: unknown } | null | undefined)?.command
    if (typeof command !== 'string' || !command.trim()) return undefined
    const reason = detectGlobalInstall(command)
    if (reason === null) return undefined
    return `Blocked to avoid cross-agent dependency pollution: ${reason}. Install into the current project instead (e.g. \`bun install <pkg>\`, or \`uv run --with <pkg> python\`); for one-off tools use \`bun x <tool>\` / \`uvx <tool>\`.`
  })

  ctx.on('approval/request', async (req) => {
    if (req.signal?.aborted) return 'cancelled'
    if (!link.connected) return 'rejected'
    try {
      const { outcome } = await link.request(
        'approval/ask',
        {
          sessionId: req.agent.id,
          toolName: req.toolName,
          callId: req.callId,
          args: correlateCallArguments(req),
          reason: req.reason
        },
        req.signal
      )
      return outcome
    } catch {
      // Fail closed: a host disconnect (or error response) denies the call.
      return req.signal?.aborted ? 'cancelled' : 'rejected'
    }
  })
}

/** dsh has no error code for a missing persisted session; the loop throws `session "<id>" not found`. */
function isMissingSessionError(error: unknown): boolean {
  if ((error as NodeJS.ErrnoException | undefined)?.code === 'ENOENT') return true
  return /\bnot found\b/i.test(error instanceof Error ? error.message : String(error))
}

/** Attach the asked-about call's arguments: latest `tool/call` with the request's callId. */
function correlateCallArguments(req: ApprovalRequest): unknown {
  if (req.callId === undefined) return undefined
  const events = req.agent.session.events
  for (let i = events.length - 1; i >= 0; i--) {
    const event = events[i]
    if (event.type !== 'tool/call' || event.data.callId !== req.callId) continue
    try {
      return JSON.parse(event.data.arguments)
    } catch {
      return undefined
    }
  }
  return undefined
}

/** Correlate the plan-review question with the newest matching durable tool call. */
function correlatePlanReviewCallId(request: AskUserQuestionRequest): string {
  const review = request.questions.length === 1 ? request.questions[0] : undefined
  const plan = review?.intent?.kind === 'plan-review' ? review.detail : undefined
  if (!request.agent || typeof plan !== 'string') {
    throw new UserQuestionError('only an agent plan review can cross the Cherry bridge', 'UNSUPPORTED_QUESTION')
  }

  const events = request.agent.session.events
  for (let i = events.length - 1; i >= 0; i--) {
    const event = events[i]
    if (event.type !== 'tool/call' || event.data.name !== 'exit_plan_mode') continue
    try {
      const args = JSON.parse(event.data.arguments) as { plan?: unknown } | null
      if (args?.plan === plan) return String(event.data.callId)
    } catch {
      continue
    }
  }
  throw new UserQuestionError('the current exit_plan_mode call could not be correlated', 'CALL_NOT_FOUND')
}
