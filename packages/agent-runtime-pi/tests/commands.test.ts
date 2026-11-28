import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'

import { expect, it } from 'vitest'

import { piCommandCatalog } from '../src/commands'
import { tempDir } from './sessionSupport'

it('lists Skills only from the sources the host selected', async () => {
  const cwd = tempDir('command-cwd')
  const agentDir = tempDir('command-agent-dir')
  const enabled = path.join(cwd, 'review')
  const ambient = path.join(agentDir, 'skills', 'ambient')
  await Promise.all([mkdir(enabled, { recursive: true }), mkdir(ambient, { recursive: true })])
  const filePath = path.join(enabled, 'SKILL.md')
  await Promise.all([
    writeFile(filePath, '---\nname: review\ndescription: Review changes.\n---\nRead the diff.'),
    writeFile(path.join(ambient, 'SKILL.md'), '---\nname: ambient\ndescription: Ambient Skill.\n---\nRead the diff.')
  ])

  await expect(piCommandCatalog.listOffline({ cwd, agentDir, skillPaths: [enabled] })).resolves.toEqual([
    { name: 'skill:review', description: 'Review changes.', argumentHint: '', builtin: false, skillPath: filePath }
  ])
})
