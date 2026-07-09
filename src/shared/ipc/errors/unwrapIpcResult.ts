import { IpcError, IpcErrorCode, type IpcResult } from './IpcError'

export async function unwrapIpcResult<T>(pending: Promise<unknown>): Promise<T> {
  const result = await pending
  if (typeof result !== 'object' || result === null || !('ok' in result)) {
    throw new IpcError(IpcErrorCode.INTERNAL, 'IpcApi returned a malformed result')
  }
  const envelope = result as IpcResult<T>
  if (envelope.ok) return envelope.data
  throw IpcError.fromJSON(envelope.error)
}
