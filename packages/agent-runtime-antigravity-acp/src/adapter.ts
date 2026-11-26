import type { AcpHarnessAdapter } from '@cherrystudio/agent-runtime-acp/v1'

import { antigravityCli } from './cli'
import { antigravityPermissions } from './permissions'

export const antigravityPreset = {
  id: antigravityCli.id,
  protocol: { ...antigravityPermissions, hostMutations: 'disabled' } satisfies AcpHarnessAdapter
}

export { readAntigravitySubscriptionUsage } from './accountUsage'
