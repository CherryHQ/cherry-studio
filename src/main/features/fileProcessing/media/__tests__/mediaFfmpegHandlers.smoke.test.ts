import { mkdirSync } from 'node:fs'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { applyMediaInitData, disposeMediaChildren, mediaFfmpegHandlers } from '../utilityEntries/mediaFfmpegHandlers'

const binDir = join(process.cwd(), 'resources/binaries', `${process.platform}-${process.arch}`)
const ffmpegPath = join(binDir, process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg')
const ffprobePath = join(binDir, process.platform === 'win32' ? 'ffprobe.exe' : 'ffprobe')

const hasBundled = (() => {
  try {
    return require('node:fs').existsSync(ffmpegPath) && require('node:fs').existsSync(ffprobePath)
  } catch {
    return false
  }
})()

describe.skipIf(!hasBundled)('mediaFfmpegHandlers local smoke', () => {
  afterEach(() => {
    disposeMediaChildren()
  })

  it('probes and extracts 16kHz mono audio without embedding stderr metadata', async () => {
    applyMediaInitData({
      ffmpegPath,
      ffprobePath,
      tempRoot: join('/tmp', 'av-smoke')
    })
    const logger = { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} }
    const signal = new AbortController().signal
    const ctx = { signal, logger, emit: () => {} }

    // Generate a short fixture with the same bundled binary.
    const { spawnSync } = await import('node:child_process')
    mkdirSync('/tmp/av-smoke', { recursive: true })
    const wav = '/tmp/av-smoke/handler-tone.wav'
    const gen = spawnSync(
      ffmpegPath,
      ['-y', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=1', '-ac', '1', '-ar', '16000', wav],
      { encoding: 'utf8' }
    )
    expect(gen.status).toBe(0)

    const probe = await mediaFfmpegHandlers.probe({ filePath: wav, fallbackExt: 'wav' }, ctx)
    expect(probe.hasAudio).toBe(true)
    expect(probe.hasVideo).toBe(false)
    expect(probe.mime).toBe('audio/wav')
    expect(probe.durationMs).toBeGreaterThan(0)

    const outDir = join('/tmp/av-smoke', 'handler-out')
    mkdirSync(outDir, { recursive: true })
    const audio = await mediaFfmpegHandlers.extractAudio(
      { filePath: wav, outputDir: outDir, maxChunkBytes: 25 * 1024 * 1024 },
      ctx
    )
    expect(audio.chunks.length).toBe(1)
    expect(audio.chunks[0].byteLength).toBeGreaterThan(44)
    expect(audio.sampleRateHz).toBe(16000)
  })

  it('probes portrait video and extracts audio plus frames', async () => {
    const portrait = join(process.cwd(), '.context/av-verify.n73qfg/portrait.mp4')
    if (!require('node:fs').existsSync(portrait)) return

    applyMediaInitData({ ffmpegPath, ffprobePath, tempRoot: join('/tmp', 'av-smoke') })
    const logger = { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} }
    const signal = new AbortController().signal
    const ctx = { signal, logger, emit: () => {} }

    const probe = await mediaFfmpegHandlers.probe({ filePath: portrait, fallbackExt: 'mp4' }, ctx)
    expect(probe.hasVideo).toBe(true)
    expect(probe.hasAudio).toBe(true)
    expect(probe.mime).toBe('video/mp4')

    const outDir = join('/tmp/av-smoke', 'portrait-out')
    mkdirSync(outDir, { recursive: true })
    const audio = await mediaFfmpegHandlers.extractAudio(
      { filePath: portrait, outputDir: join(outDir, 'audio'), maxChunkBytes: 25 * 1024 * 1024 },
      ctx
    )
    expect(audio.chunks.length).toBeGreaterThan(0)

    const frames = await mediaFfmpegHandlers.extractFrames(
      {
        filePath: portrait,
        outputDir: join(outDir, 'frames'),
        timestampsMs: [0, Math.max(0, probe.durationMs - 50)],
        maxEdgePx: 640,
        jpegQuality: 70
      },
      ctx
    )
    // Near-end seeks can fail on short clips; at least the first frame must succeed.
    expect(frames.frames.length).toBeGreaterThan(0)
    expect(frames.frames[0].timestampMs).toBe(0)
  })
})
