import { mkdirSync } from 'node:fs'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { applyMediaInitData, disposeMediaChildren, mediaFfmpegHandlers } from '../utilityEntries/mediaFfmpegHandlers'

const binDir = join(process.cwd(), 'resources/binaries', `${process.platform}-${process.arch}`)
const ffmpegPath = join(binDir, process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg')
const ffprobePath = join(binDir, process.platform === 'win32' ? 'ffprobe.exe' : 'ffprobe')
const hasBundled = require('node:fs').existsSync(ffmpegPath)

describe.skipIf(!hasBundled)('mediaFfmpegHandlers cancellation', () => {
  afterEach(() => {
    disposeMediaChildren()
  })

  it('rejects aborted probes only after the child has exited', async () => {
    applyMediaInitData({ ffmpegPath, ffprobePath, tempRoot: '/tmp/av-smoke' })
    const logger = { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} }
    const controller = new AbortController()
    const ctx = { signal: controller.signal, logger, emit: () => {} }
    const portrait = join(process.cwd(), '.context/av-verify.n73qfg/portrait.mp4')

    mkdirSync('/tmp/av-smoke/cancel-frames', { recursive: true })
    const pending = mediaFfmpegHandlers.extractFrames(
      {
        filePath: portrait,
        outputDir: '/tmp/av-smoke/cancel-frames',
        timestampsMs: [0, 200, 400, 600, 800, 1000],
        maxEdgePx: 320,
        jpegQuality: 50
      },
      ctx
    )
    controller.abort(new Error('cancel-test'))
    await expect(pending).rejects.toThrow(/cancel-test|Aborted/)
  })
})
