import path from 'node:path'

import { describe, expect, it } from 'vitest'

import { mediaFfmpegProcess } from '../mediaFfmpegProcess'

describe('mediaFfmpegProcess runtime paths', () => {
  it('resolves ffmpeg and ffprobe from the immutable packaged binary directory', () => {
    const platformKey = `${process.platform}-${process.arch}`
    const root = path.join('/mock/app.root.resources.binaries', platformKey)
    if (process.platform === 'linux') {
      expect(mediaFfmpegProcess.createInitData?.()).toEqual({
        ffmpegPath: path.join(root, 'ffmpeg', 'bin', 'ffmpeg'),
        ffprobePath: path.join(root, 'ffmpeg', 'bin', 'ffprobe'),
        linuxLibraryDir: path.join(root, 'ffmpeg', 'lib')
      })
      return
    }

    const executable = (name: string) => (process.platform === 'win32' ? `${name}.exe` : name)
    expect(mediaFfmpegProcess.createInitData?.()).toEqual({
      ffmpegPath: path.join(root, executable('ffmpeg')),
      ffprobePath: path.join(root, executable('ffprobe'))
    })
  })
})
