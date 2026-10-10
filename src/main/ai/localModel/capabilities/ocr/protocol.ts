/**
 * Text-recognition payloads shared by the main process and the inference utility process.
 */

/** Absolute paths to the PaddleOCR model files (installed by the main process). */
export interface OcrModelPaths {
  detection: string
  recognition: string
  charactersDictionary: string
}

/** One recognized text run with its box in the source image's pixel space. */
export interface OcrLine {
  text: string
  box: { x: number; y: number; width: number; height: number }
  confidence: number
}

/**
 * Where the image comes from. A discriminated union, not two optional fields:
 * the latter would let `{}` and `{ imagePath, imageBytes }` typecheck, pushing
 * the "exactly one" rule into a runtime check nobody remembers to write.
 */
export type OcrRecognizeSource = { kind: 'path'; imagePath: string } | { kind: 'bytes'; imageBytes: Uint8Array }

/** Recognize text in an image; `bytes` exists so in-memory captures never touch disk. */
export interface OcrRecognizePayload {
  modelPaths: OcrModelPaths
  source: OcrRecognizeSource
}
