import type { LocalLaunchTarget } from '@main/ai/agentSession/localContext'
import { getLocalAgentModelSelection, type LocalAgentConfiguration } from '@shared/ai/localAgent'

export function localLaunch(config: LocalAgentConfiguration, providerId = 'test-provider') {
  return {
    config: { ...config, providerId },
    target: {
      kind: 'new',
      providerId,
      env: config.env,
      encryptedEnv: null,
      model: getLocalAgentModelSelection(config)
    } satisfies LocalLaunchTarget
  }
}
