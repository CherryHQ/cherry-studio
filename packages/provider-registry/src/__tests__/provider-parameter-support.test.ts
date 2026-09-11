import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { splitOverrideWireId } from '../../scripts/canonicalize'
import { PROVIDERS } from '../providers'

// Generated artifact = runtime source of truth; covers rows that only exist after
// generation (openrouter's dynamic models.dev listing), which the TS sources never spell.
const dataDir = join(fileURLToPath(import.meta.url), '..', '..', '..', 'data')
const generatedOverrides = JSON.parse(readFileSync(join(dataDir, 'provider-models.json'), 'utf8')).overrides as Array<{
  providerId: string
  modelId: string
  parameterSupport?: { temperature?: { supported?: boolean }; topP?: { supported?: boolean } }
}>

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

const generatedRowOf = (providerId: string, modelId: string) =>
  generatedOverrides.find((row) => row.providerId === providerId && row.modelId === modelId)

describe('moonshot parameter support', () => {
  it.each([
    'kimi-k2-5',
    'kimi-k2-6',
    'kimi-k2-7-code',
    'kimi-k2-7-code-highspeed',
    'kimi-k3',
    'kimi-k3-fast',
    'kimi-latest'
  ])('omits the fixed temperature and top_p parameters for %s', (modelId) => {
    const { parameterSupport } = overrideOf('moonshot', modelId)
    expect(parameterSupport?.temperature).toEqual({ supported: false })
    expect(parameterSupport?.topP).toEqual({ supported: false })
  })
})

// DashScope (Bailian) and OpenRouter forward requests to Moonshot's backend,
// so the same fixed sampling lock applies there (issue #19601).
describe('moonshot-passthrough parameter support', () => {
  it('omits the fixed temperature and top_p parameters for dashscope kimi-k3', () => {
    const { parameterSupport } = overrideOf('dashscope', 'kimi-k3')
    expect(parameterSupport?.temperature).toEqual({ supported: false })
    expect(parameterSupport?.topP).toEqual({ supported: false })
  })

  it.each(['kimi-k2-5', 'kimi-k2-6', 'kimi-k2-7-code', 'kimi-k3', 'kimi-latest'])(
    'omits the fixed temperature and top_p parameters for openrouter %s',
    (modelId) => {
      const { parameterSupport } = overrideOf('openrouter', modelId)
      expect(parameterSupport?.temperature).toEqual({ supported: false })
      expect(parameterSupport?.topP).toEqual({ supported: false })
    }
  )

  it('leaves the legacy unlocked K2 SKUs untouched', () => {
    expect(generatedRowOf('openrouter', 'kimi-k2')?.parameterSupport).toBeUndefined()
    expect(generatedRowOf('dashscope', 'kimi-k2')?.parameterSupport).toBeUndefined()
  })
})
