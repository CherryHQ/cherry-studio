import { describe, expect, it } from 'vitest'

import { InstalledSkillSchema, ListSkillsQuerySchema } from '../skills'

describe('Skill schemas', () => {
  it('keeps skill sourceTags but removes outer user tags and tag filters', () => {
    const skill = {
      id: 'skill-1',
      name: 'Skill',
      description: null,
      folderName: 'skill',
      source: 'builtin',
      sourceUrl: null,
      namespace: null,
      author: null,
      sourceTags: ['metadata'],
      contentHash: 'hash',
      isEnabled: false,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z'
    }

    expect(InstalledSkillSchema.parse(skill).sourceTags).toEqual(['metadata'])
    expect(InstalledSkillSchema.safeParse({ ...skill, tags: [] }).success).toBe(false)
    expect(ListSkillsQuerySchema.safeParse({ tagIds: ['11111111-1111-4111-8111-111111111111'] }).success).toBe(false)
  })
})
