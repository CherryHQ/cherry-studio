import path from 'node:path'

import { describe, expect, it } from 'vitest'

import { mediaFfmpegProcess } from '../mediaFfmpegProcess'

describe('mediaFfmpegProcess runtime paths', () => {
  it('resolves ffmpeg and ffprobe from the immutable packaged binary directory', () => {
    const platformKey = `${process.platform}-${process.arch}`
    const executable = (name: string) => (process.platform === 'win32' ? `${name}.exe` : name)
    const bundled = (name: string) => path.join('/mock/app.root.resources.binaries', platformKey, executable(name))

    expect(mediaFfmpegProcess.createInitData?.()).toEqual({
      ffmpegPath: bundled('ffmpeg'),
      ffprobePath: bundled('ffprobe')
    })
  })
})
