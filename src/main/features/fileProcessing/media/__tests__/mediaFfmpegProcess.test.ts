import path from 'node:path'

import { describe, expect, it } from 'vitest'

import { mediaFfmpegProcess } from '../mediaFfmpegProcess'

describe('mediaFfmpegProcess runtime paths', () => {
  it('resolves ffmpeg and ffprobe from the immutable packaged binary directory', () => {
    const platformKey = `${process.platform}-${process.arch}`
    const root = path.join('/mock/app.root.resources.binaries', platformKey)
    if (process.platform === 'linux') {
      expect(mediaFfmpegProcess.createInitData?.()).toEqual({
        ffmpegPath: '/mock/feature.file_processing.ffmpeg.bin/ffmpeg',
        ffprobePath: '/mock/feature.file_processing.ffmpeg.bin/ffprobe',
        linuxLibraryDir: '/mock/feature.file_processing.ffmpeg.lib'
      })
      return
    }

    const executable = (name: string) => (process.platform === 'win32' ? `${name}.exe` : name)
    expect(mediaFfmpegProcess.createInitData?.()).toEqual({
      ffmpegPath: path.join(root, executable('ffmpeg')),
      ffprobePath: path.join(root, executable('ffprobe'))
    })
  })

  it('resolves the Linux FFmpeg tree through the registered packaged directories', () => {
    const original = Object.getOwnPropertyDescriptor(process, 'platform')
    Object.defineProperty(process, 'platform', { value: 'linux' })
    try {
      expect(mediaFfmpegProcess.createInitData?.()).toEqual({
        ffmpegPath: '/mock/feature.file_processing.ffmpeg.bin/ffmpeg',
        ffprobePath: '/mock/feature.file_processing.ffmpeg.bin/ffprobe',
        linuxLibraryDir: '/mock/feature.file_processing.ffmpeg.lib'
      })
    } finally {
      if (original) Object.defineProperty(process, 'platform', original)
    }
  })
})
