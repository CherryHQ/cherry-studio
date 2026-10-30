import { randomBytes } from 'node:crypto'
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { createTask } from '../release/build-cache'
import { encryptionKey, restoreEncryptedTask, saveEncryptedTask } from '../release/encrypted-build-cache'

const roots: string[] = []
afterEach(() => roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true })))

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'encrypted-build-'))
  roots.push(root)
  mkdirSync(join(root, 'out'))
  writeFileSync(join(root, 'input.js'), 'source')
  writeFileSync(join(root, 'out/app.js'), 'injected-client-secret')
  writeFileSync(join(root, 'out/app.js.map'), 'matching-private-source-map')
  const task = createTask({
    root,
    name: 'renderer',
    inputs: ['input.js'],
    outputs: ['out'],
    identity: { edition: 'global' },
    cacheRoot: join(root, 'encrypted')
  })
  return { root, task, key: randomBytes(32) }
}

describe('encrypted release cache', () => {
  it('stores only ciphertext and restores the complete JS/map pair into clean output', async () => {
    const { root, task, key } = fixture()
    await saveEncryptedTask(task, key)
    const encrypted = readFileSync(`${task.directory}.bin`)
    expect(encrypted.includes(Buffer.from('injected-client-secret'))).toBe(false)
    expect(encrypted.includes(Buffer.from('matching-private-source-map'))).toBe(false)
    expect(encrypted.includes(key)).toBe(false)
    expect(readdirSync(join(root, 'encrypted/renderer'))).toEqual([`${task.key}.bin`])
    rmSync(join(root, 'out'), { recursive: true })
    mkdirSync(join(root, 'out'))
    writeFileSync(join(root, 'out/stale.js'), 'must disappear')
    expect(await restoreEncryptedTask(task, key)).toBe(true)
    expect(readFileSync(join(root, 'out/app.js'), 'utf8')).toBe('injected-client-secret')
    expect(readFileSync(join(root, 'out/app.js.map'), 'utf8')).toBe('matching-private-source-map')
    expect(readdirSync(join(root, 'out')).sort()).toEqual(['app.js', 'app.js.map'])
  })

  it.each(['wrong-key', 'tampered', 'truncated', 'wrong-task'])(
    'does not modify output when rejecting %s',
    async (failure) => {
      const { root, task, key } = fixture()
      await saveEncryptedTask(task, key)
      const original = readFileSync(`${task.directory}.bin`)
      if (failure === 'tampered') {
        original[25] ^= 1
        writeFileSync(`${task.directory}.bin`, original)
      }
      if (failure === 'truncated') writeFileSync(`${task.directory}.bin`, original.subarray(0, 10))
      writeFileSync(join(root, 'out/app.js'), 'untouched')
      expect(
        await restoreEncryptedTask(
          failure === 'wrong-task' ? { ...task, key: 'different-task-identity' } : task,
          failure === 'wrong-key' ? randomBytes(32) : key
        )
      ).toBe(false)
      expect(readFileSync(join(root, 'out/app.js'), 'utf8')).toBe('untouched')
    }
  )

  it('uses fresh nonces for repeated saves and accepts only 32-byte hex keys', async () => {
    const { task, key } = fixture()
    await saveEncryptedTask(task, key)
    const first = readFileSync(`${task.directory}.bin`)
    await saveEncryptedTask(task, key)
    expect(readFileSync(`${task.directory}.bin`).equals(first)).toBe(false)
    expect(encryptionKey({ CHERRY_BUILD_CACHE_KEY: key.toString('hex') })).toEqual(key)
    for (const value of ['', 'password', 'a'.repeat(63), 'g'.repeat(64)]) {
      expect(encryptionKey({ CHERRY_BUILD_CACHE_KEY: value })).toBeNull()
    }
  })
})
