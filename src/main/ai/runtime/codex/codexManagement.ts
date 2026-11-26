import { withCodexAppServer, type CodexProbeClient } from '@cherrystudio/agent-runtime-codex/launcher'
import type { LocalAgentConfiguration, LocalAgentModelCatalog } from '@shared/ai/localAgent'

import { withConnectionTimeout } from '../localAgent/connectionTimeout'
import { resolveCodexLaunch } from '../localAgent/launch'
import { codexProcessHost } from './processHost'

export function checkCodex(config: LocalAgentConfiguration, cwd: string) {
  return withCodexManagement(config, cwd, () => undefined)
}

export function listCodexModels(config: LocalAgentConfiguration, cwd: string): Promise<LocalAgentModelCatalog> {
  return withCodexManagement(config, cwd, async (server) => ({
    models: (await server.listModels()).map((model) => ({ id: model.model ?? model.id, name: model.displayName }))
  }))
}

async function withCodexManagement<T>(
  config: LocalAgentConfiguration,
  cwd: string,
  operation: (client: CodexProbeClient) => T | Promise<T>
) {
  const abort = new AbortController()
  const run = async () => {
    const launch = await resolveCodexLaunch(config, cwd, abort.signal, 'models')
    return withCodexAppServer(launch, codexProcessHost, abort.signal, operation)
  }
  const probing = run()
  try {
    return await withConnectionTimeout(probing, () => abort.abort())
  } finally {
    await probing.catch(() => {})
  }
}
