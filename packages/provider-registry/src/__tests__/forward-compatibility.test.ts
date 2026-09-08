import { describe, expect, it } from 'vitest'

import { ModelListSchema } from '../schemas/model'
import { ProviderListSchema } from '../schemas/provider'
import { ProviderModelListSchema } from '../schemas/provider-models'

/**
 * Every case here is a payload a NEWER generator can emit. Before `looseArray`
 * each one failed the whole document, which is what forced a
 * `REGISTRY_SCHEMA_VERSION` bump for any new enum member.
 */
describe('reading a catalog emitted by a newer generator', () => {
  it('drops an unknown effort but keeps the model and its known ladder', () => {
    const parsed = ModelListSchema.parse({
      version: '1.0.0',
      models: [
        {
          id: 'gpt-7',
          name: 'GPT-7',
          reasoning: { controls: [{ kind: 'effort', values: ['low', 'hyper', 'max'] }] }
        }
      ]
    })

    expect(parsed.models).toHaveLength(1)
    expect(parsed.models[0].reasoning?.controls).toEqual([{ kind: 'effort', values: ['low', 'max'] }])
  })

  it('drops an unknown capability and modality, not the model that declares them', () => {
    const parsed = ModelListSchema.parse({
      version: '1.0.0',
      models: [
        {
          id: 'gpt-7',
          name: 'GPT-7',
          capabilities: ['reasoning', 'telepathy'],
          inputModalities: ['text', 'smell']
        }
      ]
    })

    expect(parsed.models[0]).toMatchObject({ capabilities: ['reasoning'], inputModalities: ['text'] })
  })

  it('drops an unknown reasoning control kind, not the model', () => {
    const parsed = ModelListSchema.parse({
      version: '1.0.0',
      models: [
        {
          id: 'gpt-7',
          name: 'GPT-7',
          reasoning: { controls: [{ kind: 'dial', steps: 11 }, { kind: 'toggle' }] }
        }
      ]
    })

    expect(parsed.models[0].reasoning?.controls).toEqual([{ kind: 'toggle' }])
  })

  // A knob whose whole vocabulary is unknown carries no usable choice, so the knob goes —
  // but the model stays listed and usable at its server-side default.
  it('drops a control whose entire vocabulary is unknown, not the model', () => {
    const parsed = ModelListSchema.parse({
      version: '1.0.0',
      models: [{ id: 'gpt-7', name: 'GPT-7', reasoning: { controls: [{ kind: 'effort', values: ['hyper'] }] } }]
    })

    expect(parsed.models[0].reasoning?.controls).toEqual([])
  })

  it('drops a provider whose endpoint the client cannot execute, keeping the others', () => {
    const parsed = ProviderListSchema.parse({
      version: '1.0.0',
      providers: [
        { id: 'future', name: 'Future', defaultChatEndpoint: 'quantum-messages', metadata: { website: {} } },
        { id: 'openai', name: 'OpenAI', defaultChatEndpoint: 'openai-responses', metadata: { website: {} } }
      ]
    })

    expect(parsed.providers.map((provider) => provider.id)).toEqual(['openai'])
  })

  it('drops an unknown server tool without dropping its provider', () => {
    const parsed = ProviderListSchema.parse({
      version: '1.0.0',
      providers: [
        {
          id: 'openai',
          name: 'OpenAI',
          defaultChatEndpoint: 'openai-responses',
          metadata: { website: {} },
          serverTools: [{ id: 'time-travel' }, { id: 'web-search' }]
        }
      ]
    })

    expect(parsed.providers[0].serverTools.map((tool) => tool.id)).toEqual(['web-search'])
  })

  it('drops an unknown capability from an override, keeping the override', () => {
    const parsed = ProviderModelListSchema.parse({
      version: '1.0.0',
      overrides: [
        {
          providerId: 'openai',
          modelId: 'gpt-7',
          capabilities: { add: ['function-call', 'telepathy'] },
          outputModalities: ['text', 'hologram']
        }
      ]
    })

    expect(parsed.overrides[0]).toMatchObject({
      capabilities: { add: ['function-call'] },
      outputModalities: ['text']
    })
  })
})
