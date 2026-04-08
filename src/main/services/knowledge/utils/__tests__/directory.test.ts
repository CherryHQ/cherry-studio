import type * as NodeFs from 'node:fs'
import type * as NodeOs from 'node:os'
import path from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

const { expandDirectoryToCreateItems } = await import('../directory')
const realFs = await vi.importActual<typeof NodeFs>('node:fs')
const realOs = await vi.importActual<typeof NodeOs>('node:os')

function createTempRoot() {
  return realFs.mkdtempSync(path.join(realOs.tmpdir(), 'knowledge-directory-expand-'))
}

describe('expandDirectoryToCreateItems', () => {
  let tempRoot: string | undefined

  afterEach(() => {
    if (tempRoot) {
      realFs.rmSync(tempRoot, { recursive: true, force: true })
      tempRoot = undefined
    }
  })

  it('expands nested directories into createMany dto items with preserved hierarchy', async () => {
    tempRoot = createTempRoot()
    const rootDir = path.join(tempRoot, 'anna')
    const nestedDir = path.join(rootDir, 'agents', 'skills')
    realFs.mkdirSync(nestedDir, { recursive: true })
    realFs.writeFileSync(path.join(rootDir, '.dockerignore'), 'node_modules')
    realFs.writeFileSync(path.join(nestedDir, 'skill.md'), '# skill')

    const items = await expandDirectoryToCreateItems(rootDir)

    expect(items[0]).toMatchObject({
      ref: 'root',
      type: 'directory',
      data: {
        name: 'anna',
        path: rootDir
      }
    })

    const agentsDir = items.find((item) => item.type === 'directory' && item.data.path === path.join(rootDir, 'agents'))
    const skillsDir = items.find(
      (item) => item.type === 'directory' && item.data.path === path.join(rootDir, 'agents', 'skills')
    )
    const rootFile = items.find(
      (item) => item.type === 'file' && item.data.file.path === path.join(rootDir, '.dockerignore')
    )
    const nestedFile = items.find(
      (item) => item.type === 'file' && item.data.file.path === path.join(nestedDir, 'skill.md')
    )

    expect(agentsDir).toMatchObject({
      ref: 'dir:/agents',
      groupRef: 'root'
    })
    expect(skillsDir).toMatchObject({
      ref: 'dir:/agents/skills',
      groupRef: 'dir:/agents'
    })
    expect(rootFile).toBeUndefined()
    expect(nestedFile).toMatchObject({
      groupRef: 'dir:/agents/skills',
      type: 'file'
    })
    expect(nestedFile && nestedFile.type === 'file' ? nestedFile.data.file : undefined).toMatchObject({
      name: 'skill.md',
      origin_name: 'skill.md',
      path: path.join(nestedDir, 'skill.md'),
      ext: '.md',
      count: 1
    })
  })
})
