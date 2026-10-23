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

  it('returns the last decodable frame when the end anchor is past its PTS', async () => {
    const sparsePath = join(root, 'sparse-12fps.mp4')
    expect(
      runFfmpeg(['-f', 'lavfi', '-i', 'color=c=red:s=64x64:r=12:d=6', '-c:v', 'mpeg4', '-q:v', '8', sparsePath])
    ).toBe(0)
    const probe = await mediaFfmpegHandlers.probe({ filePath: sparsePath, fallbackExt: 'mp4' }, context())
    const endAnchorMs = probe.durationMs - 50
    const rawSeek = spawnSync(
      ffmpegPath,
      [
        '-hide_banner',
        '-nostdin',
        '-y',
        '-ss',
        (endAnchorMs / 1000).toFixed(3),
        '-i',
        sparsePath,
        '-frames:v',
        '1',
        '-an',
        join(root, 'raw-end.jpg')
      ],
      { encoding: 'utf8' }
    )
    const listed = spawnSync(
      ffprobePath,
      ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'frame=pts_time', '-of', 'csv=p=0', sparsePath],
      { encoding: 'utf8' }
    )
    const lastPts = listed.stdout.trim().split('\n').filter(Boolean).at(-1)
    const lastFrameMs = Math.floor(Number(lastPts) * 1000 + 1e-6)

    expect(rawSeek.status).toBe(234)
    expect(lastFrameMs).toBeLessThan(endAnchorMs)
    const frames = await mediaFfmpegHandlers.extractFrames(
      {
        filePath: sparsePath,
        outputDir: join(root, 'sparse-frames'),
        timestampsMs: [0, endAnchorMs],
        maxEdgePx: 64,
        jpegQuality: 70
      },
      context()
    )
    expect(frames.frames.map((frame) => frame.timestampMs)).toEqual([0, lastFrameMs])
    expect(frames.frames.every((frame) => existsSync(frame.path) && readFileSync(frame.path).length > 0)).toBe(true)

    const beyond = await mediaFfmpegHandlers.extractFrames(
      {
        filePath: sparsePath,
        outputDir: join(root, 'beyond-frames'),
        timestampsMs: [probe.durationMs + 1_000],
        maxEdgePx: 64,
        jpegQuality: 70
      },
      context()
    )
    expect(beyond.frames).toEqual([])
  })

  it('seeks the last packet when a long VFR frame makes the average rate land past it', async () => {
    const clip = (name: string, color: string, rate: string, duration: string) => {
      const path = join(root, `${name}.mp4`)
      expect(
        runFfmpeg([
          '-f',
          'lavfi',
          '-i',
          `color=c=${color}:s=32x32:r=${rate}:d=${duration}`,
          '-frames:v',
          '1',
          '-c:v',
          'mpeg4',
          '-video_track_timescale',
          '1000',
          path
        ])
      ).toBe(0)
      return path
    }
    const listPath = join(root, 'vfr-list.txt')
    writeFileSync(
      listPath,
      [clip('vfr-a', 'red', '1000', '1'), clip('vfr-b', 'green', '1000', '1'), clip('vfr-c', 'blue', '1', '6')]
        .map((path) => `file '${path}'`)
        .join('\n')
    )
    const vfrPath = join(root, 'long-tail-vfr.mp4')
    expect(runFfmpeg(['-f', 'concat', '-safe', '0', '-i', listPath, '-c', 'copy', vfrPath])).toBe(0)
    const probe = await mediaFfmpegHandlers.probe({ filePath: vfrPath, fallbackExt: 'mp4' }, context())
    const endAnchorMs = probe.durationMs - 50
    const averageSeekMs = Math.floor((2 / (500 / 167)) * 1000)
    const rawAverage = spawnSync(
      ffmpegPath,
      [
        '-hide_banner',
        '-nostdin',
        '-y',
        '-ss',
        (averageSeekMs / 1000).toFixed(3),
        '-i',
        vfrPath,
        '-frames:v',
        '1',
        '-an',
        '-update',
        '1',
        join(root, 'vfr-average.jpg')
      ],
      { encoding: 'utf8' }
    )

    expect(rawAverage.status).not.toBe(0)
    expect(averageSeekMs).toBeGreaterThan(2)
    const frames = await mediaFfmpegHandlers.extractFrames(
      {
        filePath: vfrPath,
        outputDir: join(root, 'vfr-frames'),
        timestampsMs: [endAnchorMs],
        maxEdgePx: 32,
        jpegQuality: 70
      },
      context()
    )
    expect(frames.frames.map((frame) => frame.timestampMs)).toEqual([2])
    expect(readFileSync(frames.frames[0].path).length).toBeGreaterThan(0)
  })

  it('keeps a nonzero start relative and returns the last video frame when audio is longer', async () => {
    const offsetPath = join(root, 'offset-start.mp4')
    expect(
      runFfmpeg([
        '-f',
        'lavfi',
        '-i',
        'color=c=red:s=32x32:r=10:d=2',
        '-output_ts_offset',
        '1.5',
        '-c:v',
        'mpeg4',
        offsetPath
      ])
    ).toBe(0)
    const offsetProbe = await mediaFfmpegHandlers.probe({ filePath: offsetPath, fallbackExt: 'mp4' }, context())
    const absoluteSeek = spawnSync(
      ffmpegPath,
      [
        '-hide_banner',
        '-nostdin',
        '-y',
        '-ss',
        '3.400',
        '-i',
        offsetPath,
        '-frames:v',
        '1',
        '-an',
        '-update',
        '1',
        join(root, 'offset-absolute.jpg')
      ],
      { encoding: 'utf8' }
    )
    expect(absoluteSeek.status).not.toBe(0)
    const offsetFrames = await mediaFfmpegHandlers.extractFrames(
      {
        filePath: offsetPath,
        outputDir: join(root, 'offset-frames'),
        timestampsMs: [offsetProbe.durationMs - 50],
        maxEdgePx: 32,
        jpegQuality: 70
      },
      context()
    )
    expect(offsetFrames.frames.map((frame) => frame.timestampMs)).toEqual([1_900])

    const longAudioPath = join(root, 'audio-longer.mp4')
    expect(
      runFfmpeg([
        '-f',
        'lavfi',
        '-i',
        'color=c=white:s=32x32:r=10:d=1',
        '-f',
        'lavfi',
        '-i',
        'sine=frequency=440:duration=4',
        '-c:v',
        'mpeg4',
        '-c:a',
        'aac',
        longAudioPath
      ])
    ).toBe(0)
    const longProbe = await mediaFfmpegHandlers.probe({ filePath: longAudioPath, fallbackExt: 'mp4' }, context())
    expect(longProbe.durationMs).toBeGreaterThan(3_000)
    const longFrames = await mediaFfmpegHandlers.extractFrames(
      {
        filePath: longAudioPath,
        outputDir: join(root, 'audio-longer-frames'),
        timestampsMs: [longProbe.durationMs - 50, longProbe.durationMs + 1_000],
        maxEdgePx: 32,
        jpegQuality: 70
      },
      context()
    )
    expect(longFrames.frames).toEqual([
      expect.objectContaining({ timestampMs: 900, path: join(root, 'audio-longer-frames', 'frame-0000.jpg') })
    ])
  })

  it('seeks the last video packet from the format start when audio starts earlier', async () => {
    const staggeredPath = join(root, 'staggered-av.mp4')
    expect(
      runFfmpeg([
        '-f',
        'lavfi',
        '-i',
        'sine=frequency=440:duration=4',
        '-itsoffset',
        '1.5',
        '-f',
        'lavfi',
        '-i',
        "color=c=black:s=32x32:r=10:d=2,geq=r='lt(T,1.8)*255':g='gte(T,1.8)*255':b=0",
        '-c:v',
        'mpeg4',
        '-c:a',
        'aac',
        staggeredPath
      ])
    ).toBe(0)
    const probe = await mediaFfmpegHandlers.probe({ filePath: staggeredPath, fallbackExt: 'mp4' }, context())
    expect(probe.durationMs).toBeGreaterThan(3_500)
    const early = join(root, 'staggered-early.jpg')
    expect(
      runFfmpeg(['-ss', '1.900', '-i', staggeredPath, '-map', '0:V:0', '-frames:v', '1', '-an', '-update', '1', early])
    ).toBe(0)
    expect(dominantChannel(early)).toBe('red')

    const frames = await mediaFfmpegHandlers.extractFrames(
      {
        filePath: staggeredPath,
        outputDir: join(root, 'staggered-frames'),
        timestampsMs: [probe.durationMs - 50],
        maxEdgePx: 32,
        jpegQuality: 70
      },
      context()
    )
    expect(frames.frames).toHaveLength(1)
    expect(frames.frames[0]?.timestampMs).toBeGreaterThan(3_000)
    expect(dominantChannel(frames.frames[0].path)).toBe('green')
  })

  it('extracts the same non-attached video stream the tail probe reads', async () => {
    const coverPath = join(root, 'cover.jpg')
    const coveredPath = join(root, 'covered.mp4')
    expect(
      runFfmpeg(['-f', 'lavfi', '-i', 'color=c=red:s=16x16:d=0.1', '-frames:v', '1', '-c:v', 'mjpeg', coverPath])
    ).toBe(0)
    expect(
      runFfmpeg([
        '-i',
        coverPath,
        '-f',
        'lavfi',
        '-i',
        "color=c=black:s=32x32:r=10:d=1,geq=r=0:g='gte(T,0.8)*255':b='lt(T,0.8)*255'",
        '-map',
        '0:v',
        '-map',
        '1:v',
        '-disposition:v:0',
        'attached_pic',
        '-c:v:0',
        'mjpeg',
        '-c:v:1',
        'mpeg4',
        coveredPath
      ])
    ).toBe(0)
    const probe = await mediaFfmpegHandlers.probe({ filePath: coveredPath, fallbackExt: 'mp4' }, context())
    const frames = await mediaFfmpegHandlers.extractFrames(
      {
        filePath: coveredPath,
        outputDir: join(root, 'covered-frames'),
        timestampsMs: [Math.max(0, probe.durationMs - 50)],
        maxEdgePx: 32,
        jpegQuality: 70
      },
      context()
    )
    expect(frames.frames).toHaveLength(1)
    expect(frames.frames[0]?.timestampMs).toBeGreaterThanOrEqual(800)
    const dimensions = JSON.parse(
      spawnSync(
        ffprobePath,
        ['-v', 'error', '-show_entries', 'stream=width,height', '-of', 'json', frames.frames[0].path],
        {
          encoding: 'utf8'
        }
      ).stdout
    ).streams[0]
    expect(dimensions).toMatchObject({ width: 32, height: 32 })
    expect(dominantChannel(frames.frames[0].path)).toBe('green')
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

  function dominantChannel(imagePath: string): 'red' | 'green' {
    const decoded = spawnSync(
      ffmpegPath,
      ['-v', 'error', '-i', imagePath, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'pipe:1'],
      { encoding: 'buffer' }
    )
    expect(decoded.status).toBe(0)
    const red = decoded.stdout[0] ?? 0
    const green = decoded.stdout[1] ?? 0
    return green > red ? 'green' : 'red'
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
      const call = spawnControl.calls
      const stream = () => Object.assign(new EventEmitter(), { setEncoding: () => {} })
      const child = Object.assign(new EventEmitter(), { pid: 424242, stdout: stream(), stderr: stream() })
      queueMicrotask(() => {
        if (call === 1) {
          child.stdout.emit('data', '{"format":{"duration":"2.000000"},"streams":[]}')
        }
        child.emit('close', 0)
      })
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

      expect(spawnControl.calls).toBe(2)
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
          child.stdout.emit('data', '{"format":{"duration":"2.000000"},"streams":[]}')
          child.emit('close', 0)
          return
        }
        if (call === 2) {
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

      expect(spawnControl.calls).toBe(3)
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

  it('still extracts a frame when probe metadata is unavailable', async () => {
    const outputDir = mkdtempSync(join(tmpdir(), 'cherry-media-probe-exit-'))
    applyMediaFfmpegInitData({ ffmpegPath: '/usr/bin/false', ffprobePath: '/usr/bin/false' })
    spawnControl.replacement = () => {
      const call = spawnControl.calls
      const stream = () => Object.assign(new EventEmitter(), { setEncoding: () => {} })
      const child = Object.assign(new EventEmitter(), { pid: 424242, stdout: stream(), stderr: stream() })
      queueMicrotask(() => {
        if (call === 1) {
          child.emit('close', 1)
          return
        }
        writeFileSync(join(outputDir, 'frame-0000.jpg'), 'frame')
        child.emit('close', 0)
      })
      return child
    }

    try {
      const result = await mediaFfmpegHandlers.extractFrames(
        {
          filePath: '/video.mp4',
          outputDir,
          timestampsMs: [0],
          maxEdgePx: 120,
          jpegQuality: 70
        },
        context()
      )
      expect(result.frames).toEqual([{ path: join(outputDir, 'frame-0000.jpg'), timestampMs: 0 }])
      expect(spawnControl.calls).toBe(2)
    } finally {
      rmSync(outputDir, { recursive: true, force: true })
    }
  })

  it('rejects a probe timeout instead of continuing with empty bounds', async () => {
    const outputDir = mkdtempSync(join(tmpdir(), 'cherry-media-probe-timeout-'))
    applyMediaFfmpegInitData({ ffmpegPath: '/usr/bin/false', ffprobePath: '/usr/bin/false' })
    spawnControl.replacement = () => {
      const stream = () => Object.assign(new EventEmitter(), { setEncoding: () => {} })
      const child = Object.assign(new EventEmitter(), { pid: 424242, stdout: stream(), stderr: stream() })
      queueMicrotask(() => child.emit('error', new Error('Media processing timed out')))
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
      ).rejects.toThrow('Media processing timed out')
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
