import { IpcError } from '@shared/ipc/errors/IpcError'
import { voiceErrorCodes, type VoiceErrorReason } from '@shared/ipc/errors/voice'

export class VoiceRuntimeError extends Error {
  constructor(readonly reason: VoiceErrorReason) {
    super(reason)
    this.name = 'VoiceRuntimeError'
  }
}

export function voiceIpcError(error: unknown): IpcError {
  const reason = error instanceof VoiceRuntimeError ? error.reason : 'operation_failed'
  return new IpcError(voiceErrorCodes[reason], reason, { reason })
}
