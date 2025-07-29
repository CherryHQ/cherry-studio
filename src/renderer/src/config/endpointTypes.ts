import { EndpointType } from '@renderer/types'

export const endpointTypeOptions: { label: string; value: EndpointType }[] = [
  { value: 'openai', label: 'endpoint_type.openai' },
  { value: 'openai-response', label: 'endpoint_type.openai-response' },
  { value: 'anthropic', label: 'endpoint_type.anthropic' },
  { value: 'gemini', label: 'endpoint_type.gemini' },
  { value: 'image-generation', label: 'endpoint_type.image-generation' },
  { value: 'jina-rerank', label: 'endpoint_type.jina-rerank' }
]
