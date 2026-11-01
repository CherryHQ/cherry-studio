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

import { application } from '@application'
import { deviceIdentityId } from '@cherrystudio/remote-transport'

import { loadDesktopIdentity } from '../deviceIdentity'

let dir: string
beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'remote-identity-'))
  vi.mocked(application.getPath).mockImplementation((key: string) =>
    path.join(dir, key === 'feature.remote_access.identity_file' ? 'remote-identity.enc' : 'remote-identity.key')
  )
  keyStore.available = true
})
afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe('loadDesktopIdentity', () => {
  it('creates and reloads an identity when no OS key store exists', async () => {
    keyStore.available = false

    const created = deviceIdentityId(await loadDesktopIdentity())

    expect(deviceIdentityId(await loadDesktopIdentity())).toBe(created)
    const file = path.join(dir, 'remote-identity.key')
    expect((await stat(file)).mode & 0o777).toBe(0o600)
  })

  it('keeps the identity sealed when the OS key store is available', async () => {
    const created = deviceIdentityId(await loadDesktopIdentity())

    expect(deviceIdentityId(await loadDesktopIdentity())).toBe(created)
    expect((await readFile(path.join(dir, 'remote-identity.enc'), 'utf8')).startsWith('sealed:')).toBe(true)
    await expect(stat(path.join(dir, 'remote-identity.key'))).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('refuses to replace a sealed identity when the key store becomes unavailable', async () => {
    await loadDesktopIdentity()
    keyStore.available = false

    await expect(loadDesktopIdentity()).rejects.toThrow('OS-protected key storage is unavailable')
    await expect(stat(path.join(dir, 'remote-identity.key'))).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('keeps using a plaintext identity after a key store appears', async () => {
    keyStore.available = false
    const created = deviceIdentityId(await loadDesktopIdentity())
    keyStore.available = true

    expect(deviceIdentityId(await loadDesktopIdentity())).toBe(created)
  })
})
