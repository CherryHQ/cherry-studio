import { agentService } from '@data/services/AgentService'
import { agentSessionService } from '@data/services/AgentSessionService'
import {
  getLocalAgentProtocol,
  type LocalAgentCheckResult,
  type LocalAgentConfiguration,
  type LocalAgentModelCatalog,
  type LocalAgentProtocol,
  type LocalAgentProtocolInfo,
  StoredLocalAgentConfigurationSchema
} from '@shared/ai/localAgent'
import type { AgentEntity } from '@shared/data/api/schemas/agents'
import type { AgentSessionEntity } from '@shared/data/api/schemas/agentSessions'

import { prepareAgentSessionWorkspaceDirectory } from './agentSessionWorkspace'
import { LocalAgentSessionRestoreError } from './LocalAgentSessionRestoreError'
import type { AgentRuntimeConnectInput, AgentSessionRuntimeDriver } from './types'

interface LocalRuntimeAdapter {
  connect(
    input: AgentRuntimeConnectInput,
    config: LocalAgentConfiguration,
    cwd: string
  ): ReturnType<AgentSessionRuntimeDriver['connect']>
  listModels(config: LocalAgentConfiguration): Promise<LocalAgentModelCatalog>
  check(config: LocalAgentConfiguration): Promise<LocalAgentProtocolInfo | void>
}

const localRuntimeAdapters: Record<LocalAgentProtocol, () => Promise<LocalRuntimeAdapter>> = {
  acp: () => import('./acp/acpDriver'),
  claude: () => import('./claudeCode').then(({ loadLocalClaudeDriver }) => loadLocalClaudeDriver()),
  codex: () => import('./codex/codexDriver'),
  cursor: () => import('./cursor/cursorDriver')
}

export class LocalRuntimeDriver implements AgentSessionRuntimeDriver {
  getExecutionId(agent: AgentEntity): `runtime:${string}` | undefined {
    return agent.configuration?.localRuntime?.enabled ? `runtime:${agent.id}` : undefined
  }
  readonly type = 'local'
  readonly capabilities = ['agent-session'] as const
  validateSession(session: AgentSessionEntity) {
    const agent = session.agentId ? agentService.getAgent(session.agentId) : undefined
    if (!agent?.configuration?.localRuntime?.enabled) throw new Error('Local agent is disabled')
    if (!session.workspace?.path) throw new Error('Session has no working directory')
  }
  async listAvailableTools() {
    return []
  }
  async connect(input: AgentRuntimeConnectInput) {
    const session = agentSessionService.getById(input.sessionId)
    this.validateSession(session)
    if (!input.resumeToken && input.nativeSessionId) {
      throw new LocalAgentSessionRestoreError(
        'The native conversation cannot be restored; create a new session to continue'
      )
    }
    await prepareAgentSessionWorkspaceDirectory(session)
    const config = StoredLocalAgentConfigurationSchema.parse(
      agentService.getAgent(input.agentId)?.configuration?.localRuntime
    )
    const adapter = await localRuntimeAdapters[getLocalAgentProtocol(config.presetId)]()
    return adapter.connect(input, config, session.workspace.path)
  }
}

export async function listLocalAgentModels(config: LocalAgentConfiguration): Promise<LocalAgentModelCatalog> {
  const adapter = await localRuntimeAdapters[getLocalAgentProtocol(config.presetId)]()
  return adapter.listModels(config)
}

export async function checkLocalAgent(config: LocalAgentConfiguration): Promise<LocalAgentCheckResult> {
  try {
    const adapter = await localRuntimeAdapters[getLocalAgentProtocol(config.presetId)]()
    const protocolInfo = await adapter.check(config)
    return protocolInfo ? { ok: true, status: 'ready', protocolInfo } : { ok: true, status: 'ready' }
  } catch (error) {
    const code = error && typeof error === 'object' && 'code' in error ? error.code : undefined
    return {
      ok: false,
      status:
        code === 'LOCAL_AGENT_NOT_INSTALLED'
          ? 'not-installed'
          : code === -32000 || (error instanceof Error && error.name === 'AuthenticationError')
            ? 'authentication-required'
            : code === -32601 || code === -32602
              ? 'incompatible'
              : 'failed',
      error: error instanceof Error ? error.message : String(error)
    }
  }
}
