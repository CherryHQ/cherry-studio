import { tomlModelField } from '@cherrystudio/agent-runtime-acp/profile'
import { readCachedAcpAccount, type AcpAccountReader } from '@cherrystudio/agent-runtime-acp/v1'

export const readKimiAccount: AcpAccountReader = async (agent, response, { env }) => {
  if (env.KIMI_API_KEY || env.KIMI_CODE_API_KEY) return { status: 'unknown' }
  return readCachedAcpAccount(agent, response, 'login')
}

export const kimiModelProfile = tomlModelField('kimi-config', 'default_model')
