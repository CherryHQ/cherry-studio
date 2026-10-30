import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { createTask, restoreTask, saveTask } from '../release/build-cache'

const roots: string[] = []
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'release-cache-'))
  roots.push(root)
  mkdirSync(join(root, 'src'))
  writeFileSync(join(root, 'src/input.txt'), 'first')
  return root
}
function task(root: string, identity = { arch: 'arm64', edition: 'global' }) {
  return createTask({ root, name: 'fixture', inputs: ['src'], outputs: ['out'], identity })
}
function build(root: string) {
  mkdirSync(join(root, 'out'), { recursive: true })
  writeFileSync(join(root, 'out/result.txt'), readFileSync(join(root, 'src/input.txt')))
}
afterEach(() => roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true })))

describe('release task cache', () => {
  it('restores the produced bytes into a clean output directory', () => {
    const root = fixture()
    const entry = task(root)
    build(root)
    saveTask(entry)
    writeFileSync(join(root, 'out/stale.txt'), 'must disappear')
    writeFileSync(join(root, 'out/result.txt'), 'wrong')
    expect(restoreTask(entry)).toBe(true)
    expect(readFileSync(join(root, 'out/result.txt'), 'utf8')).toBe('first')
    expect(() => readFileSync(join(root, 'out/stale.txt'))).toThrow()
  })

  it.each(['change', 'delete', 'add', 'rename'])('invalidates on input %s', (operation) => {
    const root = fixture()
    build(root)
    const before = task(root)
    saveTask(before)
    if (operation === 'change') writeFileSync(join(root, 'src/input.txt'), 'second')
    if (operation === 'add' || operation === 'rename') writeFileSync(join(root, 'src/new.txt'), 'first')
    if (operation === 'delete' || operation === 'rename') rmSync(join(root, 'src/input.txt'))
    const after = task(root)
    expect(after.key).not.toBe(before.key)
    expect(restoreTask(after)).toBe(false)
  })

  it('isolates architecture and edition and rejects corrupted output', () => {
    const root = fixture()
    build(root)
    const entry = task(root)
    saveTask(entry)
    expect(restoreTask(task(root, { arch: 'x64', edition: 'global' }))).toBe(false)
    expect(restoreTask(task(root, { arch: 'arm64', edition: 'cn' }))).toBe(false)
    writeFileSync(join(entry.directory, 'outputs/0/result.txt'), 'corrupt')
    expect(restoreTask(entry)).toBe(false)
  })

  it('does not accept an incomplete manifest or save a missing output', () => {
    const root = fixture()
    const entry = task(root)
    expect(() => saveTask(entry)).toThrow()
    build(root)
    saveTask(entry)
    rmSync(join(entry.directory, 'manifest.json'))
    expect(restoreTask(entry)).toBe(false)
  })

  it('has the same key for the same inputs regardless of source commit', () => {
    const root = fixture()
    const first = task(root)
    expect(task(root).key).toBe(first.key)
    expect(createTask({ root, name: 'fixture', inputs: ['src'], outputs: ['other'], identity: {} }).key).not.toBe(
      first.key
    )
  })
})
