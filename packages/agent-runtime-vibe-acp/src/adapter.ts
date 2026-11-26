import {
  acpConfigRecord,
  acpGatewayPath,
  tomlModelField,
  type AcpGatewayConfig
} from '@cherrystudio/agent-runtime-acp/profile'

import { vibeCli } from './cli'

export const vibeModelProfile = tomlModelField(vibeCli.modelConfig.target, 'active_model')

export function vibeInstall() {
  return { manager: 'uv' as const, package: 'mistral-vibe', args: ['tool', 'install', '--upgrade', 'mistral-vibe'] }
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
