import { randomUUID } from 'node:crypto'

import { application } from '@application'
import { agentService } from '@data/services/AgentService'
import { agentSessionService } from '@data/services/AgentSessionService'
import type { LocalAgentCheckResult, LocalAgentModelCatalog } from '@shared/ai/localAgent'
import { LocalAgentConfigurationSchema, type LocalAgentConfiguration } from '@shared/ai/localAgent'
import type { AgentEntity } from '@shared/data/api/schemas/agents'
import type { AgentSessionEntity } from '@shared/data/api/schemas/agentSessions'

import { prepareAgentSessionWorkspaceDirectory } from '../agentSessionWorkspace'
import type { AgentRuntimeConnectInput, AgentSessionRuntimeDriver } from '../types'
import { acpError } from './acpError'
import { AcpManagement } from './AcpManagement'
import { getCursorApiKey } from './authStatus'
import { resolveLocalAgentCli } from './launch'
import { LocalAgentSessionRestoreError } from './LocalAgentSessionRestoreError'

const nativeConnections = {
  cursor: async () => (await import('./CursorConnection')).CursorConnection,
  claude: async () => (await import('./ClaudeConnection')).ClaudeConnection,
  codex: async () => (await import('./CodexConnection')).CodexConnection
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
    const config = LocalAgentConfigurationSchema.parse(
      agentService.getAgent(input.agentId)?.configuration?.localRuntime
    )
    return withAntigravityFallback(config, async (selected) => {
      const Connection =
        selected.protocol === 'acp'
          ? (await import('./AcpConnection')).AcpConnection
          : await nativeConnections[selected.protocol]()
      const live = new Connection(input.sessionId, input.agentId, selected, input.headless)
      try {
        return await withConnectionTimeout(live.start(session.workspace.path, input.resumeToken))
      } catch (error) {
        await live.close()
        throw error
      }
    })
  }
}

async function withAntigravityFallback<T>(
  config: LocalAgentConfiguration,
  run: (config: LocalAgentConfiguration) => Promise<T>
): Promise<T> {
  try {
    return await run(config)
  } catch (error) {
    if (
      config.presetId !== 'antigravity-acp' ||
      config.executableOverride ||
      config.args.length ||
      !(error instanceof Error && /no authentication method selected/i.test(error.message))
    )
      throw error
    // The standalone adapter and terminal CLI own separate sign-ins.
    const terminal = await resolveLocalAgentCli(config).catch(() => undefined)
    if (!terminal) throw error
    return run({ ...config, executableOverride: terminal.executable, args: ['acp'] })
  }
}

async function cursorCatalog(config: LocalAgentConfiguration): Promise<LocalAgentModelCatalog> {
  const { listCursorModels } = await import('@cherrystudio/agent-runtime-cursor')
  return { models: await listCursorModels(await getCursorApiKey(config)) }
}

export async function listLocalAgentModels(config: LocalAgentConfiguration): Promise<LocalAgentModelCatalog> {
  if (config.protocol === 'cursor') return withConnectionTimeout(cursorCatalog(config))
  const cwd = application.getPath('cherry.bin')
  const probe = { ...config, nativeModel: undefined }
  if (config.protocol === 'acp') {
    return withAntigravityFallback(probe, (selected) => withManagement(selected, (access) => access.listModels(cwd)))
  }
  const Connection = await nativeConnections[config.protocol]()
  const live = new Connection(`local-agent-models:${randomUUID()}`, '', probe)
  try {
    await withConnectionTimeout(live.start(cwd, undefined, 'models'))
    return {
      models: live.localSessionInfo.models,
      activeModel: live.localSessionInfo.activeModel,
      authMethods: live.localSessionInfo.protocolInfo?.authMethods
    }
  } finally {
    await live.close()
  }
}

export async function checkLocalAgent(config: LocalAgentConfiguration): Promise<LocalAgentCheckResult> {
  try {
    if (config.protocol === 'cursor') {
      await withConnectionTimeout(cursorCatalog(config))
      return { ok: true, status: 'ready' }
    }
    const cwd = application.getPath('cherry.bin')
    if (config.protocol === 'acp') {
      const protocolInfo = await withManagement(config, (access) => access.check(cwd))
      return { ok: true, status: 'ready', protocolInfo }
    }
    const Connection = await nativeConnections[config.protocol]()
    const live = new Connection(`local-agent-check:${randomUUID()}`, '', config)
    try {
      await withConnectionTimeout(live.start(cwd, undefined, true))
      return { ok: true, status: 'ready', protocolInfo: live.localSessionInfo.protocolInfo }
    } finally {
      await live.close()
    }
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

async function withConnectionTimeout<T>(operation: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('Local agent connection timed out')), 30000)
      })
    ])
  } catch (error) {
    throw acpError(error)
  } finally {
    clearTimeout(timer)
  }
}
