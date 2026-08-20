import { createHash, generateKeyPairSync, randomBytes } from 'node:crypto'

function toBase64Url(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64url')
}

export function createAuthorizationSecrets(): { state: string; codeVerifier: string; codeChallenge: string } {
  const state = toBase64Url(randomBytes(32))
  const codeVerifier = toBase64Url(randomBytes(32))
  const codeChallenge = createHash('sha256').update(codeVerifier, 'ascii').digest('base64url')
  return { state, codeVerifier, codeChallenge }
}

export function createDeviceKeyPair(): { publicKey: string; privateKey: string } {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519')
  const publicDer = publicKey.export({ format: 'der', type: 'spki' })
  const privateDer = privateKey.export({ format: 'der', type: 'pkcs8' })

  return {
    publicKey: Buffer.from(publicDer).subarray(-32).toString('base64url'),
    privateKey: Buffer.from(privateDer).toString('base64')
  }
}
