import { acpAuthMethods, connectAcpManagementStdio, type AcpManagementAgent } from '@cherrystudio/agent-runtime-acp/v1'
import type { LocalAgentConfiguration, LocalAgentModelCatalog } from '@shared/ai/localAgent'

import { acpError } from './acpError'
import { AcpProcess } from './AcpProcess'
import { acpProtocolInfo } from './acpSessionInfo'
import { resolveLocalAgentLaunch, resolveLocalAgentModelLaunch } from './launch'

export class AcpManagement {
  private readonly process = new AcpProcess()
  private readonly controller = new AbortController()
  private closeSession?: () => Promise<unknown>

  constructor(private readonly config: LocalAgentConfiguration) {}

  check(cwd: string) {
    return this.run(cwd, resolveLocalAgentLaunch, (agent) => acpProtocolInfo(agent.response))
  }

  authenticate(cwd: string, methodId: string) {
    return this.run(cwd, resolveLocalAgentLaunch, (agent) => agent.authenticate(methodId))
  }

  listModels(cwd: string): Promise<LocalAgentModelCatalog> {
    return this.run(cwd, resolveLocalAgentModelLaunch, async (agent, launch) => {
      const { models, activeModel, closeSession } = await agent.readModels(cwd)
      this.closeSession = closeSession
      return {
        models,
        activeModel:
          activeModel ??
          (this.config.presetId === 'snow' && launch.nativeModel ? { id: launch.nativeModel } : undefined),
        authMethods: acpAuthMethods(agent.response)
      }
    })
  }

  close(): Promise<void> {
    this.controller.abort()
    return this.process.close(this.closeSession)
  }

  private async run<T>(
    cwd: string,
    resolveLaunch: typeof resolveLocalAgentModelLaunch,
    operation: (
      agent: AcpManagementAgent,
      launch: Awaited<ReturnType<typeof resolveLocalAgentModelLaunch>>
    ) => Promise<T> | T
  ): Promise<T> {
    try {
      const signal = this.controller.signal
      const launch = await resolveLaunch(this.config, signal)
      const client = await this.process.open(this.config, launch, cwd, signal, connectAcpManagementStdio)
      return await operation(await client.initialize(), launch)
    } catch (error) {
      throw acpError(error, this.process.stderr)
    }
  }
}
