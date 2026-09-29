import type { ComponentLogger, MessageStream, Upgrader } from '@libp2p/interface'
import { noise, pureJsCrypto } from '@libp2p/noise'
import { peerIdFromString } from '@libp2p/peer-id'
import { lpStream } from '@libp2p/utils'

import {
  negotiateProtocol,
  protocolSupportSchema,
  remoteLimits,
  type ProtocolSupport
} from '@cherrystudio/remote-protocol'

import { readDeviceIdentity } from './identity'

const profile = 'cherry-remote-noise-xx-v1'
const unsupportedUpgrade = (): never => {
  throw new Error('Remote transport does not use libp2p connection upgrades')
}
const upgrader: Upgrader = {
  upgradeInbound: unsupportedUpgrade,
  upgradeOutbound: unsupportedUpgrade,
  createInboundAbortSignal: unsupportedUpgrade,
  getStreamMuxers: () => new Map(),
  getConnectionEncrypters: () => new Map()
}
const encode = (value: unknown): Uint8Array => new TextEncoder().encode(JSON.stringify(value))
const decode = (bytes: Uint8Array): unknown => JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))

export interface ChannelOptions {
  identity: Uint8Array
  logger: ComponentLogger
  protocolVersions: number[]
  signal: AbortSignal
}

export interface SecureChannel {
  readonly remoteIdentity: string
  readonly protocolVersion: number
  readonly offeredVersions: readonly number[]
  read(signal?: AbortSignal): Promise<unknown>
  write(value: unknown, signal?: AbortSignal): Promise<void>
  close(): Promise<void>
  abort(error: Error): void
}

async function secure(
  stream: MessageStream,
  options: ChannelOptions,
  offer: ProtocolSupport,
  version: number,
  remoteIdentity?: string
): Promise<SecureChannel> {
  const identity = readDeviceIdentity(options.identity)
  const encrypter = noise({
    crypto: pureJsCrypto,
    prologueBytes: encode({ profile, protocolVersions: offer.protocolVersions, protocolVersion: version })
  })({ ...identity, logger: options.logger, upgrader })
  const securityOptions = { signal: options.signal, skipStreamMuxerNegotiation: true }
  const result =
    remoteIdentity === undefined
      ? await encrypter.secureInbound(stream, securityOptions)
      : await encrypter.secureOutbound(stream, { ...securityOptions, remotePeer: peerIdFromString(remoteIdentity) })
  if (result.remotePeer.type !== 'Ed25519') throw new Error('Remote identity must be Ed25519')
  const records = lpStream(result.connection, {
    maxDataLength: remoteLimits.recordBytes,
    maxBufferSize: remoteLimits.queuedBytes
  })
  let queuedBytes = 0
  let writes: Promise<void> = Promise.resolve()
  return {
    remoteIdentity: result.remotePeer.toString(),
    protocolVersion: version,
    offeredVersions: Object.freeze([...offer.protocolVersions]),
    async read(signal) {
      return decode((await records.read({ signal })).subarray())
    },
    write(value, signal) {
      const bytes = encode(value)
      if (bytes.length > remoteLimits.recordBytes || queuedBytes + bytes.length > remoteLimits.queuedBytes) {
        const error = new Error('Remote record budget exceeded')
        result.connection.abort(error)
        return Promise.reject(error)
      }
      queuedBytes += bytes.length
      const write = writes
        .then(() => records.write(bytes, { signal }))
        .finally(() => {
          queuedBytes -= bytes.length
        })
      writes = write
      void write.catch(() => {})
      return write
    },
    close: () => result.connection.close(),
    abort: (error) => result.connection.abort(error)
  }
}

export async function connectSecureChannel(
  stream: MessageStream,
  options: ChannelOptions & { remoteIdentity: string }
): Promise<SecureChannel> {
  try {
    const offer = protocolSupportSchema.parse({ protocolVersions: options.protocolVersions })
    const prelude = lpStream(stream, { maxDataLength: 4096, maxBufferSize: remoteLimits.recordBytes })
    await prelude.write(encode(offer), { signal: options.signal })
    const selection = decode((await prelude.read({ signal: options.signal })).subarray())
    if (
      typeof selection !== 'object' ||
      selection === null ||
      !('protocolVersion' in selection) ||
      typeof selection.protocolVersion !== 'number' ||
      !offer.protocolVersions.includes(selection.protocolVersion)
    )
      throw new Error('Unsupported remote protocol')
    return await secure(prelude.unwrap(), options, offer, selection.protocolVersion, options.remoteIdentity)
  } catch (error) {
    stream.abort(error instanceof Error ? error : new Error('Remote handshake failed'))
    throw error
  }
}

export async function acceptSecureChannel(stream: MessageStream, options: ChannelOptions): Promise<SecureChannel> {
  try {
    const prelude = lpStream(stream, { maxDataLength: 4096, maxBufferSize: remoteLimits.recordBytes })
    const offer = protocolSupportSchema.parse(decode((await prelude.read({ signal: options.signal })).subarray()))
    const result = negotiateProtocol({ protocolVersions: options.protocolVersions }, offer)
    if (!result.ok) throw new Error('Unsupported remote protocol')
    await prelude.write(encode(result.selection), { signal: options.signal })
    return await secure(prelude.unwrap(), options, offer, result.selection.protocolVersion)
  } catch (error) {
    stream.abort(error instanceof Error ? error : new Error('Remote handshake failed'))
    throw error
  }
}
