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

import {
  FRAME_SIMILARITY_MAD_THRESHOLD,
  meanAbsoluteDifference,
  planAnalysisFrameTimestamps,
  SCENE_SAMPLE_FPS,
  SCENE_SCAN_EDGE_PX,
  SCENE_SCORE_THRESHOLD,
  selectDistinctFrameIndexes
} from '../frameSelection'
import { readFrameSignature } from '../frameSignature'
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
const context = (signal = new AbortController().signal) => ({ signal, logger, emit: () => {} })

describe.skipIf(!hasBundledFfmpeg)('mediaFfmpegHandlers', () => {
  let root: string
  let tonePath: string
  let webmPath: string
  let videoPath: string

  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), 'cherry-media-ffmpeg-test-'))
    tonePath = join(root, 'tone.wav')
    webmPath = join(root, 'tone.webm')
    videoPath = join(root, 'portrait.mp4')
    expect(
      runFfmpeg(['-f', 'lavfi', '-i', 'sine=frequency=440:duration=3', '-ac', '1', '-ar', '48000', tonePath])
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

  it('keeps a short color cut and a later cut inside the frame budget', async () => {
    const cutPath = join(root, 'color-cuts.mp4')
    expect(
      runFfmpeg([
        '-f',
        'lavfi',
        '-i',
        'color=c=red:s=320x240:r=25:d=5',
        '-f',
        'lavfi',
        '-i',
        'color=c=white:s=320x240:r=25:d=0.45',
        '-f',
        'lavfi',
        '-i',
        'color=c=red:s=320x240:r=25:d=4.55',
        '-f',
        'lavfi',
        '-i',
        'color=c=green:s=320x240:r=25:d=6',
        '-filter_complex',
        '[0:v][1:v][2:v][3:v]concat=n=4:v=1:a=0',
        '-c:v',
        'mpeg4',
        '-q:v',
        '5',
        cutPath
      ])
    ).toBe(0)
    const probe = await mediaFfmpegHandlers.probe({ filePath: cutPath, fallbackExt: 'mp4' }, context())
    const detected = await mediaFfmpegHandlers.detectSceneChanges(
      {
        filePath: cutPath,
        durationMs: probe.durationMs,
        sampleFps: SCENE_SAMPLE_FPS,
        scoreThreshold: SCENE_SCORE_THRESHOLD,
        scanEdgePx: SCENE_SCAN_EDGE_PX,
        maxCandidates: 32
      },
      context()
    )
    const planned = planAnalysisFrameTimestamps({
      durationMs: probe.durationMs,
      maxFrames: 24,
      targetIntervalMs: 4_000,
      sceneChanges: detected.changes
    })

    expect(detected.changes.some((change) => change.timestampMs >= 4_500 && change.timestampMs <= 6_000)).toBe(true)
    expect(detected.changes.some((change) => change.timestampMs >= 9_000 && change.timestampMs <= 11_000)).toBe(true)
    expect(planned.length).toBeLessThanOrEqual(24)
    expect(planned[0]).toBe(0)
    expect(planned.at(-1)).toBeGreaterThan(probe.durationMs * 0.9)
    expect(planned.some((timestamp) => timestamp >= 4_500 && timestamp <= 6_500)).toBe(true)
    expect(planned.some((timestamp) => timestamp >= 9_000 && timestamp <= 11_500)).toBe(true)
  })

  it.each([
    {
      label: '16s half-second cut',
      fileName: 'near-anchor-cut.mp4',
      framesDir: 'near-anchor-frames',
      segments: [
        { color: 'red', duration: '8.16' },
        { color: 'white', duration: '0.52' },
        { color: 'red', duration: '7.32' }
      ],
      detectedRange: [8_000, 8_800]
    },
    {
      label: '6s red-white-red cut',
      fileName: 'six-second-red-white.mp4',
      framesDir: 'six-second-frames',
      segments: [
        { color: 'red', duration: '3' },
        { color: 'white', duration: '1' },
        { color: 'red', duration: '2' }
      ],
      detectedRange: [2_500, 4_500]
    },
    {
      label: '3s red-white-red cut',
      fileName: 'three-second-red-white.mp4',
      framesDir: 'three-second-frames',
      segments: [
        { color: 'red', duration: '1' },
        { color: 'white', duration: '0.5' },
        { color: 'red', duration: '1.5' }
      ],
      detectedRange: [800, 1_800]
    }
  ])(
    'keeps a real white frame through detect, plan, extract, and dedup ($label)',
    async ({ fileName, framesDir, segments, detectedRange }) => {
      const cutPath = join(root, fileName)
      const inputs = segments.flatMap((segment) => [
        '-f',
        'lavfi',
        '-i',
        `color=c=${segment.color}:s=320x240:r=25:d=${segment.duration}`
      ])
      expect(
        runFfmpeg([
          ...inputs,
          '-filter_complex',
          `${segments.map((_, index) => `[${index}:v]`).join('')}concat=n=${segments.length}:v=1:a=0`,
          '-c:v',
          'mpeg4',
          '-q:v',
          '5',
          cutPath
        ])
      ).toBe(0)
      const probe = await mediaFfmpegHandlers.probe({ filePath: cutPath, fallbackExt: 'mp4' }, context())
      const detected = await mediaFfmpegHandlers.detectSceneChanges(
        {
          filePath: cutPath,
          durationMs: probe.durationMs,
          sampleFps: SCENE_SAMPLE_FPS,
          scoreThreshold: SCENE_SCORE_THRESHOLD,
          scanEdgePx: SCENE_SCAN_EDGE_PX,
          maxCandidates: 32
        },
        context()
      )
      const planned = planAnalysisFrameTimestamps({
        durationMs: probe.durationMs,
        maxFrames: 24,
        targetIntervalMs: 4_000,
        sceneChanges: detected.changes
      })
      const extracted = await mediaFfmpegHandlers.extractFrames(
        {
          filePath: cutPath,
          outputDir: join(root, framesDir),
          timestampsMs: planned,
          maxEdgePx: 160,
          jpegQuality: 70
        },
        context()
      )
      const signatures = await Promise.all(extracted.frames.map((frame) => readFrameSignature(frame.path)))
      const kept = selectDistinctFrameIndexes(signatures, FRAME_SIMILARITY_MAD_THRESHOLD)
      const opening = signatures[0]
      const whiteKeptIndex = kept.find((index) => {
        const signature = signatures[index]
        return signature != null && isBrightNeutral(signature)
      })
      const whiteSignature = whiteKeptIndex == null ? undefined : signatures[whiteKeptIndex]
      const evidence = JSON.stringify({
        durationMs: probe.durationMs,
        detected: detected.changes,
        planned,
        extracted: extracted.frames.map((frame) => frame.timestampMs),
        kept: kept.map((index) => extracted.frames[index]?.timestampMs)
      })

      expect(
        detected.changes.some(
          (change) => change.timestampMs >= detectedRange[0] && change.timestampMs <= detectedRange[1]
        ),
        evidence
      ).toBe(true)
      expect(planned.length, evidence).toBeLessThanOrEqual(24)
      expect(kept.length, evidence).toBeGreaterThan(0)
      expect(kept.length, evidence).toBeLessThanOrEqual(planned.length)
      expect(planned[0], evidence).toBe(0)
      expect(planned.at(-1), evidence).toBeGreaterThan(probe.durationMs * 0.9)
      expect(opening, evidence).toBeInstanceOf(Uint8Array)
      expect(whiteSignature, evidence).toBeInstanceOf(Uint8Array)
      if (opening instanceof Uint8Array && whiteSignature instanceof Uint8Array) {
        expect(meanAbsoluteDifference(whiteSignature, opening), evidence).toBeGreaterThan(40)
      }
    }
  )

  it('detects cuts on the first video stream when a larger static stream is default', async () => {
    const cutPath = join(root, 'multi-stream-cuts.mp4')
    expect(
      runFfmpeg([
        '-f',
        'lavfi',
        '-i',
        'color=c=red:s=160x120:r=25:d=1',
        '-f',
        'lavfi',
        '-i',
        'color=c=white:s=160x120:r=25:d=1',
        '-f',
        'lavfi',
        '-i',
        'color=c=blue:s=160x120:r=25:d=2',
        '-f',
        'lavfi',
        '-i',
        'color=c=gray:s=640x480:r=25:d=4',
        '-filter_complex',
        '[0:v][1:v][2:v]concat=n=3:v=1:a=0[cuts]',
        '-map',
        '[cuts]',
        '-map',
        '3:v',
        '-disposition:v:0',
        '0',
        '-disposition:v:1',
        'default',
        '-c:v',
        'mpeg4',
        '-q:v',
        '5',
        cutPath
      ])
    ).toBe(0)
    const streams = JSON.parse(
      spawnSync(
        ffprobePath,
        [
          '-v',
          'error',
          '-show_entries',
          'stream=index,width,height:stream_disposition=default',
          '-of',
          'json',
          cutPath
        ],
        { encoding: 'utf8' }
      ).stdout
    ).streams
    expect(streams[0]).toMatchObject({ width: 160, height: 120, disposition: { default: 0 } })
    expect(streams[1]).toMatchObject({ width: 640, height: 480, disposition: { default: 1 } })

    const probe = await mediaFfmpegHandlers.probe({ filePath: cutPath, fallbackExt: 'mp4' }, context())
    const detected = await mediaFfmpegHandlers.detectSceneChanges(
      {
        filePath: cutPath,
        durationMs: probe.durationMs,
        sampleFps: SCENE_SAMPLE_FPS,
        scoreThreshold: SCENE_SCORE_THRESHOLD,
        scanEdgePx: SCENE_SCAN_EDGE_PX,
        maxCandidates: 32
      },
      context()
    )
    const whiteCut = detected.changes.find((change) => change.timestampMs >= 800 && change.timestampMs <= 1_500)
    expect(whiteCut).toBeDefined()
    const extracted = await mediaFfmpegHandlers.extractFrames(
      {
        filePath: cutPath,
        outputDir: join(root, 'multi-stream-frames'),
        timestampsMs: [whiteCut!.timestampMs],
        maxEdgePx: 160,
        jpegQuality: 70
      },
      context()
    )
    expect(extracted.frames).toHaveLength(1)
    const signature = await readFrameSignature(extracted.frames[0].path)
    expect(signature).toBeInstanceOf(Uint8Array)
    if (signature instanceof Uint8Array) expect(isBrightNeutral(signature)).toBe(true)
  })

  it('keeps a full-frame cut when the scene threshold is 0.999', async () => {
    const cutPath = join(root, 'threshold-high.mp4')
    expect(
      runFfmpeg([
        '-f',
        'lavfi',
        '-i',
        'color=c=red:s=160x120:r=25:d=1',
        '-f',
        'lavfi',
        '-i',
        'color=c=white:s=160x120:r=25:d=1',
        '-filter_complex',
        '[0:v][1:v]concat=n=2:v=1:a=0',
        '-c:v',
        'mpeg4',
        '-q:v',
        '5',
        cutPath
      ])
    ).toBe(0)
    const probe = await mediaFfmpegHandlers.probe({ filePath: cutPath, fallbackExt: 'mp4' }, context())
    const detected = await mediaFfmpegHandlers.detectSceneChanges(
      {
        filePath: cutPath,
        durationMs: probe.durationMs,
        sampleFps: SCENE_SAMPLE_FPS,
        scoreThreshold: 0.999,
        scanEdgePx: SCENE_SCAN_EDGE_PX,
        maxCandidates: 8
      },
      context()
    )
    expect(detected.changes.some((change) => change.timestampMs >= 700 && change.timestampMs <= 1_500)).toBe(true)
  })

  it('does not admit a one-level color change below threshold 0.004', async () => {
    const cutPath = join(root, 'threshold-low.avi')
    expect(
      runFfmpeg([
        '-f',
        'lavfi',
        '-i',
        "nullsrc=s=160x120:r=8:d=2,format=rgb24,geq=r='128+gte(T,1)':g='128':b='128'",
        '-pix_fmt',
        'rgb24',
        '-c:v',
        'rawvideo',
        '-f',
        'avi',
        cutPath
      ])
    ).toBe(0)
    const detected = await mediaFfmpegHandlers.detectSceneChanges(
      {
        filePath: cutPath,
        durationMs: 2_000,
        sampleFps: SCENE_SAMPLE_FPS,
        scoreThreshold: 0.004,
        scanEdgePx: SCENE_SCAN_EDGE_PX,
        maxCandidates: 8
      },
      context()
    )
    expect(detected.changes).toEqual([])
  })

  it('collapses static frames and leaves an explicit timestamp extract unchanged', async () => {
    const staticPath = join(root, 'static-gray.mp4')
    expect(
      runFfmpeg(['-f', 'lavfi', '-i', 'color=c=gray:s=320x240:r=25:d=12', '-c:v', 'mpeg4', '-q:v', '5', staticPath])
    ).toBe(0)
    const probe = await mediaFfmpegHandlers.probe({ filePath: staticPath, fallbackExt: 'mp4' }, context())
    const detected = await mediaFfmpegHandlers.detectSceneChanges(
      {
        filePath: staticPath,
        durationMs: probe.durationMs,
        sampleFps: SCENE_SAMPLE_FPS,
        scoreThreshold: SCENE_SCORE_THRESHOLD,
        scanEdgePx: SCENE_SCAN_EDGE_PX,
        maxCandidates: 32
      },
      context()
    )
    const planned = planAnalysisFrameTimestamps({
      durationMs: probe.durationMs,
      maxFrames: 8,
      targetIntervalMs: 4_000,
      sceneChanges: detected.changes
    })
    const extracted = await mediaFfmpegHandlers.extractFrames(
      {
        filePath: staticPath,
        outputDir: join(root, 'static-frames'),
        timestampsMs: planned,
        maxEdgePx: 160,
        jpegQuality: 70
      },
      context()
    )
    const signatures = await Promise.all(extracted.frames.map((frame) => readFrameSignature(frame.path)))
    expect(detected.changes).toEqual([])
    expect(planned.length).toBeGreaterThan(1)
    expect(selectDistinctFrameIndexes(signatures, FRAME_SIMILARITY_MAD_THRESHOLD)).toEqual([0])

    const explicit = await mediaFfmpegHandlers.extractFrames(
      {
        filePath: videoPath,
        outputDir: join(root, 'explicit-frames'),
        timestampsMs: [0, 1_000],
        maxEdgePx: 80,
        jpegQuality: 60
      },
      context()
    )
    expect(explicit.frames.map((frame) => frame.timestampMs)).toEqual([0, 1_000])
  })

  it('rejects a scene scan of a non-media file and aborts a running scan', async () => {
    const bogusPath = join(root, 'not-media.txt')
    writeFileSync(bogusPath, 'not a video')
    await expect(
      mediaFfmpegHandlers.detectSceneChanges(
        {
          filePath: bogusPath,
          durationMs: 1_000,
          sampleFps: SCENE_SAMPLE_FPS,
          scoreThreshold: SCENE_SCORE_THRESHOLD,
          scanEdgePx: SCENE_SCAN_EDGE_PX,
          maxCandidates: 8
        },
        context()
      )
    ).rejects.toThrow(/Media tool failed/)

    const longPath = join(root, 'long-scan.mp4')
    expect(
      runFfmpeg([
        '-f',
        'lavfi',
        '-i',
        'testsrc2=size=1280x720:rate=25:duration=20',
        '-c:v',
        'mpeg4',
        '-q:v',
        '8',
        longPath
      ])
    ).toBe(0)
    const controller = new AbortController()
    const pidRegistryPath = join(root, 'scene-child.pid')
    const pending = mediaFfmpegHandlers.detectSceneChanges(
      {
        filePath: longPath,
        durationMs: 20_000,
        sampleFps: SCENE_SAMPLE_FPS,
        scoreThreshold: SCENE_SCORE_THRESHOLD,
        scanEdgePx: SCENE_SCAN_EDGE_PX,
        maxCandidates: 32,
        pidRegistryPath
      },
      context(controller.signal)
    )
    await waitForFile(pidRegistryPath)
    const reason = new Error('cancel scene scan')
    controller.abort(reason)
    await expect(pending).rejects.toBe(reason)
    expect(existsSync(pidRegistryPath)).toBe(false)
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

function isBrightNeutral(signature: Uint8Array): boolean {
  if (signature.length === 0 || signature.length % 3 !== 0) return false
  const totals = [0, 0, 0]
  for (let index = 0; index < signature.length; index += 1) totals[index % 3] += signature[index]
  const pixels = signature.length / 3
  return totals.every((total) => total / pixels > 170)
}
