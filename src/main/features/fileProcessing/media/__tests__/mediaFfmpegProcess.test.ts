import path from 'node:path'

import { describe, expect, it } from 'vitest'

import { getBinaryName } from '@main/utils/binaryResolver'

import { mediaFfmpegProcess } from '../mediaFfmpegProcess'

describe('mediaFfmpegProcess runtime paths', () => {
  it('resolves ffmpeg and ffprobe from the immutable packaged binary directory', () => {
    const bundled = (name: string) =>
      path.resolve('/mock', 'app.root.resources.binaries', `${process.platform}-${process.arch}`, getBinaryName(name))

    expect(mediaFfmpegProcess.createInitData?.()).toEqual({
      ffmpegPath: bundled('ffmpeg'),
      ffprobePath: bundled('ffprobe')
    })
  })
})
