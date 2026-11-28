import { acpConfigRecord, jsonModelField, type AcpJsonModelProfile } from '@cherrystudio/agent-runtime-acp/profile'

function readGlmConnection(doc: Record<string, unknown>) {
  if (doc.cherry_managed === true) return { baseUrl: doc.base_url, apiKey: doc.z_ai_api_key, model: doc.model }
  const provider =
    typeof doc.provider === 'string' ? acpConfigRecord(acpConfigRecord(doc.providers)?.[doc.provider]) : undefined
  return { baseUrl: provider?.baseUrl, apiKey: provider?.apiKey, model: provider?.model }
}

export const glmModelProfile = {
  ...jsonModelField('glm-credentials', 'model'),
  launch(doc, env, _get, _related, purpose) {
    if (doc.cherry_managed !== true && !(typeof doc.provider === 'string' && doc.provider.startsWith('cherry-'))) return
    const { apiKey, baseUrl, model } = readGlmConnection(doc)
    if (typeof apiKey === 'string' && apiKey) env.Z_AI_API_KEY = apiKey
    if (typeof baseUrl === 'string' && baseUrl) env.ACP_GLM_BASE_URL = baseUrl
    if (typeof model === 'string' && model) {
      env.ACP_GLM_MODEL = model
      if (purpose !== 'models') env.ACP_GLM_AVAILABLE_MODELS = model
    }
    return typeof model === 'string' ? model : undefined
  }
} satisfies AcpJsonModelProfile<'glm-credentials'>

export { readGlmSubscriptionUsage } from './accountUsage'
