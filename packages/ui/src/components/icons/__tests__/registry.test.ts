import { describe, expect, it } from 'vitest'

import { resolveModelToProviderIcon, resolveProviderIcon } from '../registry'

describe('resolveProviderIcon', () => {
  const testCases = [
    { providerId: 'github-copilot-openai-compatible', expectedToExist: true },
    { providerId: 'copilot', expectedToExist: true },
    { providerId: 'yi', expectedToExist: true },
    { providerId: 'zai', expectedToExist: true },
    { providerId: 'tencent-cloud-ti', expectedToExist: true },
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
