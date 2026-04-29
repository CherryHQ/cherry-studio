import type { EndpointType } from '@renderer/types'
import type { Provider } from '@renderer/types'
import { isVolcengineProvider } from '@renderer/utils/provider'

export const endpointTypeOptions: { label: string; value: EndpointType }[] = [
  { value: 'openai', label: 'endpoint_type.openai' },
  { value: 'openai-response', label: 'endpoint_type.openai-response' },
  { value: 'anthropic', label: 'endpoint_type.anthropic' },
  { value: 'gemini', label: 'endpoint_type.gemini' },
  { value: 'image-generation', label: 'endpoint_type.image-generation' },
  { value: 'jina-rerank', label: 'endpoint_type.jina-rerank' }
]

export function getEndpointTypeOptions(provider: Provider): { label: string; value: EndpointType }[] {
  if (isVolcengineProvider(provider)) {
    return endpointTypeOptions.filter((option) => option.value === 'openai' || option.value === 'openai-response')
  }

  return endpointTypeOptions
}
