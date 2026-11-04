import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const keyStore = vi.hoisted(() => ({ available: true }))
vi.mock('electron', () => ({
  safeStorage: {
    isEncryptionAvailable: () => keyStore.available,
    getSelectedStorageBackend: () => (keyStore.available ? 'gnome_libsecret' : 'basic_text'),
    encryptString: (value: string) => Buffer.from(`sealed:${value}`),
    decryptString: (value: Buffer) => {
      if (!keyStore.available) throw new Error('decrypt without key store')
      return value.toString('utf8').replace(/^sealed:/, '')
    }
  }
}))
vi.mock('@application', async () => {
  const { mockApplicationFactory } = await import('@test-mocks/main/application')
  return mockApplicationFactory()
})

import { createHash } from 'node:crypto'
import { writeFile } from 'node:fs/promises'

import { application } from '@application'

import { loadRelayHostKey } from '../relayHostKey'
const origin = 'https://relay.example.com'
const basename = createHash('sha256').update(origin).digest('hex')
const load = () => loadRelayHostKey(origin)

let dir: string
beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'remote-host key-'))
  vi.mocked(application.getPath).mockImplementation((_key: string, filename?: string) => path.join(dir, filename!))
  keyStore.available = true
})
afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe('loadRelayHostKey', () => {
  it('isolates origins and shares concurrent initialization', async () => {
    const keys = await Promise.all(Array.from({ length: 8 }, () => load()))
    expect(new Set(keys).size).toBe(1)
    expect(keys[0]).toMatch(/^[a-f0-9]{64}$/)
    expect(await loadRelayHostKey('https://another.example.com')).not.toBe(keys[0])
  })

  it('does not silently replace corrupt stored keys', async () => {
    await writeFile(path.join(dir, `${basename}.key`), 'broken')
    await expect(load()).rejects.toThrow('Invalid stored Relay key')
  })

  it('creates and reloads an host key when no OS key store exists', async () => {
    keyStore.available = false

    const created = await load()

    expect(await load()).toBe(created)
    const file = path.join(dir, `${basename}.key`)
    expect((await stat(file)).mode & 0o777).toBe(0o600)
  })

  it('keeps the host key sealed when the OS key store is available', async () => {
    const created = await load()

    expect(await load()).toBe(created)
    expect((await readFile(path.join(dir, `${basename}.enc`), 'utf8')).startsWith('sealed:')).toBe(true)
    await expect(stat(path.join(dir, `${basename}.key`))).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('refuses to replace a sealed host key when the key store becomes unavailable', async () => {
    await load()
    keyStore.available = false

    await expect(load()).rejects.toThrow('OS-protected key storage is unavailable')
    await expect(stat(path.join(dir, `${basename}.key`))).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('keeps using a plaintext host key after a key store appears', async () => {
    keyStore.available = false
    const created = await load()
    keyStore.available = true

    expect(await load()).toBe(created)
  })
})
