import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { durabilizeRestoreStaging, restoreStagingDurability } from '../stagingDurability'

describe('durabilizeRestoreStaging', () => {
  let work = ''

  afterEach(() => {
    vi.restoreAllMocks()
    if (work) rmSync(work, { recursive: true, force: true })
  })

  it('flushes every file, then directories bottom-up, then the root parent', () => {
    work = mkdtempSync(join(tmpdir(), 'restore-durable-'))
    const root = join(work, 'restore-staging', 'restore-id')
    mkdirSync(join(root, 'resources', 'Data'), { recursive: true })
    writeFileSync(join(root, 'backup.sqlite'), 'db')
    writeFileSync(join(root, 'resources', 'Data', 'a.txt'), 'a')

    const calls: string[] = []
    vi.spyOn(restoreStagingDurability, 'syncFile').mockImplementation((target) => calls.push(`file:${target}`))
    vi.spyOn(restoreStagingDurability, 'syncDirectory').mockImplementation((target) => calls.push(`dir:${target}`))

    durabilizeRestoreStaging(root)

    expect(calls.filter((call) => call.startsWith('file:')).sort()).toEqual(
      [`file:${join(root, 'backup.sqlite')}`, `file:${join(root, 'resources', 'Data', 'a.txt')}`].sort()
    )
    expect(calls.indexOf(`dir:${join(root, 'resources', 'Data')}`)).toBeLessThan(
      calls.indexOf(`dir:${join(root, 'resources')}`)
    )
    expect(calls.at(-2)).toBe(`dir:${root}`)
    expect(calls.at(-1)).toBe(`dir:${join(work, 'restore-staging')}`)
  })
})
