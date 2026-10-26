import { ENDPOINT_TYPE, type EndpointType } from '@shared/data/types/model'

import { createLanguageModelAdapters, type LanguageModelAdapter } from '../../languageModelAdapter'

const { anthropic, google, openaiChat, responses, compatible } = createLanguageModelAdapters('dmxapi')

/** Select an implementation within the requested protocol, never a different endpoint. */
export function resolveDmxapiLanguageModelAdapter(
  endpointType: EndpointType | undefined,
  modelId: string
): LanguageModelAdapter | undefined {
  switch (endpointType) {
    case ENDPOINT_TYPE.ANTHROPIC_MESSAGES:
      return anthropic
    case ENDPOINT_TYPE.GOOGLE_GENERATE_CONTENT:
      return google
    case ENDPOINT_TYPE.OPENAI_RESPONSES:
      return responses
    case ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS:
      return /^(gpt-|o\d)/i.test(modelId) && !/(image|dall-e)/i.test(modelId) ? openaiChat : compatible
    default:
      return undefined
  }
}
