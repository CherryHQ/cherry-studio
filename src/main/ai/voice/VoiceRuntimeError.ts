import { IpcError } from '@shared/ipc/errors/IpcError'
import { voiceErrorCodes, type VoiceErrorReason } from '@shared/ipc/errors/voice'

export class VoiceRuntimeError extends Error {
  constructor(readonly reason: VoiceErrorReason) {
    super(reason)
    this.name = 'VoiceRuntimeError'
  }
}

export class VoiceCleanupError extends VoiceRuntimeError {
  constructor(reason: VoiceErrorReason = 'operation_failed') {
    super(reason)
    this.name = 'VoiceCleanupError'
  }
}

export function checkAbort(signal?: AbortSignal): void {
  if (signal?.aborted) throw new VoiceRuntimeError('aborted')
}

export function voiceIpcError(error: unknown): IpcError {
  const reason = error instanceof VoiceRuntimeError ? error.reason : 'operation_failed'
  return new IpcError(voiceErrorCodes[reason], reason, { reason })
}
