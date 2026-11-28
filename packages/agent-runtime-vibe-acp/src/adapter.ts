import { acpConfigRecord, tomlModelField } from '@cherrystudio/agent-runtime-acp/profile'
import type { AcpAccountReader } from '@cherrystudio/agent-runtime-acp/v1'

import { vibeCli } from './cli'

export const vibeModelProfile = tomlModelField(vibeCli.modelConfig.target, 'active_model')

export const readVibeAccount: AcpAccountReader = async (agent) => {
  const status = acpConfigRecord(await agent.request('_auth/status', {}))
  if (status?.configError) return { status: 'unknown' }
  if (status?.authState === 'signed_out') return { status: 'signed-out' }
  if (
    status?.authenticated === true &&
    (status.authState === 'os_keyring' || status.authState === 'vibe_home_env_file')
  )
    return { status: 'signed-in' }
  return { status: 'unknown' }
}
