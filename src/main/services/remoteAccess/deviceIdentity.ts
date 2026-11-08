import { readFile, writeFile } from 'node:fs/promises'

import { safeStorage } from 'electron'

import { application } from '@application'
import { createDeviceIdentity, deviceIdentityId } from '@cherrystudio/remote-transport'
import { loggerService } from '@logger'

const logger = loggerService.withContext('RemoteDeviceIdentity')

async function readIfExists(filename: string): Promise<Buffer | undefined> {
  try {
    return await readFile(filename)
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return undefined
    throw error
  }
}

function decodeIdentity(base64: string): Uint8Array {
  const bytes = Buffer.from(base64, 'base64')
  deviceIdentityId(bytes)
  return bytes
}

async function hasOsProtectedKeyStore(platform: NodeJS.Platform): Promise<boolean> {
  // Async availability only confirms encryptor initialization, which on Linux may use
  // Chromium's hardcoded POSIX fallback key rather than an OS-protected key store.
  if (platform === 'linux') return safeStorage.isEncryptionAvailable()
  return safeStorage.isAsyncEncryptionAvailable()
}

export async function loadDesktopIdentity(): Promise<Uint8Array> {
  const secure =
    (await hasOsProtectedKeyStore(process.platform)) &&
    !(process.platform === 'linux' && safeStorage.getSelectedStorageBackend() === 'basic_text')
  const encryptedFile = application.getPath('feature.remote_access.identity_file')
  const plainFile = application.getPath('feature.remote_access.plain_identity_file')

  const encrypted = await readIfExists(encryptedFile)
  if (encrypted) {
    // Never replace an existing identity: that would silently unpair every device.
    if (!secure) throw new Error('OS-protected key storage is unavailable')
    const { result } = await safeStorage.decryptStringAsync(encrypted)
    return decodeIdentity(result)
  }
  const plain = await readIfExists(plainFile)
  if (plain) return decodeIdentity(plain.toString('utf8'))

  const identity = await createDeviceIdentity()
  const base64 = Buffer.from(identity).toString('base64')
  if (secure) {
    await writeFile(encryptedFile, await safeStorage.encryptStringAsync(base64), { mode: 0o600, flag: 'wx' })
  } else {
    logger.warn('OS-protected key storage is unavailable; storing the remote identity unencrypted')
    await writeFile(plainFile, base64, { mode: 0o600, flag: 'wx' })
  }
  return identity
}
