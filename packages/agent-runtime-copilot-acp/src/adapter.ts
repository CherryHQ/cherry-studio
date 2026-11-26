import { acpConfigRecord, jsonModelField, type AcpGatewayConfig } from '@cherrystudio/agent-runtime-acp/profile'

export const copilotModelProfile = jsonModelField('copilot-settings', 'model')

export const copilotGateway = {
  format: 'json',
  target: 'copilot-providers',
  read(doc, model) {
    const slash = model.indexOf('/')
    if (slash < 1) return undefined
    const name = model.slice(0, slash)
    const providers = Array.isArray(doc.providers) ? doc.providers : []
    const provider = acpConfigRecord(providers.find((entry: unknown) => acpConfigRecord(entry)?.name === name))
    return {
      baseUrl: provider?.baseUrl,
      apiKey: provider?.apiKey,
      model: model.slice(slash + 1),
      path:
        provider?.type === 'anthropic'
          ? '/v1/messages'
          : provider?.wireApi === 'responses'
            ? '/v1/responses'
            : '/v1/chat/completions'
    }
  }
} satisfies AcpGatewayConfig<'copilot-providers'>
