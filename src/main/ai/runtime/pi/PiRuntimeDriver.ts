import { agentService } from '@data/services/AgentService'
import type { Tool } from '@shared/ai/tool'
import type { AgentSessionEntity } from '@shared/data/api/schemas/agentSessions'

import type { AgentRuntimeConnectInput, AgentRuntimeConnection, AgentSessionRuntimeDriver } from '../types'
import { assertPiProviderUsable } from './modelInjection'
import { PiRuntimeConnection } from './PiRuntimeConnection'

/**
 * pi built-in tools (plan capability matrix). pi ships 7 lowercase built-ins; we
 * do NOT rename them to Claude casing — that would corrupt pi's tool identity and
 * the approval/policy lookups (D8). MCP tools are deferred for pi v1.
 *
 * Read-only tools default to auto-approval; mutating/side-effecting tools default
 * to prompt. The authoritative per-turn gate is Phase 3's approval extension.
 */
const PI_BUILTIN_TOOLS: readonly Tool[] = [
  { id: 'read', name: 'read', origin: 'builtin', approval: 'auto' },
  { id: 'grep', name: 'grep', origin: 'builtin', approval: 'auto' },
  { id: 'find', name: 'find', origin: 'builtin', approval: 'auto' },
  { id: 'ls', name: 'ls', origin: 'builtin', approval: 'auto' },
  { id: 'bash', name: 'bash', origin: 'builtin', approval: 'prompt' },
  { id: 'edit', name: 'edit', origin: 'builtin', approval: 'prompt' },
  { id: 'write', name: 'write', origin: 'builtin', approval: 'prompt' }
]

export class PiRuntimeDriver implements AgentSessionRuntimeDriver {
  readonly type = 'pi'
  readonly capabilities = ['agent-session'] as const

  async validateSession(session: AgentSessionEntity): Promise<void> {
    const cwd = session.workspace?.path
    if (!cwd) {
      throw new Error(`pi agent session ${session.id} has no workspace configured`)
    }
    if (!session.agentId) {
      throw new Error(`pi agent session ${session.id} has no agent`)
    }
    const agent = await agentService.getAgent(session.agentId)
    if (!agent?.model) {
      throw new Error(`pi agent ${session.agentId} has no model configured`)
    }
    // Side-effect free: dispatch validation must not consume API-key rotation;
    // the concrete key is selected only when the runtime connection starts.
    await assertPiProviderUsable(agent.model)
  }

  async listAvailableTools(_mcpIds: string[]): Promise<Tool[]> {
    // MCP is deferred for pi v1 (plan capability matrix); mcpIds are ignored.
    return PI_BUILTIN_TOOLS.map((tool) => ({ ...tool }))
  }

  async connect(input: AgentRuntimeConnectInput): Promise<AgentRuntimeConnection> {
    return new PiRuntimeConnection(input).start()
  }
}
