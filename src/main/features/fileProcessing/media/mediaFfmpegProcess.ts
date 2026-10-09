import path from 'node:path'

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

export type MediaFfmpegContract = {
  methods: {
    probe: UtilityProcessMethod<MediaProbeInput, ClassifiedMediaProbe>
    extractAudio: UtilityProcessMethod<MediaExtractAudioInput, MediaExtractAudioResult>
    extractFrames: UtilityProcessMethod<MediaExtractFramesInput, MediaExtractFramesResult>
  }
}

export const mediaFfmpegProcess = defineUtilityProcess<MediaFfmpegContract, MediaFfmpegInitData>({
  id: 'media.ffmpeg',
  entry: 'media-ffmpeg',
  cancellation: 'cooperative',
  idleTimeoutMs: 5 * 60 * 1000,
  createInitData: () => {
    const binDir = application.getPath('cherry.bin')
    const executable = (name: 'ffmpeg' | 'ffprobe') => {
      if (process.platform === 'linux') return path.join(binDir, 'ffmpeg', 'bin', name)
      return path.join(binDir, process.platform === 'win32' ? `${name}.exe` : name)
    }
    return {
      ffmpegPath: executable('ffmpeg'),
      ffprobePath: executable('ffprobe'),
      ...(process.platform === 'linux' ? { linuxLibraryDir: path.join(binDir, 'ffmpeg', 'lib') } : {})
    }
  }
})
