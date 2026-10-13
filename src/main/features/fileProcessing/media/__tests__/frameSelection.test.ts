import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import {
  createSceneCandidateBuckets,
  FRAME_SIMILARITY_MAD_THRESHOLD,
  meanAbsoluteDifference,
  planAnalysisFrameTimestamps,
  selectDistinctFrameIndexes
} from '../frameSelection'
import { readFrameSignature } from '../frameSignature'
import { planFrameTimestamps } from '../probeClassification'

describe('planAnalysisFrameTimestamps', () => {
  it('keeps the uniform plan when scene detection finds nothing', () => {
    expect(
      planAnalysisFrameTimestamps({
        durationMs: 60_000,
        maxFrames: 5,
        targetIntervalMs: 4_000,
        sceneChanges: []
      })
    ).toEqual(planFrameTimestamps(60_000, 5, 4_000))
  })

  it('returns no timestamps for an unusable duration or budget', () => {
    expect(planAnalysisFrameTimestamps({ durationMs: 0, maxFrames: 8, targetIntervalMs: 4_000 })).toEqual([])
    expect(
      planAnalysisFrameTimestamps({ durationMs: Number.NaN, maxFrames: 8, targetIntervalMs: 4_000, sceneChanges: [] })
    ).toEqual([])
    expect(planAnalysisFrameTimestamps({ durationMs: 8_000, maxFrames: 0, targetIntervalMs: 4_000 })).toEqual([])
  })

  it('keeps a short cut that falls between uniform samples and a later cut', () => {
    const timestamps = planAnalysisFrameTimestamps({
      durationMs: 16_000,
      maxFrames: 24,
      targetIntervalMs: 4_000,
      sceneChanges: [
        { timestampMs: 5_200, score: 0.9 },
        { timestampMs: 10_000, score: 0.8 }
      ]
    })

    expect(timestamps.length).toBeLessThanOrEqual(5)
    expect(timestamps[0]).toBe(0)
    expect(timestamps.at(-1)).toBeGreaterThan(15_000)
    expect(timestamps).toContain(5_200)
    expect(timestamps).toContain(10_000)
  })

  it('keeps a half-second cut that starts just after a uniform anchor', () => {
    const timestamps = planAnalysisFrameTimestamps({
      durationMs: 16_000,
      maxFrames: 24,
      targetIntervalMs: 4_000,
      sceneChanges: [
        { timestampMs: 8_125, score: 1 },
        { timestampMs: 8_625, score: 1 }
      ]
    })

    expect(timestamps.length).toBeLessThanOrEqual(5)
    expect(timestamps[0]).toBe(0)
    expect(timestamps.at(-1)).toBeGreaterThan(15_000)
    expect(timestamps).not.toEqual(planFrameTimestamps(16_000, 24, 4_000))
    expect(timestamps.some((timestamp) => timestamp >= 8_125 && timestamp < 8_625)).toBe(true)
  })

  it('retains one short cut and both ends of a six-second clip unless the caller cap is 1 or 2', () => {
    const sceneChanges = [
      { timestampMs: 3_000, score: 1 },
      { timestampMs: 4_000, score: 1 }
    ]
    const timestamps = planAnalysisFrameTimestamps({
      durationMs: 6_000,
      maxFrames: 24,
      targetIntervalMs: 4_000,
      sceneChanges
    })

    expect(timestamps.length).toBeGreaterThanOrEqual(3)
    expect(timestamps.length).toBeLessThanOrEqual(24)
    expect(timestamps[0]).toBe(0)
    expect(timestamps.at(-1)).toBe(5_950)
    expect(timestamps.some((timestamp) => timestamp >= 3_000 && timestamp < 4_000)).toBe(true)

    const oneFrame = planAnalysisFrameTimestamps({
      durationMs: 6_000,
      maxFrames: 1,
      targetIntervalMs: 4_000,
      sceneChanges
    })
    const twoFrames = planAnalysisFrameTimestamps({
      durationMs: 6_000,
      maxFrames: 2,
      targetIntervalMs: 4_000,
      sceneChanges
    })
    expect(oneFrame).toEqual(planFrameTimestamps(6_000, 1, 4_000))
    expect(twoFrames).toEqual(planFrameTimestamps(6_000, 2, 4_000))
    expect(oneFrame.length).toBeLessThanOrEqual(1)
    expect(twoFrames.length).toBeLessThanOrEqual(2)

    expect(
      planAnalysisFrameTimestamps({
        durationMs: 6_000,
        maxFrames: 24,
        targetIntervalMs: 4_000,
        sceneChanges: []
      })
    ).toEqual(planFrameTimestamps(6_000, 24, 4_000))
  })

  it('keeps both ends and one cut on a three-second clip shorter than the sample interval', () => {
    const sceneChanges = [
      { timestampMs: 1_000, score: 1 },
      { timestampMs: 1_500, score: 1 }
    ]
    const timestamps = planAnalysisFrameTimestamps({
      durationMs: 3_000,
      maxFrames: 24,
      targetIntervalMs: 4_000,
      sceneChanges
    })

    expect(timestamps.length).toBeGreaterThanOrEqual(3)
    expect(timestamps.length).toBeLessThanOrEqual(24)
    expect(timestamps[0]).toBe(0)
    expect(timestamps.at(-1)).toBe(2_950)
    expect(timestamps.some((timestamp) => timestamp >= 1_000 && timestamp < 1_500)).toBe(true)
    expect(
      planAnalysisFrameTimestamps({
        durationMs: 3_000,
        maxFrames: 1,
        targetIntervalMs: 4_000,
        sceneChanges
      })
    ).toEqual(planFrameTimestamps(3_000, 1, 4_000))
    expect(
      planAnalysisFrameTimestamps({
        durationMs: 3_000,
        maxFrames: 2,
        targetIntervalMs: 4_000,
        sceneChanges
      })
    ).toEqual(planFrameTimestamps(3_000, 2, 4_000))
    expect(
      planAnalysisFrameTimestamps({
        durationMs: 3_000,
        maxFrames: 24,
        targetIntervalMs: 4_000,
        sceneChanges: []
      })
    ).toEqual(planFrameTimestamps(3_000, 24, 4_000))
  })

  it('moves an earlier uniform anchor onto a cut in the same scan sample', () => {
    const timestamps = planAnalysisFrameTimestamps({
      durationMs: 16_000,
      maxFrames: 24,
      targetIntervalMs: 4_000,
      sceneChanges: [{ timestampMs: 8_050, score: 1 }]
    })

    expect(timestamps).toContain(8_050)
    expect(timestamps).not.toContain(7_975)
    expect(timestamps.length).toBeLessThanOrEqual(5)
    expect(timestamps[0]).toBe(0)
    expect(timestamps.at(-1)).toBeGreaterThan(15_000)
  })

  it('does not let an early burst of cuts consume every scene slot', () => {
    const early = Array.from({ length: 12 }, (_, index) => ({
      timestampMs: 200 + index * 100,
      score: 1 - index * 0.01
    }))
    const timestamps = planAnalysisFrameTimestamps({
      durationMs: 60_000,
      maxFrames: 9,
      targetIntervalMs: 4_000,
      sceneChanges: [...early, { timestampMs: 45_000, score: 0.45 }]
    })

    expect(timestamps.length).toBeLessThanOrEqual(9)
    expect(timestamps[0]).toBe(0)
    expect(timestamps.at(-1)).toBeGreaterThan(50_000)
    expect(timestamps).toContain(45_000)
    expect(timestamps.filter((timestamp) => timestamp > 0 && timestamp < 5_000).length).toBeLessThanOrEqual(1)
  })

  it('covers a long clip from start to end inside a strict frame budget', () => {
    const durationMs = 30 * 60 * 1000
    const timestamps = planAnalysisFrameTimestamps({
      durationMs,
      maxFrames: 4,
      targetIntervalMs: 4_000,
      sceneChanges: [
        { timestampMs: 500, score: 0.99 },
        { timestampMs: 800, score: 0.98 },
        { timestampMs: 1_200, score: 0.97 },
        { timestampMs: durationMs - 20_000, score: 0.4 }
      ]
    })

    expect(timestamps.length).toBeLessThanOrEqual(4)
    expect(timestamps.length).toBeGreaterThan(1)
    expect(timestamps[0]).toBe(0)
    expect(timestamps.at(-1)).toBeGreaterThan(durationMs * 0.95)
    expect(timestamps.some((timestamp) => timestamp > durationMs * 0.5)).toBe(true)
  })
})

describe('scene candidate buckets', () => {
  it('keeps the strongest cut in each time slice instead of the first cuts only', () => {
    const buckets = createSceneCandidateBuckets(10_000, 4)
    for (let index = 0; index < 20; index += 1) buckets.add({ timestampMs: index * 20, score: 0.4 })
    buckets.add({ timestampMs: 9_500, score: 0.5 })
    const changes = buckets.list()

    expect(changes.length).toBeLessThanOrEqual(4)
    expect(changes.some((change) => change.timestampMs === 9_500)).toBe(true)
  })
})

describe('selectDistinctFrameIndexes', () => {
  const pixels = FRAME_SIMILARITY_MAD_THRESHOLD

  it('drops near-duplicate frames and keeps a later frame that actually differs', () => {
    const base = new Uint8Array(16 * 16 * 3).fill(40)
    const near = base.slice()
    near[0] = 41
    const different = new Uint8Array(16 * 16 * 3).fill(200)

    expect(meanAbsoluteDifference(base, near)).toBeLessThan(pixels)
    expect(selectDistinctFrameIndexes([base, near, different], pixels)).toEqual([0, 2])
  })

  it('keeps a frame whose image cannot be read and never drops the only frame', () => {
    const base = new Uint8Array(16 * 16 * 3).fill(10)
    expect(selectDistinctFrameIndexes([base, null, base], pixels)).toEqual([0, 1])
    expect(selectDistinctFrameIndexes([], pixels)).toEqual([])
  })
})

describe('readFrameSignature', () => {
  let directory: string

  afterEach(async () => {
    if (directory) await rm(directory, { recursive: true, force: true })
  })

  it('treats two encodings of the same color as duplicates and a different color as distinct', async () => {
    const sharp = (await import('sharp')).default
    directory = await mkdtemp(join(tmpdir(), 'frame-signature-'))
    const write = async (name: string, background: string) => {
      const path = join(directory, name)
      await sharp({ create: { width: 48, height: 48, channels: 3, background } })
        .jpeg({ quality: 70 })
        .toFile(path)
      return path
    }
    const red = await readFrameSignature(await write('red-a.jpg', 'red'))
    const redAgain = await readFrameSignature(await write('red-b.jpg', 'red'))
    const blue = await readFrameSignature(await write('blue.jpg', 'blue'))

    expect(red).toBeInstanceOf(Uint8Array)
    expect(redAgain).toBeInstanceOf(Uint8Array)
    expect(blue).toBeInstanceOf(Uint8Array)
    expect(meanAbsoluteDifference(red!, redAgain!)).toBeLessThan(FRAME_SIMILARITY_MAD_THRESHOLD)
    expect(meanAbsoluteDifference(red!, blue!)).toBeGreaterThan(FRAME_SIMILARITY_MAD_THRESHOLD)
    expect(selectDistinctFrameIndexes([red, redAgain, blue], FRAME_SIMILARITY_MAD_THRESHOLD)).toEqual([0, 2])
  })
})
