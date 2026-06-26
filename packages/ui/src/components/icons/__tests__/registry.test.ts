import { describe, expect, it } from 'vitest'

import { MODEL_ICON_CATALOG } from '../models/catalog'
import { resolveModelIcon, resolveModelToProviderIcon, resolveProviderIcon } from '../registry'

describe('resolveProviderIcon', () => {
  const testCases = [
    { providerId: 'github-copilot-openai-compatible', expectedToExist: true },
    { providerId: 'copilot', expectedToExist: true },
    { providerId: 'yi', expectedToExist: true },
    { providerId: 'zai', expectedToExist: true },
    { providerId: 'tencent-cloud-ti', expectedToExist: true },
    { providerId: 'tokenhub', expectedToExist: true },
    { providerId: 'baidu-cloud', expectedToExist: true },
    { providerId: 'aws-bedrock', expectedToExist: true },
    { providerId: 'aionly', expectedToExist: true },
    { providerId: 'gitee-ai', expectedToExist: true }
  ]

  for (const { providerId, expectedToExist } of testCases) {
    it(`should resolve icon for providerId: "${providerId}"`, () => {
      const icon = resolveProviderIcon(providerId)
      if (expectedToExist) {
        expect(icon).toBeDefined()
        expect(icon).not.toBeNull()
      } else {
        expect(icon).toBeUndefined()
      }
    })
  }
})

describe('resolveModelToProviderIcon', () => {
  const testCases = [
    { modelId: 'yi-34b', expectedToExist: true },
    { modelId: 'arcee-virtuoso', expectedToExist: true },
    { modelId: 'dolphin-mixtral', expectedToExist: true },
    { modelId: 'bce-embedding', expectedToExist: true },
    { modelId: 'runway-gen3', expectedToExist: true }
  ]

  for (const { modelId, expectedToExist } of testCases) {
    it(`should resolve provider icon for modelId: "${modelId}"`, () => {
      const icon = resolveModelToProviderIcon(modelId)
      if (expectedToExist) {
        expect(icon).toBeDefined()
        expect(icon).not.toBeNull()
      } else {
        expect(icon).toBeUndefined()
      }
    })
  }
})

describe('resolveModelIcon — pattern boundaries (#10, #11, #12)', () => {
  it('sensenova is not preempted by the broader nova pattern (#10)', () => {
    expect(resolveModelIcon('sensenova-v6')).toBe(MODEL_ICON_CATALOG.sensenova)
    expect(resolveModelIcon('nova-pro')).toBe(MODEL_ICON_CATALOG.nova)
  })

  it('ling/ring only match as delimited tokens (#11)', () => {
    expect(resolveModelIcon('ling-1t')).toBe(MODEL_ICON_CATALOG.ling)
    expect(resolveModelIcon('spring-1t')).not.toBe(MODEL_ICON_CATALOG.ling)
    expect(resolveModelIcon('ringo-v1')).not.toBe(MODEL_ICON_CATALOG.ling)
    expect(resolveModelIcon('bge-multilingual-embedding')).not.toBe(MODEL_ICON_CATALOG.ling)
  })

  it('wan is delimiter-bounded; bare/dashed sora resolves (#12)', () => {
    expect(resolveModelIcon('wan-2-1')).toBe(MODEL_ICON_CATALOG.qwen)
    expect(resolveModelIcon('taiwan-llm')).not.toBe(MODEL_ICON_CATALOG.qwen)
    expect(resolveModelIcon('sora')).toBe(MODEL_ICON_CATALOG.sora)
    expect(resolveModelIcon('sora-2')).toBe(MODEL_ICON_CATALOG.sora)
  })
})
