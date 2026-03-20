import { describe, expect, it } from 'vitest'

import { PromptVersionSchema } from '../prompt'

describe('PromptVersionSchema', () => {
  const baseVersion = {
    id: 'da6dd7d6-8a80-429f-b3ef-e36f96246af8',
    promptId: '8d0be0c2-7a31-4d30-b2d4-fc4c0df3dd61',
    version: 4,
    content: 'Prompt content',
    createdAt: new Date(1700000000000).toISOString()
  }

  it('accepts normal edit versions', () => {
    expect(PromptVersionSchema.parse({ ...baseVersion, rollbackFrom: null })).toEqual({
      ...baseVersion,
      rollbackFrom: null
    })
  })

  it('accepts rollback metadata', () => {
    expect(PromptVersionSchema.parse({ ...baseVersion, rollbackFrom: 1 })).toEqual({
      ...baseVersion,
      rollbackFrom: 1
    })
  })
})
