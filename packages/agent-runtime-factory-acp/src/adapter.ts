import { acpConfigRecord, jsonModelField, type AcpGatewayConfig } from '@cherrystudio/agent-runtime-acp/profile'

export const factoryModelProfile = jsonModelField('factory-settings', 'sessionDefaultSettings', 'model')

export const factoryGateway = {
  format: 'json',
  read(doc, model) {
    const modelId = model.startsWith('custom:') ? model.slice('custom:'.length) : model
    const models = Array.isArray(doc.customModels) ? doc.customModels : []
    const entry = acpConfigRecord(models.find((item: unknown) => acpConfigRecord(item)?.model === modelId))
    return {
      baseUrl: entry?.baseUrl,
      apiKey: entry?.apiKey,
      model: entry?.model,
      path:
        entry?.provider === 'anthropic'
          ? '/v1/messages'
          : entry?.provider === 'openai'
            ? '/v1/responses'
            : '/v1/chat/completions'
    }
  }
} satisfies AcpGatewayConfig

export { readFactoryAccount, readFactorySubscriptionUsage } from './accountUsage'
