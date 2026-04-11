import { ENDPOINT_TYPE, type EndpointType } from '@shared/data/types/model'

export const endpointTypeOptions: { label: string; value: EndpointType }[] = [
  { value: ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS, label: 'endpoint_type.openai' },
  { value: ENDPOINT_TYPE.OPENAI_RESPONSES, label: 'endpoint_type.openai-response' },
  { value: ENDPOINT_TYPE.ANTHROPIC_MESSAGES, label: 'endpoint_type.anthropic' },
  { value: ENDPOINT_TYPE.GOOGLE_GENERATE_CONTENT, label: 'endpoint_type.gemini' },
  { value: ENDPOINT_TYPE.OPENAI_IMAGE_GENERATION, label: 'endpoint_type.image-generation' },
  { value: ENDPOINT_TYPE.JINA_RERANK, label: 'endpoint_type.jina-rerank' }
]
