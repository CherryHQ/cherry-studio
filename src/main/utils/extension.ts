import { createHash } from 'crypto'

/**
 * Converts a normal hexadecimal string into the alphabet used by extensions.
 * We use the characters 'a'-'p' instead of '0'-'f' to avoid ever having a
 * completely numeric host, since some software interprets that as an IP address.
 *
 * @param id - The hexadecimal string to convert. This is modified in place.
 */
export function convertHexadecimalToIDAlphabet(id: string) {
  let result = ''
  for (const ch of id) {
    const val = parseInt(ch, 16)
    if (!isNaN(val)) {
      result += String.fromCharCode('a'.charCodeAt(0) + val)
    } else {
      result += 'a'
    }
  }
  return result
}

function generateIdFromHash(hash: Buffer): string {
  const hashedId = hash.subarray(0, 16).toString('hex')
  return convertHexadecimalToIDAlphabet(hashedId)
}

export function generateId(input: string): string {
  const hash = createHash('sha256').update(input, 'base64').digest()
  return generateIdFromHash(hash)
}

export async function loadManifestV3(extension: Electron.Extension, session: Electron.Session): Promise<void> {
  if (extension.manifest.manifest_version === 3 && extension.manifest.background?.service_worker) {
    const scope = `chrome-extension://${extension.id}`
    await session.serviceWorkers.startWorkerForScope(scope).catch(() => {
      console.error(`Failed to start worker for extension ${extension.id}`)
    })
  }
}
