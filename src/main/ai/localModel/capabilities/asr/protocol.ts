/**
 * Speech-recognition requests (Fun-ASR-Nano via sherpa-onnx) and what they answer with.
 * Implemented by the ASR utility-process handler.
 */

/** Absolute paths to the speech model files (installed by the main process). */
export interface AsrModelPaths {
  encoder: string
  llm: string
  embedding: string
  /** Directory, not a file: sherpa-onnx reads the three Qwen3 tokenizer files itself. */
  tokenizerDir: string
  voiceActivityDetector: string
}

/**
 * Where the audio comes from. A discriminated union, not two optional fields: the latter
 * would let `{}` and a both-populated object typecheck, pushing the "exactly one" rule
 * into a runtime check nobody remembers to write.
 *
 * `wav` is read by sherpa-onnx itself and must be PCM WAV; anything else — a recording
 * held in memory, or audio decoded from a compressed container — arrives as `samples`,
 * mono in [-1, 1], resampled to 16kHz in the utility process when needed.
 */
export type AsrTranscribeSource =
  | { kind: 'wav'; filePath: string }
  | { kind: 'samples'; samples: Float32Array; sampleRate: number }

export interface AsrTranscribePayload {
  modelPaths: AsrModelPaths
  source: AsrTranscribeSource
}

/** One stretch of speech, with its position in the source audio in seconds. */
export interface AsrSegment {
  text: string
  start: number
  end: number
}
