export interface AsrModelPaths {
  encoder: string
  llm: string
  embedding: string
  tokenizerDir: string
  voiceActivityDetector: string
}

export type AsrTranscribeSource =
  | { kind: 'wav'; filePath: string }
  | { kind: 'samples'; samples: Float32Array; sampleRate: number }

export interface AsrTranscribePayload {
  modelPaths: AsrModelPaths
  source: AsrTranscribeSource
}

export interface AsrSegment {
  text: string
  start: number
  end: number
}
