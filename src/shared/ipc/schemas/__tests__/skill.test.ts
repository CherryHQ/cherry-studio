import { describe, expect, it } from 'vitest'

import { skillRequestSchemas } from '../skill'

describe('skillRequestSchemas', () => {
  it('declares exactly the migrated skill routes', () => {
    expect(Object.keys(skillRequestSchemas).sort()).toEqual(
      [
        'skill.install',
        'skill.install_from_directory',
        'skill.install_from_zip',
        'skill.list',
        'skill.list_files',
        'skill.list_local',
        'skill.read_file',
        'skill.toggle',
        'skill.uninstall'
      ].sort()
    )
  })

  it('list accepts omitted input or an optional agentId', () => {
    const schema = skillRequestSchemas['skill.list'].input
    expect(schema.safeParse(undefined).success).toBe(true)
    expect(schema.safeParse({ agentId: 'agent-1' }).success).toBe(true)
    expect(schema.safeParse({ agentId: 7 }).success).toBe(false)
  })

  it('validates install route inputs', () => {
    expect(
      skillRequestSchemas['skill.install'].input.safeParse({ installSource: 'skills.sh:owner/repo' }).success
    ).toBe(true)
    expect(
      skillRequestSchemas['skill.install_from_zip'].input.safeParse({ zipFilePath: '/tmp/skill.zip' }).success
    ).toBe(true)
    expect(
      skillRequestSchemas['skill.install_from_directory'].input.safeParse({ directoryPath: '/tmp/skill' }).success
    ).toBe(true)
    expect(skillRequestSchemas['skill.install'].input.safeParse({ installSource: '' }).success).toBe(false)
  })

  it('validates mutation and file route inputs', () => {
    expect(
      skillRequestSchemas['skill.toggle'].input.safeParse({
        agentId: 'agent-1',
        skillId: 'skill-1',
        isEnabled: true
      }).success
    ).toBe(true)
    expect(skillRequestSchemas['skill.uninstall'].input.safeParse({ skillId: 'skill-1' }).success).toBe(true)
    expect(
      skillRequestSchemas['skill.read_file'].input.safeParse({ skillId: 'skill-1', filename: 'SKILL.md' }).success
    ).toBe(true)
    expect(skillRequestSchemas['skill.list_files'].input.safeParse({ skillId: 'skill-1' }).success).toBe(true)
    expect(skillRequestSchemas['skill.list_local'].input.safeParse({ workdir: '/tmp/workspace' }).success).toBe(true)
  })

  it('validates skill result envelopes', () => {
    const schema = skillRequestSchemas['skill.list_files'].output
    expect(
      schema.safeParse({
        success: true,
        data: [{ name: 'SKILL.md', path: 'SKILL.md', type: 'file' }]
      }).success
    ).toBe(true)
    expect(schema.safeParse({ success: false, error: 'failed' }).success).toBe(true)
    expect(schema.safeParse({ success: false, error: new Error('failed') }).success).toBe(false)
    expect(schema.safeParse({ success: true }).success).toBe(false)
  })
})
