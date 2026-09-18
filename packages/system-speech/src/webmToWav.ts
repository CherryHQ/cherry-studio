import { isSystemSpeechError, speechError, throwIfAborted } from './contracts'
import { downmixToMono, encodePcm16Wav, resampleLinear } from './pcm'

export interface WebmToWavOptions {
  createAudioContext?: () => AudioContext
  targetSampleRate?: number
  signal?: AbortSignal
}

export interface ConvertedWav {
  wav: Uint8Array
  sampleRate: number
  channels: 1
  durationSeconds: number
}

export async function webmOpusToWav(blob: Blob, options: WebmToWavOptions = {}): Promise<ConvertedWav> {
  if (!blob.type.toLowerCase().startsWith('audio/webm')) {
    throw speechError('unsupported_recording_format')
  }

  const context = (options.createAudioContext ?? (() => new AudioContext()))()
  try {
    throwIfAborted(options.signal)
    const decoded = await context.decodeAudioData(await blob.arrayBuffer())
    throwIfAborted(options.signal)
    const channels = Array.from({ length: decoded.numberOfChannels }, (_, index) => decoded.getChannelData(index))
    const mono = downmixToMono(channels, options.signal)
    const sampleRate = options.targetSampleRate ?? 16_000
    const samples = resampleLinear(mono, decoded.sampleRate, sampleRate, options.signal)
    return {
      wav: encodePcm16Wav(samples, sampleRate, options.signal),
      sampleRate,
      channels: 1,
      durationSeconds: samples.length / sampleRate
    }
  } catch (error) {
    if (isSystemSpeechError(error)) {
      throw error
    }
    throw speechError('audio_decode_failed', error)
  } finally {
    await context.close()
  }
}
