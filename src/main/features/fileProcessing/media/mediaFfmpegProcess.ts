import path from 'node:path'

import { application } from '@application'
import { defineUtilityProcess } from '@main/core/utilityProcess/defineUtilityProcess'
import type { UtilityProcessMethod } from '@main/core/utilityProcess/types'
import type { ClassifiedMediaProbe } from '@main/features/fileProcessing/media/probeClassification'
import { toAsarUnpackedPath } from '@main/utils/asar'
import { getBinaryName } from '@main/utils/binaryResolver'

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
  // The packaged tree is immutable. cherry.bin is filled later by Background extraction.
  createInitData: () => {
    if (process.platform === 'linux') {
      return {
        ffmpegPath: toAsarUnpackedPath(application.getPath('feature.file_processing.ffmpeg.bin', 'ffmpeg')),
        ffprobePath: toAsarUnpackedPath(application.getPath('feature.file_processing.ffmpeg.bin', 'ffprobe')),
        linuxLibraryDir: toAsarUnpackedPath(application.getPath('feature.file_processing.ffmpeg.lib'))
      }
    }
    return {
      ffmpegPath: packagedMediaBinary('ffmpeg'),
      ffprobePath: packagedMediaBinary('ffprobe')
    }
  }
})

function packagedPlatformDir(): string {
  return path.join(application.getPath('app.root.resources.binaries'), `${process.platform}-${process.arch}`)
}

function packagedMediaBinary(name: string): string {
  return toAsarUnpackedPath(path.join(packagedPlatformDir(), getBinaryName(name)))
}
