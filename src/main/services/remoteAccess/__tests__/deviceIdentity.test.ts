import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const keyStore = vi.hoisted(() => ({ available: true, backend: 'gnome_libsecret', shouldReEncrypt: false }))
const storage = vi.hoisted(() => ({
  isAsyncEncryptionAvailable: vi.fn<() => Promise<boolean>>(),
  encryptStringAsync: vi.fn<(value: string) => Promise<Buffer>>(),
  decryptStringAsync: vi.fn<(value: Buffer) => Promise<{ result: string; shouldReEncrypt: boolean }>>(),
  getSelectedStorageBackend: () => keyStore.backend,
  isEncryptionAvailable: vi.fn(() => {
    throw new Error('Forbidden synchronous availability')
  }),
  encryptString: vi.fn(() => {
    throw new Error('Forbidden synchronous encryption')
  }),
  decryptString: vi.fn(() => {
    throw new Error('Forbidden synchronous decryption')
  })
}))
vi.mock('electron', () => ({ safeStorage: storage }))
vi.mock('@application', async () => {
  const { mockApplicationFactory } = await import('@test-mocks/main/application')
  return mockApplicationFactory()
})

import { application } from '@application'
import { createDeviceIdentity, deviceIdentityId } from '@cherrystudio/remote-transport'

import { loadDesktopIdentity } from '../deviceIdentity'

let dir: string
beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'remote-identity-'))
  vi.mocked(application.getPath).mockImplementation((key: string) =>
    path.join(dir, key === 'feature.remote_access.identity_file' ? 'remote-identity.enc' : 'remote-identity.key')
  )
  keyStore.available = true
  keyStore.backend = 'gnome_libsecret'
  keyStore.shouldReEncrypt = false
  vi.clearAllMocks()
  storage.isAsyncEncryptionAvailable.mockImplementation(async () => keyStore.available)
  storage.encryptStringAsync.mockImplementation(async (value) => Buffer.from(`sealed:${value}`))
  storage.decryptStringAsync.mockImplementation(async (value) => ({
    result: value.toString('utf8').replace(/^sealed:/, ''),
    shouldReEncrypt: keyStore.shouldReEncrypt
  }))
})
afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
  vi.restoreAllMocks()
  expect(storage.isEncryptionAvailable).toHaveBeenCalledTimes(0)
  expect(storage.encryptString).toHaveBeenCalledTimes(0)
  expect(storage.decryptString).toHaveBeenCalledTimes(0)
})

async function files() {
  return Object.fromEntries(
    await Promise.all(
      (await readdir(dir)).sort().map(async (name) => [name, await readFile(path.join(dir, name), 'utf8')])
    )
  )
}

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
    expect((await stat(path.join(dir, 'remote-identity.enc'))).mode & 0o777).toBe(0o600)
    await expect(stat(path.join(dir, 'remote-identity.key'))).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('refuses to replace a sealed identity when the key store becomes unavailable', async () => {
    await loadDesktopIdentity()
    const before = await files()
    keyStore.available = false

    await expect(loadDesktopIdentity()).rejects.toThrow('OS-protected key storage is unavailable')
    await expect(stat(path.join(dir, 'remote-identity.key'))).rejects.toMatchObject({ code: 'ENOENT' })
    expect(await files()).toEqual(before)
  })

  it('keeps using a plaintext identity after a key store appears', async () => {
    keyStore.available = false
    const created = deviceIdentityId(await loadDesktopIdentity())
    const before = await files()
    keyStore.available = true

    expect(deviceIdentityId(await loadDesktopIdentity())).toBe(created)
    expect(await files()).toEqual(before)
    expect(storage.encryptStringAsync).toHaveBeenCalledTimes(0)
  })

  it.each([false, true])('reuses sealed identity without rewriting when shouldReEncrypt is %s', async (value) => {
    const identity = await createDeviceIdentity()
    const sealed = `sealed:${Buffer.from(identity).toString('base64')}`
    await writeFile(path.join(dir, 'remote-identity.enc'), sealed)
    keyStore.shouldReEncrypt = value

    expect(deviceIdentityId(await loadDesktopIdentity())).toBe(deviceIdentityId(identity))
    expect(await files()).toEqual({ 'remote-identity.enc': sealed })
    expect(storage.encryptStringAsync).toHaveBeenCalledTimes(0)
  })

  it('prefers the encrypted identity when both files exist', async () => {
    const identity = await createDeviceIdentity()
    await writeFile(path.join(dir, 'remote-identity.enc'), `sealed:${Buffer.from(identity).toString('base64')}`)
    await writeFile(path.join(dir, 'remote-identity.key'), Buffer.from(await createDeviceIdentity()).toString('base64'))
    const before = await files()

    expect(deviceIdentityId(await loadDesktopIdentity())).toBe(deviceIdentityId(identity))
    expect(await files()).toEqual(before)
  })

  it('treats Linux basic_text as insecure even when async availability is true', async () => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue('linux')
    keyStore.backend = 'basic_text'
    const created = deviceIdentityId(await loadDesktopIdentity())

    expect(deviceIdentityId(await loadDesktopIdentity())).toBe(created)
    expect(await files()).toEqual({ 'remote-identity.key': expect.any(String) })
    expect((await stat(path.join(dir, 'remote-identity.key'))).mode & 0o777).toBe(0o600)
    expect(storage.encryptStringAsync).toHaveBeenCalledTimes(0)
  })

  it('preserves sealed identity on Linux basic_text with async availability true', async () => {
    await loadDesktopIdentity()
    const before = await files()
    vi.spyOn(process, 'platform', 'get').mockReturnValue('linux')
    keyStore.backend = 'basic_text'

    await expect(loadDesktopIdentity()).rejects.toThrow('OS-protected key storage is unavailable')
    expect(await files()).toEqual(before)
    expect(storage.decryptStringAsync).toHaveBeenCalledTimes(0)
  })

  it.each(['absent', 'sealed', 'plaintext'])(
    'propagates availability rejection with %s identity untouched',
    async (existing) => {
      if (existing !== 'absent') {
        keyStore.available = existing === 'sealed'
        await loadDesktopIdentity()
      }
      const before = await files()
      const failure = new Error('availability denied')
      storage.isAsyncEncryptionAvailable.mockRejectedValueOnce(failure)

      await expect(loadDesktopIdentity()).rejects.toBe(failure)
      expect(await files()).toEqual(before)
    }
  )

  it('propagates decryption rejection without falling back to plaintext or replacing files', async () => {
    await loadDesktopIdentity()
    await writeFile(path.join(dir, 'remote-identity.key'), Buffer.from(await createDeviceIdentity()).toString('base64'))
    const before = await files()
    const failure = new Error('decryption denied')
    storage.decryptStringAsync.mockRejectedValueOnce(failure)

    await expect(loadDesktopIdentity()).rejects.toBe(failure)
    expect(await files()).toEqual(before)
  })

  it('propagates encryption rejection without writing either identity file', async () => {
    const failure = new Error('encryption denied')
    storage.encryptStringAsync.mockRejectedValueOnce(failure)

    await expect(loadDesktopIdentity()).rejects.toBe(failure)
    expect(await files()).toEqual({})
  })

  it('waits for async encryption before exclusively creating the sealed file', async () => {
    let encrypted!: (value: Buffer) => void
    let entered!: () => void
    const entry = new Promise<void>((resolve) => {
      entered = resolve
    })
    let base64 = ''
    storage.encryptStringAsync.mockImplementationOnce((value) => {
      base64 = value
      entered()
      return new Promise((resolve) => {
        encrypted = resolve
      })
    })
    let settled = false
    const pending = loadDesktopIdentity().finally(() => {
      settled = true
    })
    await entry
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(settled).toBe(false)
    expect(await files()).toEqual({})
    encrypted(Buffer.from(`sealed:${base64}`))

    expect(deviceIdentityId(await pending)).toBe(deviceIdentityId(Buffer.from(base64, 'base64')))
    expect(await files()).toEqual({ 'remote-identity.enc': `sealed:${base64}` })
    expect((await stat(path.join(dir, 'remote-identity.enc'))).mode & 0o777).toBe(0o600)
  })

  it('waits for async decryption and returns the existing identity unchanged', async () => {
    const identity = await createDeviceIdentity()
    const sealed = `sealed:${Buffer.from(identity).toString('base64')}`
    await writeFile(path.join(dir, 'remote-identity.enc'), sealed)
    let decrypted!: (value: { result: string; shouldReEncrypt: boolean }) => void
    let entered!: () => void
    const entry = new Promise<void>((resolve) => {
      entered = resolve
    })
    storage.decryptStringAsync.mockImplementationOnce(() => {
      entered()
      return new Promise((resolve) => {
        decrypted = resolve
      })
    })
    let settled = false
    const pending = loadDesktopIdentity().finally(() => {
      settled = true
    })
    await entry
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(settled).toBe(false)
    decrypted({ result: Buffer.from(identity).toString('base64'), shouldReEncrypt: true })

    expect(deviceIdentityId(await pending)).toBe(deviceIdentityId(identity))
    expect(await files()).toEqual({ 'remote-identity.enc': sealed })
  })

  it('rejects an exclusive-create collision without overwriting the winning file', async () => {
    storage.encryptStringAsync.mockImplementationOnce(async (value) => {
      await writeFile(path.join(dir, 'remote-identity.enc'), 'other writer')
      return Buffer.from(`sealed:${value}`)
    })

    await expect(loadDesktopIdentity()).rejects.toMatchObject({ code: 'EEXIST' })
    expect(await files()).toEqual({ 'remote-identity.enc': 'other writer' })
  })

  it.each(['remote-identity.enc', 'remote-identity.key'])(
    'rejects corrupt identity in %s without replacement',
    async (file) => {
      await writeFile(path.join(dir, file), 'corrupt')
      const before = await files()

      await expect(loadDesktopIdentity()).rejects.toThrow()
      expect(await files()).toEqual(before)
    }
  )

  it('propagates read errors other than ENOENT without generating a replacement', async () => {
    await mkdir(path.join(dir, 'remote-identity.enc'))

    await expect(loadDesktopIdentity()).rejects.toMatchObject({ code: 'EISDIR' })
    expect((await stat(path.join(dir, 'remote-identity.enc'))).isDirectory()).toBe(true)
    await expect(stat(path.join(dir, 'remote-identity.key'))).rejects.toMatchObject({ code: 'ENOENT' })
  })
})
