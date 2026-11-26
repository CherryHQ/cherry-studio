import { acpConfigRecord, tomlModelField, type AcpGatewayConfig } from '@cherrystudio/agent-runtime-acp/profile'
import { readCachedAcpAccount, type AcpAccountReader } from '@cherrystudio/agent-runtime-acp/v1'

export const readKimiAccount: AcpAccountReader = async (agent, response, { env }) => {
  if (env.KIMI_API_KEY || env.KIMI_CODE_API_KEY) return { status: 'unknown' }
  return readCachedAcpAccount(agent, response, 'login')
}

export const kimiModelProfile = tomlModelField('kimi-config', 'default_model')

export const kimiGateway = {
  format: 'toml',
  read(doc, model) {
    const entry = acpConfigRecord(acpConfigRecord(doc.models)?.[model])
    const provider =
      typeof entry?.provider === 'string'
        ? acpConfigRecord(acpConfigRecord(doc.providers)?.[entry.provider])
        : undefined
    return {
      baseUrl: provider?.base_url,
      apiKey: provider?.api_key,
      model: entry?.model,
      path: '/v1/chat/completions'
    }
  }
} satisfies AcpGatewayConfig
