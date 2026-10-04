import { readFile, writeFile } from 'node:fs/promises'

import { safeStorage } from 'electron'

import { application } from '@application'
import { createDeviceIdentity, deviceIdentityId } from '@cherrystudio/remote-transport'

export async function loadDesktopIdentity(): Promise<Uint8Array> {
  if (
    !safeStorage.isEncryptionAvailable() ||
    (process.platform === 'linux' && safeStorage.getSelectedStorageBackend() === 'basic_text')
  )
    throw new Error('OS-protected key storage is unavailable')
  const filename = application.getPath('feature.remote_access.identity_file')
  try {
    const bytes = Buffer.from(safeStorage.decryptString(await readFile(filename)), 'base64')
    deviceIdentityId(bytes)
    return bytes
  } catch (error) {
    if (!(error instanceof Error) || !('code' in error) || error.code !== 'ENOENT') throw error
  }
  const identity = await createDeviceIdentity()
  await writeFile(filename, safeStorage.encryptString(Buffer.from(identity).toString('base64')), {
    mode: 0o600,
    flag: 'wx'
  })
  return identity
}
