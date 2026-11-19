export const VOICE_RECOGNITION_OFF = 'off'

export function isVoiceRecognitionOff(value: string | null | undefined): boolean {
  return value?.trim() === VOICE_RECOGNITION_OFF
}
