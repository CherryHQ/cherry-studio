import { randomUUID } from 'node:crypto'
import { mkdir, readFile } from 'node:fs/promises'

import { safeStorage } from 'electron'
import nacl from 'tweetnacl'
import * as z from 'zod'

import { application } from '@application'
import { atomicWriteFile } from '@main/utils/file'
import { AbsoluteFilePathSchema } from '@shared/types/file'

const identitySchema = z.strictObject({
  instanceId: z.uuid(),
  secretKey: z.string().regex(/^[A-Za-z0-9+/]{43}=$/)
})

export type RemoteIdentity = { instanceId: string; secretKey: Uint8Array; publicKey: string }

function assertSecureStorage(): void {
  if (
    !safeStorage.isEncryptionAvailable() ||
    (process.platform === 'linux' && safeStorage.getSelectedStorageBackend() === 'basic_text')
  ) {
    throw new Error('SECURE_STORAGE_UNAVAILABLE')
  }
}

async function persist(identity: RemoteIdentity): Promise<void> {
  assertSecureStorage()
  const directory = application.getPath('feature.remote_access.credentials')
  const target = AbsoluteFilePathSchema.parse(application.getPath('feature.remote_access.credentials', 'identity.bin'))
  await mkdir(directory, { recursive: true, mode: 0o700 })
  const ciphertext = safeStorage.encryptString(
    JSON.stringify({
      instanceId: identity.instanceId,
      secretKey: Buffer.from(identity.secretKey).toString('base64')
    })
  )
  await atomicWriteFile(target, ciphertext, { mode: 0o600 })
}

export async function loadIdentity(): Promise<RemoteIdentity> {
  assertSecureStorage()
  let encrypted: Buffer
  try {
    encrypted = await readFile(application.getPath('feature.remote_access.credentials', 'identity.bin'))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    const pair = nacl.box.keyPair()
    const identity = {
      instanceId: randomUUID(),
      secretKey: pair.secretKey,
      publicKey: Buffer.from(pair.publicKey).toString('base64')
    }
    await persist(identity)
    return identity
  }
  const stored = identitySchema.parse(JSON.parse(safeStorage.decryptString(encrypted)))
  const secretKey = Buffer.from(stored.secretKey, 'base64')
  return {
    ...stored,
    secretKey,
    publicKey: Buffer.from(nacl.box.keyPair.fromSecretKey(secretKey).publicKey).toString('base64')
  }
}
