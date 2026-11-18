import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { inferReasoningControls, inferReasoningMembership } from '../patterns/reasoning-heuristics'
import { RegistryLoader } from '../registry-loader'

const dataDir = join(fileURLToPath(import.meta.url), '..', '..', '..', 'data')
const loader = new RegistryLoader({
  models: join(dataDir, 'models.json'),
  providers: join(dataDir, 'providers.json'),
  providerModels: join(dataDir, 'provider-models.json')
})

describe('Mistral Large 4 provider boundaries', () => {
  it.each(['mistral-large-4', 'mistral-large-4-0', 'mistral-large-4-0-8', 'mistralai/mistral-large-4-0'])(
    'infers the documented native vocabulary without an off switch for %s',
    (id) => {
      expect(inferReasoningMembership(id)).toBe(true)
      expect(inferReasoningControls(id)).toEqual([{ kind: 'effort', values: ['low', 'medium', 'high'] }])
    }
  )

  it('keeps the older Mistral Small 4 vocabulary unchanged', () => {
    expect(inferReasoningControls('mistral-small-2603')).toEqual([{ kind: 'effort', values: ['none', 'high'] }])
  })

  it('stores native model controls separately from the OpenRouter endpoint descriptor', () => {
    expect(loader.findModel('mistral-large-4-0')?.reasoning?.controls).toEqual([
      { kind: 'effort', values: ['low', 'medium', 'high'] }
    ])
    const offer = loader.findOverride('openrouter', 'mistral-large-4-0')
    expect(offer?.apiModelId).toBe('mistralai/mistral-large-4-0')
    expect(offer?.reasoningContracts?.['openai-chat-completions']?.support).toEqual({
      controls: [
        { kind: 'effort', values: ['high', 'none'], default: 'high' },
        { kind: 'toggle', default: true }
      ],
      supportedEfforts: ['high', 'none'],
      defaultEffort: 'high'
    })
  })
})
