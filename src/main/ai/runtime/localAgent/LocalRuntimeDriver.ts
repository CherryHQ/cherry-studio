import { application } from '@application'
import { agentService } from '@data/services/AgentService'
import { agentSessionMessageService } from '@data/services/AgentSessionMessageService'
import { agentSessionService } from '@data/services/AgentSessionService'
import type { LocalAgentCheckResult, LocalAgentModelCatalog } from '@shared/ai/localAgent'
import { LocalAgentConfigurationSchema, type LocalAgentConfiguration } from '@shared/ai/localAgent'
import type { AgentEntity } from '@shared/data/api/schemas/agents'
import type { AgentSessionEntity } from '@shared/data/api/schemas/agentSessions'

import { prepareAgentSessionWorkspaceDirectory } from '../agentSessionWorkspace'
import { loadLocalClaudeRuntime } from '../claudeCode'
import { checkCodex, listCodexModels } from '../codex/codexManagement'
import type { AgentRuntimeConnectInput, AgentSessionRuntimeDriver } from '../types'
import { withAcpLoginFallback } from './acpLaunch'
import { AcpManagement } from './AcpManagement'
import { getCursorApiKey } from './authStatus'
import { withConnectionTimeout } from './connectionTimeout'
import { LocalAgentSessionRestoreError } from './LocalAgentSessionRestoreError'

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
    const config = LocalAgentConfigurationSchema.parse(
      agentService.getAgent(input.agentId)?.configuration?.localRuntime
    )
    const cwd = session.workspace.path
    if (config.protocol === 'claude') {
      const { LocalClaudeConnection } = await loadLocalClaudeRuntime()
      const live = new LocalClaudeConnection(input, config)
      const startup = live.start(cwd)
      try {
        return await withConnectionTimeout(startup, () => live.cancelStartup())
      } catch (error) {
        await startup.catch(() => {})
        await live.close()
        throw error
      }
    }
    if (config.protocol === 'codex') {
      const { CodexSessionHost } = await import('../codex/CodexSessionHost')
      const host = new CodexSessionHost(input.sessionId, input.agentId, config, input.headless)
      const restore = input.resumeToken
        ? {
            threadId: input.resumeToken,
            kind:
              !input.nativeSessionId && !agentSessionMessageService.hasSessionMessages(input.sessionId)
                ? ('empty-prewarm' as const)
                : ('required' as const)
          }
        : undefined
      const startup = host.start(cwd, restore, input.branchHead)
      try {
        return await withConnectionTimeout(startup)
      } catch (error) {
        await host.close()
        await startup.catch(() => {})
        throw error
      }
    }
    const Connection =
      config.protocol === 'acp'
        ? (await import('./AcpConnection')).AcpConnection
        : (await import('./CursorConnection')).CursorConnection
    const start = async (selected: LocalAgentConfiguration) => {
      const live = new Connection(input.sessionId, input.agentId, selected, input.headless)
      try {
        return await withConnectionTimeout(live.start(cwd, input.resumeToken))
      } catch (error) {
        await live.close()
        throw error
      }
    }
    return config.protocol === 'acp' ? withAcpLoginFallback(config, start) : start(config)
  }
}

async function cursorCatalog(config: LocalAgentConfiguration): Promise<LocalAgentModelCatalog> {
  const { listCursorModels } = await import('@cherrystudio/agent-runtime-cursor')
  return { models: await listCursorModels(await getCursorApiKey(config)) }
}

async function claudeCatalog(config: LocalAgentConfiguration, cwd: string) {
  const { probeLocalClaude } = await loadLocalClaudeRuntime()
  const abort = new AbortController()
  const probe = probeLocalClaude(config, cwd, abort)
  try {
    return await withConnectionTimeout(probe, () => abort.abort())
  } finally {
    await probe.catch(() => {})
  }
}

export async function listLocalAgentModels(config: LocalAgentConfiguration): Promise<LocalAgentModelCatalog> {
  if (config.protocol === 'cursor') return withConnectionTimeout(cursorCatalog(config))
  const cwd = application.getPath('cherry.bin')
  if (config.protocol === 'claude') return claudeCatalog(config, cwd)
  const probe = { ...config, nativeModel: undefined }
  if (config.protocol === 'acp') {
    return withAcpLoginFallback(probe, (selected) => withManagement(selected, (access) => access.listModels(cwd)))
  }
  return listCodexModels(probe, cwd)
}

export async function checkLocalAgent(config: LocalAgentConfiguration): Promise<LocalAgentCheckResult> {
  try {
    if (config.protocol === 'cursor') {
      await withConnectionTimeout(cursorCatalog(config))
      return { ok: true, status: 'ready' }
    }
    const cwd = application.getPath('cherry.bin')
    if (config.protocol === 'claude') {
      await claudeCatalog(config, cwd)
      return { ok: true, status: 'ready' }
    }
    if (config.protocol === 'acp') {
      const protocolInfo = await withManagement(config, (access) => access.check(cwd))
      return { ok: true, status: 'ready', protocolInfo }
    }
    await checkCodex(config, cwd)
    return { ok: true, status: 'ready' }
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

async function withManagement<T>(config: LocalAgentConfiguration, operation: (access: AcpManagement) => Promise<T>) {
  const access = new AcpManagement(config)
  try {
    return await withConnectionTimeout(operation(access))
  } finally {
    await access.close()
  }
}
