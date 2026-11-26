import { describeCodexModel } from '@cherrystudio/agent-runtime-codex'
import { withCodexAppServer, type CodexProbeClient } from '@cherrystudio/agent-runtime-codex/launcher'
import type { LocalAgentConfiguration, LocalAgentModelCatalog } from '@shared/ai/localAgent'

import { resolveCodexLaunch } from './codexLaunch'
import { codexProcessHost } from './processHost'

export function checkCodex(config: LocalAgentConfiguration, cwd: string) {
  return withCodexManagement(config, cwd, () => undefined)
}

export function listCodexModels(config: LocalAgentConfiguration, cwd: string): Promise<LocalAgentModelCatalog> {
  return withCodexManagement(config, cwd, async (server) => ({
    models: (await server.listModels()).map(describeCodexModel)
  }))
}

async function withCodexManagement<T>(
  config: LocalAgentConfiguration,
  cwd: string,
  operation: (client: CodexProbeClient) => T | Promise<T>
) {
  const signal = AbortSignal.timeout(30_000)
  const launch = await resolveCodexLaunch(config, cwd, signal, 'models')
  return withCodexAppServer(launch, codexProcessHost, signal, operation)
}
