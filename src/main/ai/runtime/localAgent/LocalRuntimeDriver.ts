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
import { resolveLocalAgentLaunch } from './launch'
import { LocalAgentSessionRestoreError } from './LocalAgentSessionRestoreError'

async function connection(sessionId: string, agentId: string, config: LocalAgentConfiguration, headless = false) {
  switch (config.protocol) {
    case 'cursor': {
      const { CursorConnection } = await import('./CursorConnection')
      return new CursorConnection(sessionId, agentId, config, headless)
    }
    case 'acp': {
      const { AcpConnection } = await import('./AcpConnection')
      return new AcpConnection(sessionId, agentId, config, headless)
    }
    case 'claude': {
      const { ClaudeConnection } = await import('./ClaudeConnection')
      return new ClaudeConnection(sessionId, agentId, config, headless)
    }
    case 'codex': {
      const { CodexConnection } = await import('./CodexConnection')
      return new CodexConnection(sessionId, agentId, config, headless)
    }
  }
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
    return startLocalSession(
      input.sessionId,
      input.agentId,
      config,
      session.workspace.path,
      input.resumeToken,
      false,
      input.headless
    )
  }
}

async function startLocalSession(
  sessionId: string,
  agentId: string,
  config: LocalAgentConfiguration,
  cwd: string,
  resume?: string,
  probe: false | 'models' = false,
  headless = false
) {
  const live = await connection(sessionId, agentId, config, headless)
  try {
    return await startWithTimeout(live, cwd, resume, probe)
  } catch (error) {
    await live.close()
    if (
      config.presetId !== 'antigravity-acp' ||
      config.executableOverride ||
      config.args.length ||
      !(error instanceof Error && /no authentication method selected/i.test(error.message))
    )
      throw error

    // The standalone adapter and terminal CLI own separate sign-ins.
    const terminal = await resolveLocalAgentLaunch(config, undefined, true).catch(() => undefined)
    if (!terminal) throw error
    const native = await connection(
      sessionId,
      agentId,
      { ...config, executableOverride: terminal.executable, args: ['acp'] },
      headless
    )
    try {
      return await startWithTimeout(native, cwd, resume, probe)
    } catch (nativeError) {
      await native.close()
      throw nativeError
    }
  }
}

export async function listLocalAgentModels(config: LocalAgentConfiguration): Promise<LocalAgentModelCatalog> {
  const live = await startLocalSession(
    `local-agent-models:${randomUUID()}`,
    '',
    { ...config, nativeModel: undefined },
    application.getPath('cherry.bin'),
    undefined,
    'models'
  )
  try {
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
    return {
      ok: true,
      status: 'ready',
      protocolInfo: live.localSessionInfo.protocolInfo
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
  } catch (error) {
    throw acpError(error)
  } finally {
    clearTimeout(timer)
  }
}
