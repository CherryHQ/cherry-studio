import { application } from '@application'
import { defineUtilityProcess } from '@main/core/utilityProcess/defineUtilityProcess'
import type { UtilityProcessMethod } from '@main/core/utilityProcess/types'
import type { ClassifiedMediaProbe } from '@main/features/fileProcessing/media/probeClassification'

export interface MediaProcessInitData {
  ffmpegPath: string
  ffprobePath: string
  tempRoot: string
}

export interface MediaProbeInput {
  filePath: string
  fallbackExt?: string
  /** Optional path where live child PIDs are appended for main-side crash cleanup. */
  pidRegistryPath?: string
}

export interface MediaExtractAudioInput {
  filePath: string
  /** Output directory owned by this job; created by the caller. */
  outputDir: string
  /** Max bytes per chunk (OpenAI transcription limit is 25,000,000). */
  maxChunkBytes: number
  pidRegistryPath?: string
}

export interface MediaExtractedAudioChunk {
  path: string
  startMs: number
  /** Approximate end; last chunk may be shorter. */
  endMs: number
  byteLength: number
}

export interface MediaExtractAudioResult {
  chunks: MediaExtractedAudioChunk[]
  sampleRateHz: 16000
  channels: 1
}

export interface MediaExtractFramesInput {
  filePath: string
  outputDir: string
  timestampsMs: number[]
  maxEdgePx: number
  jpegQuality: number
  pidRegistryPath?: string
}

export interface MediaExtractedFrame {
  path: string
  timestampMs: number
}

export interface MediaExtractFramesResult {
  frames: MediaExtractedFrame[]
}

export type MediaFfmpegContract = {
  methods: {
    probe: UtilityProcessMethod<MediaProbeInput, ClassifiedMediaProbe>
    extractAudio: UtilityProcessMethod<MediaExtractAudioInput, MediaExtractAudioResult>
    extractFrames: UtilityProcessMethod<MediaExtractFramesInput, MediaExtractFramesResult>
  }
}

const MEDIA_IDLE_TIMEOUT_MS = 5 * 60 * 1000

export const mediaFfmpegProcess = defineUtilityProcess<MediaFfmpegContract, MediaProcessInitData>({
  id: 'media.ffmpeg',
  entry: 'media-ffmpeg',
  // Cooperative so handlers can kill FFmpeg process groups before the request
  // rejects; terminate would orphan grandchildren without an exit barrier.
  cancellation: 'cooperative',
  idleTimeoutMs: MEDIA_IDLE_TIMEOUT_MS,
  createInitData: () => {
    const bin = (name: string) => application.getPath('cherry.bin', process.platform === 'win32' ? `${name}.exe` : name)
    return {
      ffmpegPath: bin('ffmpeg'),
      ffprobePath: bin('ffprobe'),
      tempRoot: application.getPath('app.temp')
    }
  }
})
