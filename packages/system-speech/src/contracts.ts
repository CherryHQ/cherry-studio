export type AppleAssetStatus = 'unsupported' | 'supported' | 'downloading' | 'installed'

export type SystemSpeechErrorCode =
  | 'unsupported_os'
  | 'unsupported_locale'
  | 'asset_required'
  | 'asset_installation_failed'
  | 'voice_unavailable'
  | 'unsupported_recording_format'
  | 'audio_decode_failed'
  | 'audio_conversion_failed'
  | 'transcription_failed'
  | 'synthesis_failed'
  | 'cancelled'
  | 'invalid_request'
  | 'native_helper_failed'

export interface InstalledVoice {
  id: string
  name: string
  locale: string
  quality: number
}

export interface CapabilitiesResult {
  osVersion: string
  requestedLocale: string
  supportedLocale: string | null
  appleAssetStatus: AppleAssetStatus
  voices: InstalledVoice[]
}

export type NativeRequest =
  | { operation: 'capabilities'; locale: string }
  | { operation: 'install_asr_assets'; locale: string; confirmDownload: true }
  | { operation: 'transcribe'; locale: string; inputPath: string }
  | { operation: 'synthesize'; voiceId: string; text: string; outputPath: string }

export type NativeSuccess =
  | { operation: 'capabilities'; result: CapabilitiesResult }
  | { operation: 'install_asr_assets'; result: { locale: string; status: 'installed' } }
  | { operation: 'transcribe'; result: { locale: string; text: string } }
  | {
      operation: 'synthesize'
      result: { voiceId: string; outputPath: string; sampleRate: number; channels: number; frameCount: number }
    }

export type NativeResponse =
  | { ok: true; value: NativeSuccess }
  | { ok: false; error: { code: SystemSpeechErrorCode; message: string } }

export class SystemSpeechError extends Error {
  constructor(
    readonly code: SystemSpeechErrorCode,
    message: string = code,
    options?: ErrorOptions
  ) {
    super(message, options)
    this.name = 'SystemSpeechError'
  }
}

export function speechError(code: SystemSpeechErrorCode, cause?: unknown): SystemSpeechError {
  return new SystemSpeechError(code, code, cause === undefined ? undefined : { cause })
}

export function isSystemSpeechError(error: unknown): error is SystemSpeechError {
  return error instanceof SystemSpeechError
}

export function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw speechError('cancelled', signal.reason)
  }
}
