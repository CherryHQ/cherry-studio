import { describe, expect, it } from 'vitest'

import { skillRequestSchemas } from '../skill'

describe('skill.folder.resolve IPC schema', () => {
  const input = skillRequestSchemas['skill.folder.resolve'].input
  const output = skillRequestSchemas['skill.folder.resolve'].output

  it('accepts only a non-empty Skill id', () => {
    expect(input.parse({ skillId: 'skill-1' })).toEqual({ skillId: 'skill-1' })
    expect(input.safeParse({ skillId: '' }).success).toBe(false)
    expect(input.safeParse({ skillId: 'skill-1', path: '/tmp' }).success).toBe(false)
  })

  it('keeps writable and builtin read-only capabilities distinct', () => {
    expect(output.parse({ rootPath: '/managed/skill', access: 'read_write' })).toEqual({
      rootPath: '/managed/skill',
      access: 'read_write'
    })
    expect(output.parse({ rootPath: '/managed/builtin', access: 'read_only', readOnlyReason: 'builtin' })).toEqual({
      rootPath: '/managed/builtin',
      access: 'read_only',
      readOnlyReason: 'builtin'
    })
    expect(output.safeParse({ rootPath: '/managed/skill', access: 'read_only' }).success).toBe(false)
  })
})
