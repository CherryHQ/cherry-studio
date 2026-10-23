import { describe, expect, it } from 'vitest'

import { ENDPOINT_TYPE, MODEL_CAPABILITY, ModelSchema } from '@shared/data/types/model'

import { getInitialAddModelFormState, splitModelIds, toggleModelValue } from './helpers'

describe('model drawer fields', () => {
  it('deduplicates model IDs without changing their order', () => {
    expect(splitModelIds(' alpha, beta, alpha, ,beta ')).toEqual(['alpha', 'beta'])
  })
  it('preserves all prefilled endpoints ahead of the provider default', () => {
    const endpointTypes = [ENDPOINT_TYPE.GOOGLE_GENERATE_CONTENT, ENDPOINT_TYPE.OPENAI_RESPONSES]
    expect(getInitialAddModelFormState({ endpointTypes }, ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS).endpointTypes).toEqual(
      endpointTypes
    )
  })
  it('uses an explicit endpoint entry point ahead of the provider default', () => {
    expect(
      getInitialAddModelFormState(
        { endpointType: ENDPOINT_TYPE.GOOGLE_GENERATE_CONTENT },
        ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS
      ).endpointTypes
    ).toEqual([ENDPOINT_TYPE.GOOGLE_GENERATE_CONTENT])
  })
  it('leaves undeclared endpoints empty for provider inheritance', () => {
    expect(getInitialAddModelFormState(null).endpointTypes).toEqual([])
  })
  it('adds and removes one capability without dropping other catalog capabilities', () => {
    const original = [MODEL_CAPABILITY.AUDIO_GENERATION, MODEL_CAPABILITY.STRUCTURED_OUTPUT]
    expect(toggleModelValue(original, MODEL_CAPABILITY.IMAGE_GENERATION)).toEqual([
      ...original,
      MODEL_CAPABILITY.IMAGE_GENERATION
    ])
    expect(
      toggleModelValue([...original, MODEL_CAPABILITY.IMAGE_GENERATION], MODEL_CAPABILITY.IMAGE_GENERATION)
    ).toEqual(original)
  })
  it('preserves numeric token limits from a catalog model', () => {
    const model = ModelSchema.parse({
      providerId: 'openai',
      capabilities: [],
      supportsStreaming: true,
      isEnabled: true,
      isHidden: false,
      id: 'openai::gpt-test',
      name: 'GPT Test',
      contextWindow: 128_000,
      maxInputTokens: 64_000
    })
    expect(getInitialAddModelFormState({ model })).toEqual(
      expect.objectContaining({ contextWindow: 128_000, maxInputTokens: 64_000, maxOutputTokens: null })
    )
  })
})
