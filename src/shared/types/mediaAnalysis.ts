/**
 * Structured result of AV hybrid preprocessing. Cached and returned by
 * `read_file`; chat/agent receive a compact text projection of the same value.
 */
export const MEDIA_ANALYSIS_VERSION = 1 as const

export const MEDIA_PIPELINE_VERSION = 1 as const

export interface MediaAnalysisSource {
  mime: string
  durationMs: number
  hasAudio: boolean
  hasVideo: boolean
}

export interface MediaAudioSegment {
  startMs: number
  endMs: number
  speaker?: string
  text: string
}

export interface MediaVisualFrame {
  timestampMs: number
  summary?: string
  ocrText?: string
}

export interface MediaAnalysis {
  version: typeof MEDIA_ANALYSIS_VERSION
  source: MediaAnalysisSource
  audio?: {
    segments: MediaAudioSegment[]
  }
  visuals?: MediaVisualFrame[]
  warnings: string[]
}

export interface MediaFrameBudget {
  /** Hard cap on sampled frames for a single analysis. */
  maxFrames: number
  /** Preferred sampling interval; lengthened when maxFrames would be exceeded. */
  targetIntervalMs: number
  /** Max long edge for extracted frame images (pixels). */
  maxEdgePx: number
  /** JPEG quality 1–100 for extracted frames. */
  jpegQuality: number
}

export const DEFAULT_MEDIA_FRAME_BUDGET: Readonly<MediaFrameBudget> = {
  maxFrames: 24,
  targetIntervalMs: 4_000,
  maxEdgePx: 1280,
  jpegQuality: 75
}
