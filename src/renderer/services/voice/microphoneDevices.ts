import type { VoiceErrorReason } from '@shared/ipc/errors/voice'

export interface MicrophoneDevice {
  readonly deviceId: string
  readonly label: string
}

export async function enumerateMicrophones(): Promise<readonly MicrophoneDevice[]> {
  const devices = await navigator.mediaDevices.enumerateDevices()
  return devices
    .filter((device) => device.kind === 'audioinput' && device.deviceId && device.deviceId !== 'default')
    .map(({ deviceId, label }) => ({ deviceId, label }))
}

export function subscribeMicrophoneChanges(onChange: () => void): () => void {
  navigator.mediaDevices.addEventListener('devicechange', onChange)
  return () => navigator.mediaDevices.removeEventListener('devicechange', onChange)
}

export function microphoneErrorReason(cause: unknown): VoiceErrorReason {
  if (cause instanceof DOMException) {
    if (['NotAllowedError', 'PermissionDeniedError', 'SecurityError'].includes(cause.name))
      return 'microphone_permission'
    if (
      cause.name === 'NotFoundError' ||
      (cause.name === 'OverconstrainedError' && 'constraint' in cause && cause.constraint === 'deviceId')
    )
      return 'microphone_unavailable'
    if (cause.name === 'NotReadableError') return 'microphone_unreadable'
  }
  return 'recording_failed'
}
