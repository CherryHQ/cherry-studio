export const AsrEngine = { Sherpa: 'sherpa', Mlx: 'mlx' } as const
export type AsrEngine = (typeof AsrEngine)[keyof typeof AsrEngine]

export interface FunAsrModelPaths {
  encoder: string
  llm: string
  embedding: string
  tokenizerDir: string
  voiceActivityDetector: string
}

/** The sherpa-onnx offline recognizers Cherry ships, keyed by the catalog's runtime architecture. */
export type SherpaAsrModelPaths =
  | ({ kind: 'funasr-nano' } & FunAsrModelPaths)
  | {
      kind: 'nemo-transducer'
      encoder: string
      decoder: string
      joiner: string
      tokens: string
      voiceActivityDetector: string
    }

export type AsrTranscribeSource =
  | { kind: 'wav'; filePath: string }
  | { kind: 'samples'; samples: Float32Array; sampleRate: number }

export type AsrModelConfig =
  | { engine: typeof AsrEngine.Sherpa; modelPaths: SherpaAsrModelPaths }
  | { engine: typeof AsrEngine.Mlx; modelDir: string }

export type AsrTranscribePayload =
  | { engine: typeof AsrEngine.Sherpa; modelPaths: SherpaAsrModelPaths; source: AsrTranscribeSource }
  | { engine: typeof AsrEngine.Mlx; modelDir: string; source: Extract<AsrTranscribeSource, { kind: 'samples' }> }

export interface AsrSegment {
  text: string
  start: number
  end: number
}
