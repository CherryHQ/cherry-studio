import { describe, expect, it } from 'vitest'

import { splitOverrideWireId } from '../../scripts/canonicalize'
import { PROVIDERS } from '../providers'

const provider = (providerId: string) => {
  const result = PROVIDERS.find(({ id }) => id === providerId)
  if (!result) throw new Error(`Missing provider: ${providerId}`)
  return result
}

const overrideOf = (providerId: string, modelId: string) => {
  const override = provider(providerId)
    .overrides?.map((entry) => splitOverrideWireId(entry))
    .find((entry) => entry.modelId === modelId)
  if (!override) throw new Error(`Missing override: ${providerId}/${modelId}`)
  return override
}

describe('moonshot parameter support', () => {
  it.each(['kimi-k2-5', 'kimi-k3'])('omits the fixed top_p parameter for %s', (modelId) => {
    expect(overrideOf('moonshot', modelId).parameterSupport?.topP).toEqual({ supported: false })
  })
})
