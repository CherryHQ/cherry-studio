import { describe, expect, it } from 'vitest'

import { parseCompositeModelId } from '../config'

describe('knowledge config utils', () => {
  it('parses a strict providerId::modelId composite id', () => {
    expect(parseCompositeModelId('openai::text-embedding-3-small')).toEqual({
      providerId: 'openai',
      modelId: 'text-embedding-3-small'
    })
  })

  it.each(['', 'openai', 'openai:', 'openai::', '::model', ' openai::model', 'openai::model ', 'openai:::model'])(
    'throws on invalid composite id: %s',
    (value) => {
      expect(() => parseCompositeModelId(value)).toThrow('Expected format: "providerId::modelId"')
    }
  )
})
