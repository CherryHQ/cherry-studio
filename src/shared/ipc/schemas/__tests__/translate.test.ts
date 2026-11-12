import { describe, expect, it } from 'vitest'

import { translateRequestSchemas } from '../translate'

describe('translate.open model override', () => {
  const schema = translateRequestSchemas['translate.open'].input
  const input = { streamId: 'translate:1', text: 'hello', targetLangCode: 'en-us' }
  it('accepts omitted and valid model identities', () => {
    expect(schema.parse(input)).toEqual(input)
    expect(schema.parse({ ...input, modelId: 'openai::gpt-4o' }).modelId).toBe('openai::gpt-4o')
  })
  it('rejects malformed identities', () => {
    for (const modelId of [
      null,
      'no-separator',
      '::gpt-4o',
      'openai::',
      42,
      'openai::bad?query',
      'openai::bad#fragment'
    ]) {
      expect(schema.safeParse({ ...input, modelId }).success).toBe(false)
    }
  })
})
