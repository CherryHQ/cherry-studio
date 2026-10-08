import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'

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

  function runFfmpeg(args: string[]): number | null {
    return spawnSync(ffmpegPath, ['-hide_banner', '-nostdin', '-y', ...args], { encoding: 'utf8' }).status
  }
})

async function waitForFile(filePath: string): Promise<void> {
  const deadline = Date.now() + 5_000
  while (!existsSync(filePath)) {
    if (Date.now() >= deadline) throw new Error(`Timed out waiting for ${filePath}`)
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
}
