import {
  acpConfigRecord,
  acpGatewayPath,
  tomlModelField,
  type AcpGatewayConfig
} from '@cherrystudio/agent-runtime-acp/profile'
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

export const vibeGateway = {
  format: 'toml',
  envFile: 'vibe-env',
  read(doc, model, env) {
    const providers = Array.isArray(doc.providers) ? doc.providers : []
    const models = Array.isArray(doc.models) ? doc.models : []
    const provider = acpConfigRecord(providers.find((entry: unknown) => acpConfigRecord(entry)?.name === model))
    const entry = acpConfigRecord(
      models.find((item: unknown) => {
        const record = acpConfigRecord(item)
        return record?.alias === model || record?.provider === model
      })
    )
    const key = typeof provider?.api_key_env_var === 'string' ? provider.api_key_env_var : 'CHERRY_VIBE_API_KEY'
    return {
      baseUrl: provider?.api_base,
      apiKey: env(key),
      model: entry?.name,
      path: acpGatewayPath(provider?.api_style)
    }
  }
} satisfies AcpGatewayConfig<'vibe-env'>
