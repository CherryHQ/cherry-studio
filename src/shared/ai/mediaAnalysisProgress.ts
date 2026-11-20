/** Live stage of an audio/video analysis, shown while Chat prepares an attachment. */
export type MediaAnalysisStage = 'transcribing' | 'reading_frames' | 'describing_frames'

export interface MediaAnalysisProgress {
  stage: MediaAnalysisStage
  /** Frames finished so far; set for the per-frame stages. */
  done?: number
  total?: number
}
