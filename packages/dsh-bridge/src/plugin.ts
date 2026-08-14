/**
 * Cherry's dsh (Cordis) plugin: the control plane of a runtime connection.
 * Session open (create/resume) and prompts arrive over the side-channel socket;
 * tool policy runs locally (`tools/pre-execute` + guard) and interactive
 * approvals round-trip to the host. Named exports only — a default export
 * would be unwrapped by the loader and drop `inject` (dsh postmortem 0001).
 */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-commands'
import { type ContentBlock, createUserMessage } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-session-projection'
import type {} from '@deepseek-ai/dsh-token-meter'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import type { ApprovalRequest } from '@deepseek-ai/dsh-user-approval'

import { type BridgeLink, connectBridgeLink } from './link'
import { decideToolCall, detectGlobalInstall } from './policy'
import {
  BRIDGE_SOCKET_ENV,
  BRIDGE_TOKEN_ENV,
  type BridgeContextUsage,
  type BridgePolicy,
  type BridgeToolDescriptor,
  type HostToBridgeMessage
} from './protocol'

export const name = 'cherry-bridge'
export const inject = ['approval', 'agents', 'tools', 'tokenMeter']

type AskResolve = (outcome: 'allowed-once' | 'rejected' | 'cancelled') => void

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
  const pendingAsks = new Map<string, AskResolve>()
  /** Live command dispatches by sessionId — aborted by a `cancel` frame. */
  const pendingCommands = new Map<string, AbortController>()
  let askSeq = 0

  const link: BridgeLink = connectBridgeLink({
    socketPath,
    onMessage: (message) => void handleMessage(message),
    onDisconnect: () => {
      // Fail closed: every pending ask resolves rejected, later asks reject immediately.
      for (const resolve of pendingAsks.values()) resolve('rejected')
      pendingAsks.clear()
    }
  })
  link.send({ type: 'ready', pid: process.pid, token: bridgeToken })
  ctx.effect(
    () => () => {
      for (const sessionId of [...sessionTools.keys()]) disposeTools(sessionId)
    },
    'cherry-bridge.tools'
  )

  async function handleMessage(message: HostToBridgeMessage): Promise<void> {
    switch (message.type) {
      case 'open': {
        policies.set(message.sessionId, message.policy)
        const agentOptions = {
          provider: message.provider,
          model: message.model,
          ...(message.maxTokens === undefined ? {} : { maxTokens: message.maxTokens })
        }
        try {
          replaceTools(message.sessionId, message.tools)
          if (message.resume) {
            try {
              const resumed = await ctx.agents.resume({ resumeSessionId: SessionId(message.sessionId), agentOptions })
              if (resumed.agent.session.header.cwd !== message.cwd) {
                await resumed.dispose()
                throw new Error(
                  `persisted dsh session cwd ${JSON.stringify(resumed.agent.session.header.cwd)} does not match ${JSON.stringify(message.cwd)}`
                )
              }
            } catch (error) {
              if (!isMissingSessionError(error)) throw error
              // No persisted log for this id yet — degrade to a fresh create (pi parity).
              await ctx.agents.create({
                sessionId: SessionId(message.sessionId),
                meta: { cwd: message.cwd },
                agentOptions
              })
            }
          } else {
            await ctx.agents.create({
              sessionId: SessionId(message.sessionId),
              meta: { cwd: message.cwd },
              agentOptions
            })
          }
          link.send({ type: 'result', id: message.id, ok: true })
        } catch (error) {
          policies.delete(message.sessionId)
          disposeTools(message.sessionId)
          link.send({ type: 'result', id: message.id, ok: false, error: String(error) })
        }
        return
      }
      case 'prompt': {
        const agent = ctx.agents.get(SessionId(message.sessionId))
        if (!agent) {
          link.send({
            type: 'result',
            id: message.id,
            ok: false,
            error: `no live agent for session "${message.sessionId}"`
          })
          return
        }
        agent.followup(
          createUserMessage({ content: message.contentBlocks as ContentBlock[], source: { kind: 'user' } })
        )
        link.send({ type: 'result', id: message.id, ok: true })
        return
      }
      case 'cancel': {
        pendingCommands.get(message.sessionId)?.abort()
        const agent = ctx.agents.get(SessionId(message.sessionId))
        if (!agent) {
          link.send({
            type: 'result',
            id: message.id,
            ok: false,
            error: `no live agent for session "${message.sessionId}"`
          })
          return
        }
        agent.cancel({ kind: 'user' })
        link.send({ type: 'result', id: message.id, ok: true })
        return
      }
      case 'command': {
        const agent = ctx.agents.get(SessionId(message.sessionId))
        if (!agent) {
          link.send({
            type: 'commandResult',
            id: message.id,
            ok: false,
            error: `no live agent for session "${message.sessionId}"`
          })
          return
        }
        const commands = ctx.get('commands')
        if (!commands) {
          // No registry composed — the host treats the line as ordinary prose.
          link.send({ type: 'commandResult', id: message.id, ok: true, handled: false })
          return
        }
        const controller = new AbortController()
        pendingCommands.set(message.sessionId, controller)
        try {
          const execution = await commands.execute(agent, message.line, controller.signal)
          if (execution === undefined) {
            link.send({ type: 'commandResult', id: message.id, ok: true, handled: false })
          } else {
            link.send({
              type: 'commandResult',
              id: message.id,
              ok: true,
              handled: true,
              kind: execution.result.kind,
              ...(execution.result.text === undefined ? {} : { text: execution.result.text })
            })
          }
        } catch (error) {
          link.send({ type: 'commandResult', id: message.id, ok: false, error: String(error) })
        } finally {
          if (pendingCommands.get(message.sessionId) === controller) pendingCommands.delete(message.sessionId)
        }
        return
      }
      case 'policyUpdate': {
        policies.set(message.sessionId, message.policy)
        link.send({ type: 'result', id: message.id, ok: true })
        return
      }
      case 'contextUsage': {
        const agent = ctx.agents.get(SessionId(message.sessionId))
        if (!agent) {
          link.send({
            type: 'contextUsageResult',
            id: message.id,
            ok: false,
            error: `no live agent for session "${message.sessionId}"`
          })
          return
        }
        try {
          const usage: BridgeContextUsage = { totalTokens: ctx.tokenMeter.measure(agent.session).totalTokens }
          // Heuristic composition rides the optional projection seam; totals stand alone without it.
          const breakdown = ctx.get('sessionProjections')?.snapshot(agent.session).values.contextBreakdown
          if (breakdown) {
            usage.systemTokens = breakdown.systemTokens
            usage.toolsTokens = breakdown.toolsTokens
            usage.messageTokens = breakdown.messageTokens
          }
          link.send({ type: 'contextUsageResult', id: message.id, ok: true, usage })
        } catch (error) {
          link.send({ type: 'contextUsageResult', id: message.id, ok: false, error: String(error) })
        }
        return
      }
      case 'approvalAnswer': {
        const resolve = pendingAsks.get(message.id)
        pendingAsks.delete(message.id)
        resolve?.(message.outcome)
        return
      }
      case 'toolCallResult':
        return
    }
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
          return [{ type: 'text', text: (value as { text: string }).text }]
        }
      },
      execute(args, exec) {
        const sessionId = exec.agent?.id
        if (!sessionId || !sessionTools.get(sessionId)?.has(tool.name)) {
          return Promise.reject(new Error(`bridge tool "${tool.name}" is unavailable for this session`))
        }
        return link.callTool({ sessionId, name: tool.name, args }, exec.signal)
      }
    }
  }

  ctx.on('tools/pre-execute', async (exec, next) => {
    const policy = exec.agent === undefined ? undefined : policies.get(exec.agent.id)
    // Not a bridge-opened session: delegate to dsh's own chain (which fail-closes on ask).
    if (policy === undefined) return next()
    return decideToolCall(policy, exec.name, exec.arguments)
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
    const id = String(++askSeq)
    return await new Promise((resolve: AskResolve) => {
      pendingAsks.set(id, resolve)
      req.signal?.addEventListener(
        'abort',
        () => {
          if (pendingAsks.delete(id)) resolve('cancelled')
        },
        { once: true }
      )
      link.send({
        type: 'approvalAsk',
        id,
        sessionId: req.agent.id,
        toolName: req.toolName,
        callId: req.callId,
        args: correlateCallArguments(req),
        reason: req.reason
      })
    })
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
