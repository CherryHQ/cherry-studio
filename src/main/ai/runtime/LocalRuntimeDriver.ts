import type { RuntimeAccountAccess, RuntimeAccountResult } from '@cherrystudio/agent-runtime'
import { agentService } from '@data/services/AgentService'
import { agentSessionService } from '@data/services/AgentSessionService'
import { authenticateViaCli, readCliAccount, resolveCliAuthCommand } from '@main/services/codeCli'
import {
  getLocalAgentPreset,
  getLocalAgentProtocol,
  type LocalAgentCheckResult,
  type LocalAgentConfiguration,
  type LocalAgentModelCatalog,
  type LocalAgentProtocol,
  type LocalAgentProtocolInfo,
  type LocalAgentRuntime
} from '@shared/ai/localAgent'
import type { AgentEntity } from '@shared/data/api/schemas/agents'
import type { AgentSessionEntity } from '@shared/data/api/schemas/agentSessions'

import { resolveLocalLaunch, type LocalLaunchTarget } from '../agentSession/localContext'
import { prepareAgentSessionWorkspaceDirectory } from './agentSessionWorkspace'
import { enrichLocalAgentModels } from './localAgentModelMetadata'
import { LocalAgentSessionRestoreError } from './LocalAgentSessionRestoreError'
import type { AgentRuntimeConnectInput, AgentSessionRuntimeDriver, LocalRuntimeConnectInput } from './types'

interface LocalRuntimeAdapter {
  connect(
    input: LocalRuntimeConnectInput,
    config: LocalAgentRuntime,
    cwd: string
  ): ReturnType<AgentSessionRuntimeDriver['connect']>
  listModels(config: LocalAgentConfiguration): Promise<LocalAgentModelCatalog>
  bindAccount?(config: LocalAgentConfiguration): RuntimeAccountAccess | Promise<RuntimeAccountAccess>
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
    return agent.localRuntime?.enabled ? `runtime:${agent.id}` : undefined
  }
  readonly type = 'local'
  readonly capabilities = ['agent-session'] as const
  validateSession(session: AgentSessionEntity) {
    const agent = session.agentId ? agentService.getAgent(session.agentId) : undefined
    if (!agent?.localRuntime?.enabled) throw new Error('Local agent is disabled')
    if (!session.workspace?.path) throw new Error('Session has no working directory')
  }
  async connect(input: AgentRuntimeConnectInput) {
    const session = agentSessionService.getById(input.sessionId)
    this.validateSession(session)
    const launch = resolveLocalLaunch(input.sessionId, input.agentId, input.branchHead)
    const context = launch?.target.kind === 'resume' ? launch.target.context : undefined
    if (!launch || (!context && input.nativeSessionId) || (context && !context.nativeThreadId)) {
      throw new LocalAgentSessionRestoreError(
        'The native conversation cannot be restored; create a new session to continue'
      )
    }
    await prepareAgentSessionWorkspaceDirectory(session)
    const { config, target } = launch
    const adapter = await localRuntimeAdapters[getLocalAgentProtocol(config.presetId)]()
    const connect = (localTarget: LocalLaunchTarget) => {
      const saved = localTarget.kind === 'resume' ? localTarget.context : undefined
      return adapter.connect(
        {
          ...input,
          localTarget,
          resumeToken: saved?.bindingState === 'bound' ? (saved.nativeThreadId ?? undefined) : undefined,
          nativeSessionId: saved?.nativeThreadId ?? undefined
        },
        config,
        session.workspace.path
      )
    }
    try {
      return await connect(target)
    } catch (error) {
      if (target.kind !== 'resume' || !(error instanceof LocalAgentSessionRestoreError)) throw error
      return connect({ ...target, kind: 'new', replaces: target.context })
    }
  }
}

export async function listLocalAgentModels(config: LocalAgentConfiguration): Promise<LocalAgentModelCatalog> {
  const adapter = await localRuntimeAdapters[getLocalAgentProtocol(config.presetId)]()
  const catalog = await adapter.listModels(config)
  return { ...catalog, models: enrichLocalAgentModels(catalog.models, config.presetId) }
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

export async function resolveLocalRuntimeAccount(config: LocalAgentConfiguration): Promise<RuntimeAccountAccess> {
  const adapter = await localRuntimeAdapters[getLocalAgentProtocol(config.presetId)]()
  const native = await adapter.bindAccount?.(config)
  const preset = getLocalAgentPreset(config.presetId)
  const hasCliLogin = preset?.cliLogin?.length || preset?.providerLogin
  return {
    ...native,
    ...(!native?.readAccount && preset?.accountProbe && { readAccount: (signal) => readCliAccount(config, signal) }),
    ...(hasCliLogin && {
      authenticate(request, host, signal) {
        const spec = resolveCliAuthCommand(config.presetId, request.methodId, request)
        if (spec) return authenticateViaCli(config, spec, host, signal)
        if (native?.authenticate) return native.authenticate(request, host, signal)
        throw new Error('Unknown authentication method')
      }
    })
  }
}

export async function readLocalAgentAccount(config: LocalAgentConfiguration): Promise<RuntimeAccountResult> {
  const access = await resolveLocalRuntimeAccount(config)
  return (
    access.readAccount?.(AbortSignal.timeout(10_000)).catch(() => ({ status: 'unknown' as const })) ?? {
      status: 'unsupported'
    }
  )
}
