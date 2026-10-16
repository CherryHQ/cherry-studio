import { loggerService } from '@logger'

const logger = loggerService.withContext('AudioSpectrum')

export interface AudioSpectrum {
  readonly analyser: AnalyserNode
  resume(): Promise<void>
  dispose(): void
}

export function createAudioSpectrum(input: MediaStream | HTMLAudioElement): AudioSpectrum | undefined {
  if (typeof AudioContext === 'undefined') return undefined
  let allocatedContext: AudioContext | undefined
  try {
    const context = new AudioContext()
    allocatedContext = context
    const analyser = context.createAnalyser()
    analyser.fftSize = 1024
    analyser.smoothingTimeConstant = 0.8
    const microphone = 'getTracks' in input
    const source = microphone ? context.createMediaStreamSource(input) : context.createMediaElementSource(input)
    if (!microphone) source.connect(context.destination)
    source.connect(analyser)
    if (microphone)
      void context.resume().catch((error: unknown) => logger.warn('Could not resume audio spectrum', { error }))
    return {
      analyser,
      resume: () => context.resume(),
      dispose() {
        source.disconnect()
        analyser.disconnect()
        void context.close().catch((error: unknown) => logger.warn('Could not close audio spectrum', { error }))
      }
    }
  } catch (error) {
    void allocatedContext?.close().catch(() => undefined)
    logger.warn('Could not create audio spectrum', { error })
    return undefined
  }
}
