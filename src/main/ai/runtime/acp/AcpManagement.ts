import type { RuntimeLoginHost } from '@cherrystudio/agent-runtime'
import {
  acpAuthMethods,
  advertisesAcpSubscriptionUsage,
  connectAcpManagementStdio,
  type AcpAccountReader,
  type AcpManagementAgent,
  type AcpSubscriptionUsageReader
} from '@cherrystudio/agent-runtime-acp/v1'
import { localCliPresetById, type LocalAgentConfiguration, type LocalAgentModelCatalog } from '@shared/ai/localAgent'

import { acpError } from './acpError'
import { acpModelSelection, resolveAcpLaunch, resolveAcpModelLaunch } from './acpLaunch'
import { acpPreset } from './acpPresets'
import { AcpProcess } from './AcpProcess'
import { acpProtocolInfo } from './acpSessionInfo'

export class AcpManagement {
  private readonly process = new AcpProcess()
  private readonly controller = new AbortController()
  private closeSession?: () => Promise<unknown>

  constructor(private readonly config: LocalAgentConfiguration) {}

  check(cwd: string) {
    return this.run(cwd, resolveAcpLaunch, (agent) => acpProtocolInfo(agent.response))
  }

  authenticate(cwd: string, methodId: string, confirmLoginInBrowser: RuntimeLoginHost['confirmBrowser']) {
    return this.run(
      cwd,
      resolveAcpLaunch,
      (agent) => agent.authenticate(methodId),
      (stdin, stdout, info) => connectAcpManagementStdio(stdin, stdout, info, confirmLoginInBrowser)
    )
  }

  listModels(cwd: string): Promise<LocalAgentModelCatalog> {
    return this.run(cwd, resolveAcpModelLaunch, async (agent, launch) => {
      const id = this.config.presetId
      const { models, activeModel, closeSession } = await agent.readModels(cwd, {
        read: acpPreset(id)?.readModelCatalog,
        legacyModes: id ? localCliPresetById.get(id)?.legacyModes : undefined
      })
      this.closeSession = closeSession
      const implicit = acpModelSelection(this.config, launch).implicit
      return {
        models,
        activeModel: activeModel ?? (implicit ? { id: implicit } : undefined),
        authMethods: acpAuthMethods(agent.response),
        ...(advertisesAcpSubscriptionUsage(agent.response) && { subscriptionUsage: true })
      }
    })
  }

  readSubscriptionUsage(cwd: string, reader: AcpSubscriptionUsageReader) {
    return this.run(
      cwd,
      (config, signal) => resolveAcpLaunch(config, signal, 'account'),
      (agent, launch) =>
        agent.readSubscriptionUsage(reader, { env: launch.env, model: this.config.nativeModel ?? launch.nativeModel })
    )
  }

  readAccount(cwd: string, read: AcpAccountReader, args?: readonly string[]) {
    return this.run(
      cwd,
      async (config, signal) => {
        const launch = await resolveAcpLaunch(config, signal, 'account')
        return args ? { ...launch, args: [...args] } : launch
      },
      (agent, launch) => agent.readAccount(read, launch)
    )
  }

  close(): Promise<void> {
    this.controller.abort()
    return this.process.close(this.closeSession)
  }

  private async run<T>(
    cwd: string,
    resolveLaunch: typeof resolveAcpModelLaunch,
    operation: (agent: AcpManagementAgent, launch: Awaited<ReturnType<typeof resolveAcpModelLaunch>>) => Promise<T> | T,
    connect = connectAcpManagementStdio
  ): Promise<T> {
    try {
      const signal = this.controller.signal
      const launch = await resolveLaunch(this.config, signal)
      const client = await this.process.open(this.config, launch, cwd, signal, connect)
      return await operation(await client.initialize(), launch)
    } catch (error) {
      throw acpError(error, this.process.stderr)
    }
  }
}

export async function authenticateLocalAcp(
  config: LocalAgentConfiguration,
  cwd: string,
  methodId: string,
  confirmLoginInBrowser: RuntimeLoginHost['confirmBrowser'],
  signal: AbortSignal
) {
  signal.throwIfAborted()
  const management = new AcpManagement(config)
  const cancel = () => {
    void management.close().catch(() => {})
  }
  signal.addEventListener('abort', cancel, { once: true })
  try {
    await management.authenticate(cwd, methodId, confirmLoginInBrowser)
  } finally {
    signal.removeEventListener('abort', cancel)
    await management.close()
  }
}
