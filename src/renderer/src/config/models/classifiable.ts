/**
 * Minimal model interface accepted by config/models classification functions.
 * Both v1 Model (@renderer/types) and v2 Model (@shared/data/types/model)
 * structurally satisfy this interface.
 */
export interface ClassifiableModel {
  id: string
  name: string
  provider?: string
  providerId?: string
  group?: string
  capabilities?: any[]
  /** v2: array of supported endpoint types */
  endpointTypes?: string[]
  /** v1: single endpoint type */
  endpoint_type?: string
  /** v1: array of supported endpoint types */
  supported_endpoint_types?: string[]
}

/**
 * Extract provider ID from either v1 (model.provider) or v2 (model.providerId).
 */
export function getModelProviderId(model: ClassifiableModel): string | undefined {
  return model.provider ?? model.providerId
}

const V1_TO_V2_ENDPOINT: Record<string, string> = {
  openai: 'openai-chat-completions',
  'openai-response': 'openai-responses',
  anthropic: 'anthropic-messages',
  gemini: 'google-generate-content',
  'image-generation': 'openai-image-generation'
}

function normalizeEndpointType(ep: string): string {
  return V1_TO_V2_ENDPOINT[ep] ?? ep
}

/**
 * Get endpoint types from either v1 or v2 model, normalized to v2 format.
 */
export function getModelEndpointTypes(model: ClassifiableModel): string[] {
  if (model.endpointTypes?.length) return model.endpointTypes
  if (model.supported_endpoint_types?.length) return model.supported_endpoint_types.map(normalizeEndpointType)
  if (model.endpoint_type) return [normalizeEndpointType(model.endpoint_type)]
  return []
}

/**
 * Check if model supports a specific v2 endpoint type (works for both v1 and v2 models).
 */
export function modelHasEndpointType(model: ClassifiableModel, endpointType: string): boolean {
  return getModelEndpointTypes(model).includes(endpointType)
}
