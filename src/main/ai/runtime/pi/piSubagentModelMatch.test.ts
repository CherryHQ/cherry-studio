import { describe, expect, it } from 'vitest'

import { matchPiSubagentModel, type PiSubagentModelNames } from './piSubagentModelMatch'

const names: PiSubagentModelNames = {
  key: 'openrouter/openrouter:anthropic/claude-sonnet-4.5',
  id: 'openrouter::anthropic/claude-sonnet-4.5',
  rawId: 'anthropic/claude-sonnet-4.5',
  modelName: 'Claude Sonnet 4.5',
  providerName: 'OpenRouter'
}

describe('matchPiSubagentModel', () => {
  it.each([
    'OpenRouter Claude Sonnet 4.5',
    '  oPeNrOuTeR cLaUdE sOnNeT 4.5  ',
    names.key,
    names.id,
    names.rawId,
    names.modelName
  ])('matches an exact catalog name: %s', (query) => {
    expect(matchPiSubagentModel(query, names)).toEqual({ exact: true })
  })

  it('offers substring matches as similar candidates only', () => {
    expect(matchPiSubagentModel('OpenRouter Claude Sonnet', names)).toEqual({ exact: false })
  })

  it.each(['Unknown Claude Sonnet 4.5', 'OpenRouter/Claude Sonnet 4.5'])('rejects unknown forms: %s', (query) => {
    expect(matchPiSubagentModel(query, names)).toBeUndefined()
  })

  it.each(['', '   '])('enumerates an empty query without an exact match: %j', (query) => {
    expect(matchPiSubagentModel(query, names)).toEqual({ exact: false })
  })

  it('does not make a different model exact just because its provider matches', () => {
    expect(matchPiSubagentModel('OpenRouter', names)).toEqual({ exact: false })
    expect(matchPiSubagentModel('OpenRouter Claude Haiku 4.5', names)).toBeUndefined()
  })
})
