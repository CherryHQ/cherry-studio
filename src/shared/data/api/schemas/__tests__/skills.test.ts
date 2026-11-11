import { describe, expect, it } from 'vitest'

import { InstalledSkillSchema, ListSkillsQuerySchema, UpdateSkillSchema } from '../skills'

describe('Skill schemas', () => {
  it('validates and normalizes partial updates', () => {
    for (const [input, output] of [
      [{ isGlobalEnabled: false }, { isGlobalEnabled: false }],
      [{ note: '  A\nB  ' }, { note: 'A\nB' }],
      [{ note: null }, { note: null }],
      [{ note: '' }, { note: null }],
      [{ note: '  ' }, { note: null }],
      [
        { isGlobalEnabled: false, note: ' x ' },
        { isGlobalEnabled: false, note: 'x' }
      ]
    ])
      expect(UpdateSkillSchema.parse(input)).toEqual(output)
    for (const input of [
      {},
      { note: undefined, isGlobalEnabled: undefined },
      { isEnabled: true },
      { mirrorEnabled: true },
      { note: 1 },
      { note: {} },
      { note: [] },
      { isGlobalEnabled: null },
      { isGlobalEnabled: 'true' },
      null,
      []
    ]) {
      expect(UpdateSkillSchema.safeParse(input).success).toBe(false)
    }
  })
  it('keeps skill sourceTags but removes outer user tags and tag filters', () => {
    const skill = {
      id: 'skill-1',
      name: 'Skill',
      description: null,
      note: null,
      folderName: 'skill',
      source: 'builtin',
      sourceUrl: null,
      namespace: null,
      author: null,
      version: '1.2.3',
      sourceTags: ['metadata'],
      contentHash: 'hash',
      isEnabled: false,
      isGlobalEnabled: true,
      mirrorEnabled: true,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z'
    }

    const { note: _note, ...withoutNote } = skill
    expect(_note).toBeNull()
    expect(InstalledSkillSchema.safeParse(withoutNote).success).toBe(false)
    expect(InstalledSkillSchema.parse(skill)).toMatchObject({ sourceTags: ['metadata'], version: '1.2.3' })
    expect(InstalledSkillSchema.safeParse({ ...skill, tags: [] }).success).toBe(false)
    expect(ListSkillsQuerySchema.safeParse({ tagIds: ['11111111-1111-4111-8111-111111111111'] }).success).toBe(false)
  })
})
