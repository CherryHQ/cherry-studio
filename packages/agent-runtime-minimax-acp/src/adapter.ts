import { acpConfigRecord, type AcpGatewayConfig } from '@cherrystudio/agent-runtime-acp/profile'

import { minimaxCli } from './cli'

function minimaxModelId(model: string) {
  const slash = model.indexOf('/')
  return slash > 0
    ? 'm:' + encodeURIComponent(model.slice(0, slash)) + ':' + encodeURIComponent(model.slice(slash + 1)) + ':v:'
    : model
}

const minimaxGateway = {
  format: 'yaml',
  read(doc, model) {
    const match = /^custom_provider:([^/]+)\/(.+)$/.exec(model)
    if (!match) return
    const provider = acpConfigRecord(acpConfigRecord(doc.custom_provider)?.[match[1]])
    const options = acpConfigRecord(provider?.options)
    const path =
      provider?.npm === '@ai-sdk/openai'
        ? '/v1/responses'
        : provider?.npm === '@ai-sdk/anthropic'
          ? '/v1/messages'
          : '/v1/chat/completions'
    return { baseUrl: options?.baseURL, apiKey: options?.apiKey, model: match[2], path }
  }
} satisfies AcpGatewayConfig

export const minimaxPreset = {
  id: minimaxCli.id,
  gateway: minimaxGateway,
  catalogId: minimaxModelId,
  profile: { format: 'yaml', target: 'minimax-config', path: ['defaultModel'] }
} as const
