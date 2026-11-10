import path from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { getBinaryName } from '@main/utils/binaryResolver'

import { mediaFfmpegProcess } from '../mediaFfmpegProcess'

const originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform')!

afterEach(() => {
  Object.defineProperty(process, 'platform', originalPlatform)
})

describe('mediaFfmpegProcess runtime paths', () => {
  it('resolves Darwin and Windows executables from the immutable packaged binary directory', () => {
    Object.defineProperty(process, 'platform', { value: 'darwin' })
    const bundled = (name: string) =>
      path.resolve('/mock', 'app.root.resources.binaries', `darwin-${process.arch}`, getBinaryName(name))

    expect(mediaFfmpegProcess.createInitData?.()).toEqual({
      ffmpegPath: bundled('ffmpeg'),
      ffprobePath: bundled('ffprobe')
    })
  })

  it('resolves the Linux LGPL tree and its library directory from the packaged registry paths', () => {
    Object.defineProperty(process, 'platform', { value: 'linux' })

    expect(mediaFfmpegProcess.createInitData?.()).toEqual({
      ffmpegPath: path.resolve('/mock', 'feature.file_processing.ffmpeg.bin', 'ffmpeg'),
      ffprobePath: path.resolve('/mock', 'feature.file_processing.ffmpeg.bin', 'ffprobe'),
      linuxLibraryDir: path.resolve('/mock', 'feature.file_processing.ffmpeg.lib')
    })
  })
})
