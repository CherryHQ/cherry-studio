import { describe, expect, expectTypeOf, it } from 'vitest'

import providerModels from '../../../../../packages/provider-registry/data/provider-models.json'
import { makeModel } from '../../__tests__/fixtures/model'
import { makeProvider } from '../../__tests__/fixtures/provider'
import {
  bindNativeImageTarget,
  type BoundNativeImageTarget,
  type NativeImageTarget
} from '../custom/imageTransportRegistry'
import { resolveImageExecutionTarget } from '../imageExecutionTarget'
import { registryImageSupport } from './imageCatalogFixtures'

describe('image execution target', () => {
  it.each(['ppio', 'dashscope', 'tokenhub'] as const)(
    'requires a native binding on a preset-derived %s connection',
    (presetProviderId) => {
      const provider = makeProvider({ id: 'connection-uuid', presetProviderId })
      const model = makeModel({
        id: 'connection-uuid::unknown-image',
        providerId: provider.id,
        apiModelId: 'wire-image'
      })
      expect(resolveImageExecutionTarget(provider, model, 'generate', undefined)).toMatchObject({
        kind: 'unavailable',
        providerInstanceId: 'connection-uuid',
        modelId: 'wire-image'
      })
    }
  )

  it('carries the producer API id and exact operation binding, not the canonical or provider instance id', () => {
    const row = providerModels.overrides.find(
      (entry) => entry.providerId === 'dashscope' && entry.modelId === 'wanx2-1-t2i-turbo'
    )
    if (!row?.apiModelId) throw new Error('Missing distinct canonical/API id fixture')
    const support = registryImageSupport(row.providerId, row.apiModelId)
    if (support?.protocol?.kind !== 'custom') throw new Error('Missing custom protocol fixture')
    const provider = makeProvider({ id: 'private-dashscope', presetProviderId: 'dashscope' })
    const model = makeModel({
      id: 'private-dashscope::wanx2-1-t2i-turbo',
      providerId: provider.id,
      apiModelId: row.apiModelId
    })
    const result = resolveImageExecutionTarget(provider, model, 'generate', support)
    expect(result).toMatchObject({
      kind: 'custom',
      providerInstanceId: provider.id,
      modelId: row.apiModelId,
      protocol: {
        providerId: 'dashscope',
        modelDescriptor: { id: row.apiModelId, endpoint: support.protocol.endpoint, isSync: support.protocol.isSync }
      }
    })
    expect(resolveImageExecutionTarget(provider, model, 'upscale', support).kind).toBe('unavailable')
  })

  it('does not bind a prepared protocol to settings from another executor', () => {
    const target: NativeImageTarget = {
      providerId: 'ppio',
      modelDescriptor: { id: 'image', endpoint: '/declared/image' }
    }
    expect(() => bindNativeImageTarget(target, { providerId: 'tokenhub', providerSettings: {} })).toThrow(
      "cannot use 'tokenhub' settings"
    )
    expectTypeOf<{ providerId: 'ppio' }>().not.toMatchTypeOf<NativeImageTarget>()
    expectTypeOf<{
      providerId: 'ppio'
      settings: {}
      modelDescriptor: undefined
    }>().not.toMatchTypeOf<BoundNativeImageTarget>()
  })
})
