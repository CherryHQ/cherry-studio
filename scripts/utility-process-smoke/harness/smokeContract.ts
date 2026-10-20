/**
 * The contract both harness sides share. Two definitions differ only in cancellation policy,
 * so each needs its own entry: the child runtime rejects a connect frame whose processId is
 * not its own.
 */

import { defineUtilityProcess } from '../../../src/main/core/utilityProcess/defineUtilityProcess'
import type {
  UtilityProcessMethod,
  UtilityProcessStreamMethod,
  UtilityProcessStreamFrame
} from '../../../src/main/core/utilityProcess/types'

export const streamLimits = { maxFrameBytes: 4096, maxBufferedBytes: 8192, maxBufferedFrames: 3, maxPendingWrites: 2 }
export const streamOptions = { input: streamLimits, output: streamLimits }

export type SmokeContract = {
  streams: {
    duplex: UtilityProcessStreamMethod<void, UtilityProcessStreamFrame, UtilityProcessStreamFrame, number>
    produce: UtilityProcessStreamMethod<number, never, UtilityProcessStreamFrame, number>
    streamStall: UtilityProcessStreamMethod<void, never, UtilityProcessStreamFrame, never>
  }
  methods: {
    ping: UtilityProcessMethod<void, string>
    /** Round-trips a large typed array and reports what the child received. */
    echoBytes: UtilityProcessMethod<Uint8Array, { byteLength: number; checksum: number; bytes: Uint8Array }>
    /** Never settles and ignores its abort signal — models a wedged native call. */
    stall: UtilityProcessMethod<void, never>
    /** `process.abort()`s the child. */
    crash: UtilityProcessMethod<void, never>
    fetchThrough: UtilityProcessMethod<string, { status: number; body: string }>
    /** Writes one stdout line, one stderr line, and one child log frame. */
    logLines: UtilityProcessMethod<string, string>
  }
}

export interface SmokeInitData {
  label: string
}

export const smokeEchoProcess = defineUtilityProcess<SmokeContract, SmokeInitData>({
  id: 'smoke.echo',
  entry: 'smoke-echo',
  cancellation: 'cooperative',
  createInitData: () => ({ label: 'cooperative' })
})

export const smokeTerminateProcess = defineUtilityProcess<SmokeContract, SmokeInitData>({
  id: 'smoke.terminate',
  entry: 'smoke-echo-terminate',
  cancellation: 'terminate',
  createInitData: () => ({ label: 'terminate' })
})

export function checksum(bytes: Uint8Array): number {
  let result = 0
  for (const byte of bytes) result = (result + byte) >>> 0
  return result
}
