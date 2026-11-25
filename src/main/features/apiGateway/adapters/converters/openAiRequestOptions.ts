import { UnsupportedFunctionalityError } from '@ai-sdk/provider'
import type { ProviderOptions } from '@ai-sdk/provider-utils'
import { jsonSchema, Output } from 'ai'

import type OpenAI from '@cherrystudio/openai'
import type { ResponseFormatJSONSchema } from '@cherrystudio/openai/resources'
import {
  resolveAiSdkProviderId,
  resolveEffectiveEndpoint,
  resolveEndpointProviderOptionsKey,
  type ResolvedEndpoint
} from '@main/ai/provider/endpoint'
import { ENDPOINT_TYPE, type Model } from '@shared/data/types/model'
import type { Provider } from '@shared/data/types/provider'

import type { StreamTextOptions } from '../interfaces'

type OutputFormat =
  | Exclude<OpenAI.Responses.ResponseFormatTextConfig, { type: 'json_schema' }>
  | ({ type: 'json_schema' } & ResponseFormatJSONSchema['json_schema'])

function supportsNativeOpenAiOptions(adapter: string, endpoint: ResolvedEndpoint): boolean {
  return (
    ['openai', 'openai-chat', 'azure', 'azure-responses'].includes(adapter) ||
    (endpoint.providerOptionsKey === 'openai' && ['aihubmix', 'dmxapi'].includes(adapter)) ||
    (endpoint.endpointType === ENDPOINT_TYPE.OPENAI_RESPONSES && ['cherryin', 'newapi'].includes(adapter))
  )
}

export function mergeGatewayProviderOptions(
  ...groups: Array<ProviderOptions | undefined>
): ProviderOptions | undefined {
  const result: ProviderOptions = {}
  for (const group of groups) {
    for (const [key, value] of Object.entries(group ?? {})) result[key] = { ...result[key], ...value }
  }
  return Object.keys(result).length ? result : undefined
}

export function openAiOutput(format: OutputFormat | null | undefined): StreamTextOptions['output'] {
  switch (format?.type) {
    case undefined:
    case 'text':
      return undefined
    case 'json_object':
      return Output.json()
    case 'json_schema':
      if (!format.schema)
        throw new UnsupportedFunctionalityError({ functionality: 'JSON schema output without a schema' })
      return Output.object({ schema: jsonSchema(format.schema), name: format.name, description: format.description })
    default:
      throw new UnsupportedFunctionalityError({ functionality: 'OpenAI output format' })
  }
}

export function openAiToolChoice(
  choice: OpenAI.Responses.ResponseCreateParams['tool_choice']
): StreamTextOptions['toolChoice'] {
  if (choice == null || typeof choice === 'string') return choice ?? undefined
  if (choice.type === 'function') return { type: 'tool', toolName: choice.name }
  throw new UnsupportedFunctionalityError({ functionality: `OpenAI tool choice: ${choice.type}` })
}

export function parallelToolOptions(
  provider: Provider,
  model: Model,
  parallel: boolean | null | undefined
): ProviderOptions | undefined {
  if (parallel == null) return undefined
  const endpoint = resolveEffectiveEndpoint(provider, model)
  const key = resolveEndpointProviderOptionsKey(provider, endpoint)
  if (supportsNativeOpenAiOptions(resolveAiSdkProviderId(provider, endpoint.endpointType), endpoint)) {
    return { [key]: { parallelToolCalls: parallel } }
  }
  if (key === 'anthropic' && endpoint.endpointType === ENDPOINT_TYPE.ANTHROPIC_MESSAGES) {
    return { anthropic: { disableParallelToolUse: !parallel } }
  }
  if (!parallel) {
    throw new UnsupportedFunctionalityError({
      functionality: 'Disabling parallel tool calls for the selected provider'
    })
  }
  return undefined
}

export function nativeOpenAiOptions(
  provider: Provider,
  model: Model,
  options: NonNullable<ProviderOptions[string]>
): ProviderOptions | undefined {
  if (!Object.keys(options).length) return undefined
  const endpoint = resolveEffectiveEndpoint(provider, model)
  const key = resolveEndpointProviderOptionsKey(provider, endpoint)
  const adapter = resolveAiSdkProviderId(provider, endpoint.endpointType)
  if (adapter === 'open-responses') {
    const unsupported = Object.entries(options).filter(
      ([name, value]) => name !== 'reasoningSummary' && !(name === 'strictJsonSchema' && value === true)
    )
    if (!unsupported.length)
      return options.reasoningSummary === undefined
        ? undefined
        : { [key]: { reasoningSummary: options.reasoningSummary } }
  }
  if (
    !supportsNativeOpenAiOptions(adapter, endpoint) ||
    ![ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS, ENDPOINT_TYPE.OPENAI_RESPONSES].some(
      (type) => type === endpoint.endpointType
    )
  ) {
    throw new UnsupportedFunctionalityError({
      functionality: `OpenAI provider options for the selected provider: ${Object.keys(options).join(', ')}`
    })
  }
  if (endpoint.endpointType === ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS) {
    if (
      options.truncation !== undefined ||
      options.reasoningSummary !== undefined ||
      (Array.isArray(options.include) && options.include.some((item) => item !== 'message.output_text.logprobs'))
    ) {
      throw new UnsupportedFunctionalityError({ functionality: 'Responses-only options on a Chat Completions target' })
    }
    const chatOptions = { ...options }
    delete chatOptions.include
    return { [key]: chatOptions }
  }
  return { [key]: options }
}
