import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { findAllSkillDirectories } from '../markdownParser'

describe('findAllSkillDirectories', () => {
  const tempDirs: string[] = []

  afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map((dir) => fs.promises.rm(dir, { recursive: true, force: true })))
  })

  it('preserves candidates with duplicate basenames so callers can resolve them by metadata', async () => {
    const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'skill-directories-'))
    tempDirs.push(root)
    const first = path.join(root, 'first', 'shared-name')
    const second = path.join(root, 'second', 'shared-name')
    await Promise.all([fs.promises.mkdir(first, { recursive: true }), fs.promises.mkdir(second, { recursive: true })])
    await Promise.all([
      fs.promises.writeFile(path.join(first, 'SKILL.md'), '# first'),
      fs.promises.writeFile(path.join(second, 'SKILL.md'), '# second')
    ])

    const result = await findAllSkillDirectories(root, root)

    expect(result.map((candidate) => candidate.sourcePath).sort()).toEqual(['first/shared-name', 'second/shared-name'])
  })
})
