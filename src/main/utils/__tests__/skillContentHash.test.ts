import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { computeSkillContentHash } from '../skillContentHash'

// Independent unit test for the shared SKILL.md SHA-256 helper used by both
// SkillInstaller.computeContentHash and the backup SqliteFileStager. Covers the
// real findSkillMdPath + readFile + createHash path in isolation — the stager
// tests exercise it indirectly; this pins the contract at the helper boundary.
describe('computeSkillContentHash', () => {
  let root: string

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'skill-content-hash-'))
  })

  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  it('returns the SHA-256 of the SKILL.md content', async () => {
    const skillDir = join(root, 'my-skill')
    await mkdir(skillDir)
    const content = '# My Skill\n\nrules and instructions'
    await writeFile(join(skillDir, 'SKILL.md'), content, 'utf-8')

    const result = await computeSkillContentHash(skillDir)

    expect(result).toBe(createHash('sha256').update(content, 'utf-8').digest('hex'))
  })

  it('returns null when no SKILL.md descriptor exists', async () => {
    const skillDir = join(root, 'empty-skill')
    await mkdir(skillDir)

    const result = await computeSkillContentHash(skillDir)

    expect(result).toBeNull()
  })
})
