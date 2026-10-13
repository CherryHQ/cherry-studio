import { application } from '@application'
import { defineUtilityProcess } from '@main/core/utilityProcess/defineUtilityProcess'
import type { UtilityProcessMethod } from '@main/core/utilityProcess/types'
import type { ClassifiedMediaProbe } from '@main/features/fileProcessing/media/probeClassification'

export interface MediaFfmpegInitData {
  ffmpegPath: string
  ffprobePath: string
  /** Bundled Linux `ffmpeg/lib`. Absent on Darwin and Windows. */
  linuxLibraryDir?: string
}

export interface MediaProbeInput {
  filePath: string
  fallbackExt?: string
  pidRegistryPath?: string
}

export interface MediaExtractAudioInput {
  filePath: string
  outputDir: string
  maxChunkBytes: number
  pidRegistryPath?: string
}

export interface MediaExtractedAudioChunk {
  path: string
  startMs: number
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

export interface MediaExtractFramesResult {
  frames: Array<{ path: string; timestampMs: number }>
}

export interface MediaDetectSceneChangesInput {
  filePath: string
  durationMs: number
  sampleFps: number
  scoreThreshold: number
  scanEdgePx: number
  maxCandidates: number
  pidRegistryPath?: string
}

export interface MediaSceneChange {
  timestampMs: number
  score: number
}

export interface MediaDetectSceneChangesResult {
  changes: MediaSceneChange[]
}

export type MediaFfmpegContract = {
  methods: {
    probe: UtilityProcessMethod<MediaProbeInput, ClassifiedMediaProbe>
    extractAudio: UtilityProcessMethod<MediaExtractAudioInput, MediaExtractAudioResult>
    extractFrames: UtilityProcessMethod<MediaExtractFramesInput, MediaExtractFramesResult>
    detectSceneChanges: UtilityProcessMethod<MediaDetectSceneChangesInput, MediaDetectSceneChangesResult>
  }
}

export const mediaFfmpegProcess = defineUtilityProcess<MediaFfmpegContract, MediaFfmpegInitData>({
  id: 'media.ffmpeg',
  entry: 'media-ffmpeg',
  cancellation: 'cooperative',
  idleTimeoutMs: 5 * 60 * 1000,
  createInitData: () => {
    if (process.platform === 'linux') {
      return {
        ffmpegPath: application.getPath('cherry.bin.ffmpeg.bin', 'ffmpeg'),
        ffprobePath: application.getPath('cherry.bin.ffmpeg.bin', 'ffprobe'),
        linuxLibraryDir: application.getPath('cherry.bin.ffmpeg.lib')
      }
    }
    const suffix = process.platform === 'win32' ? '.exe' : ''
    return {
      ffmpegPath: application.getPath('cherry.bin', `ffmpeg${suffix}`),
      ffprobePath: application.getPath('cherry.bin', `ffprobe${suffix}`)
    }
  }
})
