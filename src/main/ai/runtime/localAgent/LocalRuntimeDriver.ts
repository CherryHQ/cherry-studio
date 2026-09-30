import { randomUUID } from 'node:crypto'

import { application } from '@application'
import { agentService } from '@data/services/AgentService'
import { agentSessionMessageService } from '@data/services/AgentSessionMessageService'
import { agentSessionService } from '@data/services/AgentSessionService'
import { executeCommand } from '@main/utils/processRunner'
import type { LocalAgentCheckResult, LocalAgentModelCatalog } from '@shared/ai/localAgent'
import { LocalAgentConfigurationSchema, type LocalAgentConfiguration } from '@shared/ai/localAgent'
import type { AgentSessionEntity } from '@shared/data/api/schemas/agentSessions'

import { prepareAgentSessionWorkspaceDirectory } from '../agentSessionWorkspace'
import type { AgentRuntimeConnectInput, AgentSessionRuntimeDriver } from '../types'
import { resolveLocalAgentLaunch } from './launch'

async function connection(sessionId: string, agentId: string, config: LocalAgentConfiguration) {
  switch (config.protocol) {
    case 'acp': {
      const { AcpConnection } = await import('./AcpConnection')
      return new AcpConnection(sessionId, agentId, config)
    }
    case 'claude': {
      const { ClaudeConnection } = await import('./ClaudeConnection')
      return new ClaudeConnection(sessionId, agentId, config)
    }
    case 'codex': {
      const { CodexConnection } = await import('./CodexConnection')
      return new CodexConnection(sessionId, agentId, config)
    }
  }
}

export class LocalRuntimeDriver implements AgentSessionRuntimeDriver {
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
    if (
      !input.resumeToken &&
      agentSessionMessageService.listSessionMessages(input.sessionId, { limit: 3 }).items.length > 2
    ) {
      throw new Error('The native conversation cannot be restored; create a new session to continue')
    }
    await prepareAgentSessionWorkspaceDirectory(session)
    const config = LocalAgentConfigurationSchema.parse(
      agentService.getAgent(input.agentId)?.configuration?.localRuntime
    )
    const live = await connection(input.sessionId, input.agentId, config)
    try {
      return await startWithTimeout(live, session.workspace.path, input.resumeToken)
    } catch (error) {
      await live.close()
      throw error
    }
  }
}

export async function listLocalAgentModels(config: LocalAgentConfiguration): Promise<LocalAgentModelCatalog> {
  const live = await connection(`local-agent-models:${randomUUID()}`, '', { ...config, nativeModel: undefined })
  try {
    await startWithTimeout(live, application.getPath('cherry.bin'), undefined, 'models')
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
  const live = await connection(`local-agent-check:${randomUUID()}`, '', config)
  try {
    await startWithTimeout(live, application.getPath('cherry.bin'), undefined, true)
    const launch = await resolveLocalAgentLaunch(config)
    const version = config.presetId
      ? await executeCommand(launch.executable, ['--version'], { env: launch.env, timeout: 3000, maxOutputBytes: 4096 })
          .then((value) => value.trim().split('\n')[0].slice(0, 128))
          .catch(() => undefined)
      : undefined
    return {
      ok: true,
      status: 'ready',
      path: launch.executable,
      version,
      protocolInfo: live.localSessionInfo.protocolInfo
    }
  } catch (error) {
    const code = error && typeof error === 'object' && 'code' in error ? error.code : undefined
    return {
      ok: false,
      status:
        code === 'LOCAL_AGENT_NOT_INSTALLED'
          ? 'not-installed'
          : code === -32000
            ? 'authentication-required'
            : code === -32601 || code === -32602
              ? 'incompatible'
              : 'failed',
      error: error instanceof Error ? error.message : String(error)
    }
  } finally {
    await live.close()
  }
}

async function startWithTimeout(
  live: Awaited<ReturnType<typeof connection>>,
  cwd: string,
  resume?: string,
  probe: boolean | 'models' = false
) {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      live.start(cwd, resume, probe),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('Local agent connection timed out')), 30000)
      })
    ])
  } finally {
    clearTimeout(timer)
  }
}
