export interface SpeechPlayback extends EventTarget {
  readonly analyser?: AnalyserNode
  play(): Promise<void>
  pause(): Promise<void>
  close(): Promise<void>
}

export type PcmProcessorInput =
  | { type: 'pcm'; startFrame: number; samples: Float32Array }
  | { type: 'end'; frames: number }

export type PcmProcessorOutput =
  | { type: 'consumed'; frames: number; underruns: number; peakFrames: number }
  | { type: 'drained'; frames: number; contextTime: number }
  | { type: 'error' }
