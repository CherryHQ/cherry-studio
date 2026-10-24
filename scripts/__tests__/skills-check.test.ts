import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'

import { afterEach, describe, expect, it } from 'vitest'

import { checkSkillFile } from '../skills-check'

const tempDirs: string[] = []

/** Writes a skill directory holding `skillMd` as its SKILL.md — or holding nothing at all, when it is null. */
const makeSkill = (skillName: string, skillMd: string | null): string => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'skills-check-'))
  tempDirs.push(root)
  const skillDir = path.join(root, skillName)
  fs.mkdirSync(skillDir, { recursive: true })
  if (skillMd !== null) fs.writeFileSync(path.join(skillDir, 'SKILL.md'), skillMd)
  return skillDir
}

afterEach(() => {
  while (tempDirs.length > 0) fs.rmSync(tempDirs.pop()!, { recursive: true, force: true })
})

/** A SKILL.md whose frontmatter carries `fields` followed by `body`. */
const skillMdWith = (fields: Record<string, string>, body = '# A skill\n\nDo the thing.\n'): string =>
  ['---', ...Object.entries(fields).map(([key, value]) => `${key}: ${value}`), '---', '', body].join('\n')

const WELL_FORMED = { name: 'a-skill', description: 'Do a thing. Use when the user asks for the thing.' }

describe('checkSkillFile', () => {
  it('accepts a SKILL.md with a name, a description and a body', () => {
    expect(checkSkillFile(makeSkill('a-skill', skillMdWith(WELL_FORMED)), 'a-skill')).toEqual([])
  })

  it('accepts a SKILL.md written with CRLF line endings', () => {
    const skillMd = skillMdWith(WELL_FORMED).replace(/\n/g, '\r\n')
    expect(checkSkillFile(makeSkill('a-skill', skillMd), 'a-skill')).toEqual([])
  })

  it('rejects a skill directory with no SKILL.md', () => {
    const failures = checkSkillFile(makeSkill('a-skill', null), 'a-skill')
    expect(failures).toEqual([expect.stringContaining('SKILL.md is missing')])
  })

  it('rejects a SKILL.md with no frontmatter block', () => {
    const failures = checkSkillFile(makeSkill('a-skill', '# A skill\n\nDo the thing.\n'), 'a-skill')
    expect(failures).toEqual([expect.stringContaining('is missing its YAML frontmatter block')])
  })

  it('rejects a SKILL.md whose frontmatter has no name', () => {
    const failures = checkSkillFile(makeSkill('a-skill', skillMdWith({ description: 'Do a thing.' })), 'a-skill')
    expect(failures).toEqual([expect.stringContaining('is missing the frontmatter `name` field')])
  })

  it('rejects a SKILL.md whose frontmatter has no description', () => {
    const failures = checkSkillFile(makeSkill('a-skill', skillMdWith({ name: 'a-skill' })), 'a-skill')
    expect(failures).toEqual([expect.stringContaining('is missing the frontmatter `description` field')])
  })

  it('rejects a frontmatter name that breaks the naming rules', () => {
    const failures = checkSkillFile(makeSkill('a-skill', skillMdWith({ ...WELL_FORMED, name: 'A_Skill' })), 'a-skill')
    expect(failures).toEqual([expect.stringContaining("'A_Skill' breaks the naming rules")])
  })

  it('rejects a SKILL.md whose body is empty', () => {
    const failures = checkSkillFile(makeSkill('a-skill', skillMdWith(WELL_FORMED, '')), 'a-skill')
    expect(failures).toEqual([expect.stringContaining('has no body')])
  })
})
