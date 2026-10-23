export const MEDIA_ANALYSIS_VERSION = 1 as const
export const MEDIA_PIPELINE_VERSION = 2 as const

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

export const MEDIA_ANALYSIS_WARNING_CODES = [
  'audio_transcription_failed',
  'no_speech',
  'ocr_failed',
  'vision_model_unavailable',
  'vision_failed',
  'visual_analysis_failed',
  'no_visual_content'
] as const

export type MediaAnalysisWarningCode = (typeof MEDIA_ANALYSIS_WARNING_CODES)[number]

export interface MediaAnalysis {
  version: typeof MEDIA_ANALYSIS_VERSION
  source: MediaAnalysisSource
  audio?: { segments: MediaAudioSegment[] }
  visuals?: MediaVisualFrame[]
  warnings: MediaAnalysisWarningCode[]
}

export interface MediaFrameBudget {
  maxFrames: number
  targetIntervalMs: number
  maxEdgePx: number
  jpegQuality: number
}

export const DEFAULT_MEDIA_FRAME_BUDGET: Readonly<MediaFrameBudget> = {
  maxFrames: 24,
  targetIntervalMs: 4_000,
  maxEdgePx: 1280,
  jpegQuality: 75
}
