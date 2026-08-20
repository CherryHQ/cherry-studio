import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { findAllSkillDirectories } from '../markdownParser'

/** Normalize path separators to forward slash for cross-platform assertions. */
const fwd = (p: string): string => p.replaceAll('\\', '/')

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

    expect(result.map((candidate) => fwd(candidate.sourcePath)).sort()).toEqual([
      'first/shared-name',
      'second/shared-name'
    ])
  })

  it('skips hidden directories and node_modules', async () => {
    const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'skill-directories-'))
    tempDirs.push(root)
    const visible = path.join(root, 'skills', 'my-skill')
    const hidden = path.join(root, '.openclaw', 'skills', 'my-skill')
    const nodeModules = path.join(root, 'node_modules', 'my-skill')
    await Promise.all([
      fs.promises.mkdir(visible, { recursive: true }),
      fs.promises.mkdir(hidden, { recursive: true }),
      fs.promises.mkdir(nodeModules, { recursive: true })
    ])
    await Promise.all([
      fs.promises.writeFile(path.join(visible, 'SKILL.md'), '# visible'),
      fs.promises.writeFile(path.join(hidden, 'SKILL.md'), '# hidden'),
      fs.promises.writeFile(path.join(nodeModules, 'SKILL.md'), '# node_modules')
    ])

    const result = await findAllSkillDirectories(root, root)

    expect(result.map((candidate) => fwd(candidate.sourcePath))).toEqual(['skills/my-skill'])
  })
})
