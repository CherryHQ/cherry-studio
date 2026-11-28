import { application } from '@application'
import type { RuntimeAccountAccess } from '@cherrystudio/agent-runtime'
import {
  acpSubscriptionUsageFailure,
  readNegotiatedAcpUsage,
  type AcpSubscriptionUsageReader
} from '@cherrystudio/agent-runtime-acp/v1'
import { withStartupSignal } from '@cherrystudio/agent-runtime/stdio'
import {
  ACP_LAUNCH_BYPASS_VALUE,
  getLocalPermissionChoice,
  usesPresetAcpLaunch,
  type LocalAgentConfiguration,
  type LocalAgentRuntime
} from '@shared/ai/localAgent'

import { spawnLocalAgentStdio } from '../stdioProcess'
import type { LocalRuntimeConnectInput } from '../types'
import { resolveAcpLaunch } from './acpLaunch'
import { AcpManagement, authenticateLocalAcp } from './AcpManagement'
import { acpPreset } from './acpPresets'

export async function connect(input: LocalRuntimeConnectInput, config: LocalAgentRuntime, cwd: string) {
  const { AcpConnection } = await import('./AcpConnection')
  const start = (bypass = false) => {
    const live = new AcpConnection(input.sessionId, input.agentId, config, input.localTarget, input.headless)
    return withStartupSignal(
      AbortSignal.timeout(30_000),
      () => live.start(cwd, input.resumeToken, bypass, input.localPermissionMode),
      () => live.close()
    )
  }
  const live = await start()
  if (
    input.localPermissionMode !== 'bypassPermissions' ||
    getLocalPermissionChoice(live.localSessionInfo.launchPermission, 'bypassPermissions')?.value !==
      ACP_LAUNCH_BYPASS_VALUE
  )
    return live
  await live.close()
  return start(true)
}

export function listModels(config: LocalAgentConfiguration) {
  const cwd = application.getPath('cherry.bin')
  return withManagement({ ...config, nativeModel: undefined }, (access) => access.listModels(cwd))
}

export function check(config: LocalAgentConfiguration) {
  const cwd = application.getPath('cherry.bin')
  return withManagement(config, (access) => access.check(cwd))
}

async function withManagement<T>(
  config: LocalAgentConfiguration,
  operation: (access: AcpManagement) => Promise<T>,
  signal = AbortSignal.timeout(30_000)
) {
  const access = new AcpManagement(config)
  try {
    return await withStartupSignal(
      signal,
      () => operation(access),
      () => access.close()
    )
  } finally {
    await access.close()
  }
}

async function readAcpSubscriptionUsage(
  config: LocalAgentConfiguration,
  cwd: string,
  reader: AcpSubscriptionUsageReader,
  signal: AbortSignal
) {
  const access = new AcpManagement(config)
  try {
    return await withStartupSignal(
      signal,
      () => access.readSubscriptionUsage(cwd, reader),
      () => access.close()
    )
  } catch (error) {
    signal.throwIfAborted()
    return acpSubscriptionUsageFailure(error)
  } finally {
    await access.close()
  }
}

export function bindAccount(config: LocalAgentConfiguration): RuntimeAccountAccess {
  const cwd = application.getPath('cherry.bin')
  const target = usesPresetAcpLaunch(config) ? acpPreset(config.presetId) : undefined
  const usage = target?.subscriptionUsage
  const account = target?.account
  return {
    ...(account && {
      async readAccount(signal) {
        if (account.transport === 'acp')
          return withManagement(config, (access) => access.readAccount(cwd, account.read, account.args), signal)
        const launch = await resolveAcpLaunch(config, signal, 'account')
        return account.read({ ...launch, cwd }, spawnLocalAgentStdio, signal)
      }
    }),
    async readSubscriptionUsage(signal) {
      if (config.sourceModelViaGateway) return { status: 'unsupported' }
      if (!usage || usage.transport === 'acp') {
        return readAcpSubscriptionUsage(config, cwd, usage?.read ?? readNegotiatedAcpUsage, signal)
      }
      const launch = await resolveAcpLaunch(
        config,
        signal,
        usage.transport === 'terminal' ? 'terminal-account' : 'account'
      )
      if (usage.transport === 'cli' && launch.installation?.componentId !== usage.executable)
        return readAcpSubscriptionUsage(config, cwd, readNegotiatedAcpUsage, signal)
      return usage.read(
        {
          executable: launch.executable,
          cwd,
          env: launch.env,
          args: [],
          model: config.nativeModel ?? launch.nativeModel
        },
        spawnLocalAgentStdio,
        signal
      )
    },
    authenticate: ({ methodId }, host, signal) =>
      authenticateLocalAcp(config, cwd, methodId, host.confirmBrowser, signal)
  }
}
