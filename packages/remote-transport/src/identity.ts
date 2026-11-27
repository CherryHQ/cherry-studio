import { generateKeyPair, privateKeyFromProtobuf, privateKeyToProtobuf } from '@libp2p/crypto/keys'
import { peerIdFromPrivateKey } from '@libp2p/peer-id'

export async function createDeviceIdentity(): Promise<Uint8Array> {
  return privateKeyToProtobuf(await generateKeyPair('Ed25519'))
}

export function readDeviceIdentity(bytes: Uint8Array) {
  const privateKey = privateKeyFromProtobuf(bytes)
  if (privateKey.type !== 'Ed25519') throw new Error('Remote identity must be Ed25519')
  return { privateKey, peerId: peerIdFromPrivateKey(privateKey) }
}

export function deviceIdentityId(bytes: Uint8Array): string {
  return readDeviceIdentity(bytes).peerId.toString()
}
