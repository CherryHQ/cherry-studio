import * as fs from 'node:fs/promises'

import { describe, expect, it } from 'vitest'

import { CHERRY_RUNTIME_ONLY_BUILTIN_SKILLS, isSkillExternallyExportable } from '../skillExportPolicy'

describe('skill export policy', () => {
  it.each(CHERRY_RUNTIME_ONLY_BUILTIN_SKILLS)('withholds only the builtin %s, regardless of casing', (folderName) => {
    for (const name of [folderName, folderName.toUpperCase(), folderName.replace('cherry', 'Cherry')]) {
      expect(isSkillExternallyExportable({ source: 'builtin', folderName: name })).toBe(false)
      expect(isSkillExternallyExportable({ source: 'local', folderName: name })).toBe(true)
    }
  })

  it.each(['cherry-custom', 'find-skills', 'office-transform', 'skill-creator', 'cherry-browser-extra'])(
    'allows the builtin %s',
    (folderName) => {
      expect(isSkillExternallyExportable({ source: 'builtin', folderName })).toBe(true)
    }
  )

  it('explicitly classifies every bundled skill exactly once', async () => {
    const exportable = ['find-skills', 'office-transform', 'skill-creator']
    const resources = new URL('../../../../../resources/skills/', import.meta.url)
    const folders: string[] = []
    for (const entry of await fs.readdir(resources, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue
      await fs.readFile(new URL(`${entry.name}/SKILL.md`, resources), 'utf8')
      folders.push(entry.name)
    }
    expect(
      exportable.filter((name) => (CHERRY_RUNTIME_ONLY_BUILTIN_SKILLS as readonly string[]).includes(name))
    ).toEqual([])
    expect(folders.sort()).toEqual([...exportable, ...CHERRY_RUNTIME_ONLY_BUILTIN_SKILLS].sort())
  })
})
