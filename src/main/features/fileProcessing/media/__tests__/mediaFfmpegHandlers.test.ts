import { spawnSync } from 'node:child_process'
import type * as NodeChildProcess from 'node:child_process'
import { EventEmitter } from 'node:events'
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const spawnControl = vi.hoisted(() => ({
  calls: 0,
  replacement: null as null | ((...args: unknown[]) => unknown)
}))

vi.mock('node:child_process', async () => {
  const actual = await vi.importActual<typeof NodeChildProcess>('node:child_process')
  return {
    ...actual,
    spawn: (...args: Parameters<typeof actual.spawn>) => {
      if (spawnControl.replacement) {
        spawnControl.calls += 1
        return spawnControl.replacement(...args) as ReturnType<typeof actual.spawn>
      }
      return actual.spawn(...args)
    }
  }
})

import type { UtilityProcessHandlerContext } from '@main/core/utilityProcess/runtime/serveUtilityProcess'

import {
  applyMediaFfmpegInitData,
  disposeMediaChildren,
  mediaFfmpegHandlers
} from '../utilityEntries/mediaFfmpegHandlers'

const bundleDir = join(process.cwd(), 'resources', 'binaries', `${process.platform}-${process.arch}`)
const ffmpegPath = join(bundleDir, process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg')
const ffprobePath = join(bundleDir, process.platform === 'win32' ? 'ffprobe.exe' : 'ffprobe')
const hasBundledFfmpeg = existsSync(ffmpegPath) && existsSync(ffprobePath)

const logger = { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} }
const context = (signal = new AbortController().signal): UtilityProcessHandlerContext<never> => ({
  signal,
  logger,
  emit: () => {},
  callHost: async () => {
    throw new Error('Media FFmpeg handlers do not call the host')
  }
})

describe.skipIf(!hasBundledFfmpeg)('mediaFfmpegHandlers', () => {
  let root: string
  let tonePath: string
  let metadataTonePath: string
  let webmPath: string
  let videoPath: string
  let transportStreamPath: string

  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), 'cherry-media-ffmpeg-test-'))
    tonePath = join(root, 'tone.wav')
    metadataTonePath = join(root, 'metadata-tone.wav')
    webmPath = join(root, 'tone.webm')
    videoPath = join(root, 'portrait.mp4')
    transportStreamPath = join(root, 'tail.ts')
    expect(
      runFfmpeg(['-f', 'lavfi', '-i', 'sine=frequency=440:duration=3', '-ac', '1', '-ar', '48000', tonePath])
    ).toBe(0)
    expect(
      runFfmpeg([
        '-f',
        'lavfi',
        '-i',
        'sine=frequency=440:duration=3',
        '-metadata',
        `comment=${'x'.repeat(10_000)}`,
        '-ac',
        '1',
        '-ar',
        '48000',
        metadataTonePath
      ])
    ).toBe(0)
    expect(
      runFfmpeg(['-f', 'lavfi', '-i', 'sine=frequency=660:duration=1', '-strict', '-2', '-c:a', 'opus', webmPath])
    ).toBe(0)
    expect(
      runFfmpeg([
        '-f',
        'lavfi',
        '-i',
        'testsrc2=size=240x320:rate=10:duration=2',
        '-f',
        'lavfi',
        '-i',
        'sine=frequency=880:duration=2',
        '-c:v',
        'mpeg4',
        '-c:a',
        'aac',
        '-shortest',
        videoPath
      ])
    ).toBe(0)
    expect(
      runFfmpeg([
        '-f',
        'lavfi',
        '-i',
        'testsrc2=size=160x120:rate=12:duration=6',
        '-c:v',
        'mpeg2video',
        '-f',
        'mpegts',
        transportStreamPath
      ])
    ).toBe(0)
  })

  beforeEach(() => {
    applyMediaFfmpegInitData({ ffmpegPath, ffprobePath })
  })

  afterEach(() => {
    disposeMediaChildren()
  })

  afterAll(() => {
    rmSync(root, { recursive: true, force: true })
  })

  it('probes audio and splits normalized WAV output below the requested byte limit', async () => {
    const probe = await mediaFfmpegHandlers.probe({ filePath: tonePath, fallbackExt: 'wav' }, context())
    expect(probe).toMatchObject({ hasAudio: true, hasVideo: false, mime: 'audio/wav', kind: 'audio' })
    expect(probe.durationMs).toBeGreaterThanOrEqual(2_900)

    const outputDir = join(root, 'audio-chunks')
    const result = await mediaFfmpegHandlers.extractAudio(
      { filePath: tonePath, outputDir, maxChunkBytes: 10_000 },
      context()
    )
    expect(result.chunks.length).toBeGreaterThan(1)
    expect(result.chunks.every((chunk) => chunk.byteLength <= 10_000)).toBe(true)
    expect(result.chunks.map((chunk) => chunk.startMs)).toEqual(
      [...result.chunks.map((chunk) => chunk.startMs)].sort((a, b) => a - b)
    )
    expect(result).toMatchObject({ sampleRateHz: 16000, channels: 1 })
  })

  it('strips oversized source metadata before enforcing the WAV chunk limit', async () => {
    const result = await mediaFfmpegHandlers.extractAudio(
      { filePath: metadataTonePath, outputDir: join(root, 'metadata-chunks'), maxChunkBytes: 10_000 },
      context()
    )

    expect(result.chunks.length).toBeGreaterThan(1)
    expect(result.chunks.every((chunk) => chunk.byteLength <= 10_000)).toBe(true)
  })

  it('distinguishes audio-only WebM and extracts bounded portrait video frames', async () => {
    await expect(
      mediaFfmpegHandlers.probe({ filePath: webmPath, fallbackExt: 'webm' }, context())
    ).resolves.toMatchObject({
      hasAudio: true,
      hasVideo: false,
      mime: 'audio/webm',
      kind: 'audio'
    })
    await expect(
      mediaFfmpegHandlers.probe({ filePath: videoPath, fallbackExt: 'mp4' }, context())
    ).resolves.toMatchObject({
      hasAudio: true,
      hasVideo: true,
      mime: 'video/mp4',
      kind: 'video'
    })

    const frames = await mediaFfmpegHandlers.extractFrames(
      {
        filePath: videoPath,
        outputDir: join(root, 'frames'),
        timestampsMs: [0, 1_000],
        maxEdgePx: 120,
        jpegQuality: 70
      },
      context()
    )
    expect(frames.frames.map((frame) => frame.timestampMs)).toEqual([0, 1_000])
    for (const frame of frames.frames) {
      const dimensions = JSON.parse(
        spawnSync(ffprobePath, ['-v', 'error', '-show_entries', 'stream=width,height', '-of', 'json', frame.path], {
          encoding: 'utf8'
        }).stdout
      ).streams[0]
      expect(Math.max(dimensions.width, dimensions.height)).toBeLessThanOrEqual(120)
    }
  })

  it('kills an active FFmpeg child before rejecting cancellation', async () => {
    const outputDir = join(root, 'cancelled-frames')
    const pidRegistryPath = join(root, 'cancelled-child.pid')
    mkdirSync(outputDir, { recursive: true })
    const controller = new AbortController()
    const pending = mediaFfmpegHandlers.extractFrames(
      {
        filePath: videoPath,
        outputDir,
        timestampsMs: Array.from({ length: 80 }, (_, index) => index * 20),
        maxEdgePx: 240,
        jpegQuality: 80,
        pidRegistryPath
      },
      context(controller.signal)
    )
    await waitForFile(pidRegistryPath)
    const reason = new Error('cancel media extraction')
    controller.abort(reason)

    await expect(pending).rejects.toBe(reason)
    expect(existsSync(pidRegistryPath)).toBe(false)
  })

  it('recovers a decodable MPEG-TS end frame with output-side seeking', async () => {
    const result = await mediaFfmpegHandlers.extractFrames(
      {
        filePath: transportStreamPath,
        outputDir: join(root, 'transport-stream-frames'),
        timestampsMs: [5_950],
        maxEdgePx: 240,
        jpegQuality: 80
      },
      context()
    )

    expect(result.frames.map((frame) => frame.timestampMs)).toEqual([5_950])
  })

  function runFfmpeg(args: string[]): number | null {
    return spawnSync(ffmpegPath, ['-hide_banner', '-nostdin', '-y', ...args], { encoding: 'utf8' }).status
  }
})

describe('mediaFfmpegHandlers frame destinations', () => {
  afterEach(() => {
    spawnControl.replacement = null
    spawnControl.calls = 0
    disposeMediaChildren()
  })

  it('does not return an old JPEG when a reused destination produces no new image', async () => {
    const outputDir = mkdtempSync(join(tmpdir(), 'cherry-media-stale-frame-'))
    const stalePath = join(outputDir, 'frame-0000.jpg')
    const untouchedPath = join(outputDir, 'frame-0001.jpg')
    writeFileSync(stalePath, 'old-frame')
    writeFileSync(untouchedPath, 'leave-me')
    applyMediaFfmpegInitData({ ffmpegPath: '/usr/bin/false', ffprobePath: '/usr/bin/false' })
    spawnControl.replacement = () => {
      const stream = () => Object.assign(new EventEmitter(), { setEncoding: () => {} })
      const child = Object.assign(new EventEmitter(), { pid: 424242, stdout: stream(), stderr: stream() })
      queueMicrotask(() => child.emit('close', 0))
      return child
    }

    try {
      const result = await mediaFfmpegHandlers.extractFrames(
        {
          filePath: '/video.mp4',
          outputDir,
          timestampsMs: [99_000],
          maxEdgePx: 120,
          jpegQuality: 70
        },
        context()
      )

      expect(spawnControl.calls).toBe(1)
      expect(result.frames).toEqual([])
      expect(readFileSync(untouchedPath, 'utf8')).toBe('leave-me')
    } finally {
      rmSync(outputDir, { recursive: true, force: true })
    }
  })

  it('keeps a later frame when an earlier seek exits without an image', async () => {
    const outputDir = mkdtempSync(join(tmpdir(), 'cherry-media-partial-frame-'))
    applyMediaFfmpegInitData({ ffmpegPath: '/usr/bin/false', ffprobePath: '/usr/bin/false' })
    spawnControl.replacement = () => {
      const call = spawnControl.calls
      const stream = () => Object.assign(new EventEmitter(), { setEncoding: () => {} })
      const child = Object.assign(new EventEmitter(), { pid: 424242, stdout: stream(), stderr: stream() })
      queueMicrotask(() => {
        if (call === 1) {
          child.emit('close', 234)
          return
        }
        writeFileSync(join(outputDir, 'frame-0001.jpg'), 'later-frame')
        child.emit('close', 0)
      })
      return child
    }

    try {
      const result = await mediaFfmpegHandlers.extractFrames(
        {
          filePath: '/video.mp4',
          outputDir,
          timestampsMs: [99_000, 1_000],
          maxEdgePx: 120,
          jpegQuality: 70
        },
        context()
      )

      expect(spawnControl.calls).toBe(2)
      expect(result.frames).toEqual([{ path: join(outputDir, 'frame-0001.jpg'), timestampMs: 1_000 }])
    } finally {
      rmSync(outputDir, { recursive: true, force: true })
    }
  })

  it('rejects when the media executable cannot start', async () => {
    const outputDir = mkdtempSync(join(tmpdir(), 'cherry-media-missing-ffmpeg-'))
    applyMediaFfmpegInitData({ ffmpegPath: '/missing/ffmpeg', ffprobePath: '/missing/ffprobe' })
    spawnControl.replacement = () => {
      const stream = () => Object.assign(new EventEmitter(), { setEncoding: () => {} })
      const child = Object.assign(new EventEmitter(), { pid: 424242, stdout: stream(), stderr: stream() })
      queueMicrotask(() => {
        child.emit('error', Object.assign(new Error('spawn /missing/ffmpeg ENOENT'), { code: 'ENOENT' }))
      })
      return child
    }

    try {
      await expect(
        mediaFfmpegHandlers.extractFrames(
          {
            filePath: '/video.mp4',
            outputDir,
            timestampsMs: [0, 1_000],
            maxEdgePx: 120,
            jpegQuality: 70
          },
          context()
        )
      ).rejects.toThrow('ENOENT')
      expect(spawnControl.calls).toBe(1)
    } finally {
      rmSync(outputDir, { recursive: true, force: true })
    }
  })
})

async function waitForFile(filePath: string): Promise<void> {
  const deadline = Date.now() + 5_000
  while (!existsSync(filePath)) {
    if (Date.now() >= deadline) throw new Error(`Timed out waiting for ${filePath}`)
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
}
