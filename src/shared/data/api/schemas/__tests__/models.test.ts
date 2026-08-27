import { ENDPOINT_TYPE } from '@shared/data/types/model'
import { describe, expect, it } from 'vitest'

import { CreateModelSchema, UpdateModelSchema } from '../models'

describe('model endpoint preference validation', () => {
  it('accepts a create preference without a model-owned endpoint set', () => {
    expect(
      CreateModelSchema.parse({
        providerId: 'relay',
        modelId: 'model',
        preferredEndpointType: ENDPOINT_TYPE.OPENAI_RESPONSES
      })
    ).toMatchObject({ preferredEndpointType: ENDPOINT_TYPE.OPENAI_RESPONSES })
  })

  it('rejects a create preference outside the declared endpoint set', () => {
    const result = CreateModelSchema.safeParse({
      providerId: 'relay',
      modelId: 'model',
      endpointTypes: [ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS],
      preferredEndpointType: ENDPOINT_TYPE.ANTHROPIC_MESSAGES
    })

    expect(result.success).toBe(false)
    expect(result.error?.issues[0]?.path).toEqual(['preferredEndpointType'])
  })

  it('rejects an update that supplies a conflicting endpoint set and preference', () => {
    expect(() =>
      UpdateModelSchema.parse({
        endpointTypes: [ENDPOINT_TYPE.OPENAI_RESPONSES],
        preferredEndpointType: ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS
      })
    ).toThrow()
  })

  it('accepts an update that changes only the preference', () => {
    expect(UpdateModelSchema.parse({ preferredEndpointType: ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS })).toEqual({
      preferredEndpointType: ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS
    })
  })

  it('preserves null over the wire so an update can clear the preference', () => {
    expect(UpdateModelSchema.parse({ preferredEndpointType: null })).toEqual({ preferredEndpointType: null })
  })
})
