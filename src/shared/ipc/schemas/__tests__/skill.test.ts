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

describe('Skill authoring and update IPC schemas', () => {
  it('keeps full and scoped reconcile on one strict route', () => {
    const input = skillRequestSchemas['skill.reconcile'].input

    expect(input.parse({})).toEqual({})
    expect(input.parse({ skillId: 'skill-1' })).toEqual({ skillId: 'skill-1' })
    expect(input.safeParse({ skillId: '' }).success).toBe(false)
    expect(input.safeParse({ skillId: 'skill-1', path: '/tmp' }).success).toBe(false)
  })

  it('requires an explicit overwrite decision when applying a checked revision', () => {
    const input = skillRequestSchemas['skill.remote.apply'].input

    expect(input.parse({ skillId: 'skill-1', revision: 'revision-1', overwriteLocalChanges: false })).toEqual({
      skillId: 'skill-1',
      revision: 'revision-1',
      overwriteLocalChanges: false
    })
    expect(input.safeParse({ skillId: 'skill-1', revision: 'revision-1' }).success).toBe(false)
  })

  it('validates each remote-check result by its state', () => {
    const output = skillRequestSchemas['skill.remote.check'].output

    expect(output.parse({ state: 'unsupported', reason: 'missing_provenance' })).toEqual({
      state: 'unsupported',
      reason: 'missing_provenance'
    })
    expect(
      output.parse({ state: 'available', localChanges: true, remoteVersion: null, revision: 'revision-1' })
    ).toEqual({ state: 'available', localChanges: true, remoteVersion: null, revision: 'revision-1' })
    expect(output.safeParse({ state: 'available', localChanges: true, remoteVersion: null }).success).toBe(false)
  })
})
