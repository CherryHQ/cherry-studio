import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context'
import { createModels, fauxProvider } from '@earendil-works/pi-ai'
import { Harness, MemoryStorage, createRegistry } from '@earendil-works/pi-durable'
import { MockMainPreferenceServiceUtils } from '@test-mocks/main/PreferenceService'
import { describe, expect, it } from 'vitest'

import { resolveDurableCompaction } from './durableCompaction'

describe('ordinary Durable Agent native compaction policy', () => {
  it.each([20, 60, 90])('passes %s percent to the actual native conversation policy', async (percent) => {
    MockMainPreferenceServiceUtils.setPreferenceValue('chat.context_settings.enabled', true)
    MockMainPreferenceServiceUtils.setPreferenceValue('chat.context_settings.compress.enabled', true)
    MockMainPreferenceServiceUtils.setPreferenceValue('chat.context_settings.compress.threshold_percent', percent)
    const models = createModels()
    models.setProvider(fauxProvider({ models: [{ id: 'faux-1', contextWindow: 1048576 }] }).provider)
    const native = await Harness.open(new MemoryStorage(), { models, registry: createRegistry() }, BACKGROUND_CONTEXT)
    try {
      const root = await native.createConversation(
        {
          ownership: { kind: 'ownerless' },
          agent: {
            model: { provider: 'faux', modelId: 'faux-1' },
            compaction: resolveDurableCompaction(1048576)
          }
        },
        BACKGROUND_CONTEXT
      )
      expect((await root.contextUsage(BACKGROUND_CONTEXT))?.compactionThreshold).toBe(
        Math.floor((1048576 * percent) / 100)
      )
    } finally {
      await native.close(BACKGROUND_CONTEXT)
    }
  })

  it('sizes independent root and child model policies without leaking root reserves', () => {
    MockMainPreferenceServiceUtils.setPreferenceValue('chat.context_settings.enabled', true)
    MockMainPreferenceServiceUtils.setPreferenceValue('chat.context_settings.compress.enabled', true)
    MockMainPreferenceServiceUtils.setPreferenceValue('chat.context_settings.compress.threshold_percent', 60)
    expect(resolveDurableCompaction(1_000_000).reserveTokens).toBe(400_000)
    expect(resolveDurableCompaction(undefined).reserveTokens).toBe(102_400)
    expect(resolveDurableCompaction(20_000)).toMatchObject({
      reserveTokens: 8_000,
      keepRecentTokens: 4_500,
      backgroundTokens: 0
    })
  })

  it.each(['chat.context_settings.enabled', 'chat.context_settings.compress.enabled'] as const)(
    'honors disabled %s',
    (key) => {
      MockMainPreferenceServiceUtils.setPreferenceValue('chat.context_settings.enabled', true)
      MockMainPreferenceServiceUtils.setPreferenceValue('chat.context_settings.compress.enabled', true)
      MockMainPreferenceServiceUtils.setPreferenceValue(key, false)
      expect(resolveDurableCompaction(1048576)).toEqual({ enabled: false })
    }
  )
})
