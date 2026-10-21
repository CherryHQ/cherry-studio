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

export function microphoneErrorReason(error: unknown): VoiceErrorReason {
  if (error instanceof DOMException) {
    if (['NotAllowedError', 'PermissionDeniedError', 'SecurityError'].includes(error.name))
      return 'microphone_permission'
    if (
      error.name === 'NotFoundError' ||
      (error.name === 'OverconstrainedError' && 'constraint' in error && error.constraint === 'deviceId')
    )
      return 'microphone_unavailable'
    if (error.name === 'NotReadableError') return 'microphone_unreadable'
  }
  return 'recording_failed'
}
