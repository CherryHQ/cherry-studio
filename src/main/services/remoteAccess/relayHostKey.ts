import { createHash, randomBytes } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'

import { safeStorage } from 'electron'

import { application } from '@application'

async function read(filename: string): Promise<Buffer | undefined> {
  try {
    return await readFile(filename)
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return undefined
    throw error
  }
}

/** Independent from the Noise identity; the canonical origin scopes the recovery secret. */
const pending = new Map<string, Promise<string>>()
export function loadRelayHostKey(origin: string): Promise<string> {
  const current = pending.get(origin)
  if (current) return current
  const operation = readOrCreate(origin).finally(() => pending.delete(origin))
  pending.set(origin, operation)
  return operation
}

async function readOrCreate(origin: string): Promise<string> {
  const name = createHash('sha256').update(origin).digest('hex')
  const encryptedFile = application.getPath('feature.remote_access.relay_keys', `${name}.enc`)
  const plainFile = application.getPath('feature.remote_access.relay_keys', `${name}.key`)
  const secure =
    safeStorage.isEncryptionAvailable() &&
    !(process.platform === 'linux' && safeStorage.getSelectedStorageBackend() === 'basic_text')
  const encrypted = await read(encryptedFile)
  const plain = encrypted ? undefined : await read(plainFile)
  if (encrypted && !secure) throw new Error('OS-protected key storage is unavailable')
  const stored = encrypted ? safeStorage.decryptString(encrypted) : plain?.toString('utf8')
  if (stored !== undefined) {
    if (!/^[a-f0-9]{64}$/.test(stored)) throw new Error('Invalid stored Relay key')
    return stored
  }
  const hostKey = randomBytes(32).toString('hex')
  try {
    await writeFile(secure ? encryptedFile : plainFile, secure ? safeStorage.encryptString(hostKey) : hostKey, {
      mode: 0o600,
      flag: 'wx'
    })
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'EEXIST') return readOrCreate(origin)
    throw error
  }
  return hostKey
}
