/** Handlers shared by both smoke entries. Child-safe: only `electron` and the runtime types. */

import { net } from 'electron'

import type { UtilityProcessHandlers } from '../../../../src/main/core/utilityProcess/runtime/serveUtilityProcess'
import { checksum, type SmokeContract, type SmokeInitData } from '../smokeContract'

export const smokeHandlers: UtilityProcessHandlers<SmokeContract> = {
  ping: () => 'pong',
  echoBytes: (bytes) => {
    if (!(bytes instanceof Uint8Array)) throw new TypeError('echoBytes did not receive a Uint8Array')
    return { byteLength: bytes.byteLength, checksum: checksum(bytes), bytes }
  },
  stream: (count, { emit }) => {
    for (let index = 1; index <= count; index += 1) emit(index)
    return 'done'
  },
  stall: () => new Promise<never>(() => {}),
  crash: () => {
    setImmediate(() => process.abort())
    return new Promise<never>(() => {})
  },
  exitNow: (code) => {
    setImmediate(() => process.exit(code))
    return new Promise<never>(() => {})
  },
  fetchThrough: async (url) => {
    const response = await net.fetch(url)
    return { status: response.status, body: await response.text() }
  },
  logLines: (message, { logger }) => {
    process.stdout.write(`smoke-stdout ${message}\n`)
    process.stderr.write(`smoke-stderr ${message}\n`)
    logger.info(`smoke-log ${message}`, { relayed: true })
    return 'logged'
  }
}

export function initialize({ label }: SmokeInitData, context: { logger: { info: (message: string) => void } }): void {
  if (typeof label !== 'string') throw new TypeError('initData.label must be a string')
  context.logger.info(`initialized as ${label}`)
}

export function dispose(context: { logger: { info: (message: string) => void } }): void {
  context.logger.info('disposed')
}
