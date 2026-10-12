import { planFrameTimestamps } from './probeClassification'

export const SCENE_SCORE_THRESHOLD = 0.3
/** Scan step. A half-second cut still lands on a sample, and closer hits are one sample. */
export const SCENE_SAMPLE_FPS = 8
export const SCENE_SCAN_EDGE_PX = 160
export const FRAME_SIGNATURE_EDGE = 16
/** 16×16 RGB difference below this is the same image. */
export const FRAME_SIMILARITY_MAD_THRESHOLD = 8

const SEEK_TAIL_MS = 50

export interface SceneChangeCandidate {
  timestampMs: number
  score: number
}

export function sceneCandidateLimit(maxFrames: number): number {
  if (!Number.isFinite(maxFrames) || maxFrames <= 0) return 8
  return Math.min(128, Math.max(8, Math.floor(maxFrames) * 4))
}

export function createSceneCandidateBuckets(durationMs: number, maxCandidates: number) {
  const count = Math.max(1, Math.min(256, Math.floor(maxCandidates)))
  const buckets: Array<SceneChangeCandidate | undefined> = new Array(count)
  const span = Math.max(1, durationMs)
  return {
    add(change: SceneChangeCandidate) {
      if (!Number.isFinite(change.timestampMs) || change.timestampMs < 0) return
      if (!Number.isFinite(change.score) || change.score <= 0) return
      const index = Math.min(count - 1, Math.floor((Math.min(change.timestampMs, span) / span) * count))
      const current = buckets[index]
      if (!current || change.score > current.score) {
        buckets[index] = { timestampMs: Math.round(change.timestampMs), score: change.score }
      }
    },
    list(): SceneChangeCandidate[] {
      return buckets
        .filter((bucket): bucket is SceneChangeCandidate => bucket != null)
        .sort((left, right) => left.timestampMs - right.timestampMs)
    }
  }
}

/** Duration-capped timestamps. Scene cuts spread across the clip; no cuts keeps the uniform plan. */
export function planAnalysisFrameTimestamps(input: {
  durationMs: number
  maxFrames: number
  targetIntervalMs: number
  sceneChanges?: readonly SceneChangeCandidate[]
}): number[] {
  const budget = resolveAnalysisFrameCount(
    input.durationMs,
    input.maxFrames,
    input.targetIntervalMs,
    input.sceneChanges
  )
  if (budget === 0) return []
  const uniform = planFrameTimestamps(input.durationMs, budget, input.targetIntervalMs)
  const sceneChanges = input.sceneChanges ?? []
  if (sceneChanges.length === 0 || budget < 3) return uniform

  const sceneReserve = Math.max(1, Math.round(budget / 3))
  const backboneCount = budget - sceneReserve
  const requestedInterval = Math.max(1, input.targetIntervalMs)
  // A caller interval longer than the clip cannot place both backbone ends.
  const backboneInterval =
    backboneCount <= 1
      ? requestedInterval
      : Math.min(requestedInterval, Math.max(1, Math.floor(Math.max(1, input.durationMs) / (backboneCount - 1))))
  const backbone = planFrameTimestamps(input.durationMs, backboneCount, backboneInterval)
  const duplicateGapMs = Math.round(1_000 / SCENE_SAMPLE_FPS)
  const lastMs = Math.max(0, input.durationMs - SEEK_TAIL_MS)
  const placed = selectDistributedScenes(sceneChanges, backbone, input.durationMs, sceneReserve, duplicateGapMs, lastMs)
  if (placed.scenes.length === 0 && !placed.replaced) return uniform

  const chosen = [...placed.backbone, ...placed.scenes]
  for (const timestamp of uniform) {
    if (chosen.length >= budget) break
    if (chosen.some((current) => Math.abs(current - timestamp) <= duplicateGapMs)) continue
    chosen.push(timestamp)
  }
  chosen.sort((left, right) => left - right)
  return chosen
}

export function meanAbsoluteDifference(left: Uint8Array, right: Uint8Array): number {
  if (left.length === 0 || left.length !== right.length) return Number.POSITIVE_INFINITY
  let total = 0
  for (let index = 0; index < left.length; index += 1) total += Math.abs(left[index] - right[index])
  return total / left.length
}

/** Keeps the first frame and later frames that are not near-duplicates of one already kept. */
export function selectDistinctFrameIndexes(signatures: ReadonlyArray<Uint8Array | null>, threshold: number): number[] {
  const kept: number[] = []
  for (let index = 0; index < signatures.length; index += 1) {
    const signature = signatures[index]
    if (!signature) {
      kept.push(index)
      continue
    }
    const duplicate = kept.some((keptIndex) => {
      const other = signatures[keptIndex]
      return other != null && meanAbsoluteDifference(signature, other) < threshold
    })
    if (!duplicate) kept.push(index)
  }
  return kept
}

function resolveAnalysisFrameCount(
  durationMs: number,
  maxFrames: number,
  targetIntervalMs: number,
  sceneChanges?: readonly SceneChangeCandidate[]
): number {
  if (!Number.isFinite(durationMs) || durationMs <= 0 || !Number.isFinite(maxFrames) || maxFrames <= 0) return 0
  const interval = Math.max(1, targetIntervalMs)
  const durationCount = Math.min(Math.floor(maxFrames), Math.max(1, Math.floor(durationMs / interval) + 1))
  // A 1- or 2-frame caller cap stays as-is. A higher cap can spare one slot for a cut.
  const usableCut = (sceneChanges ?? []).some(
    (change) =>
      Number.isFinite(change.timestampMs) &&
      change.timestampMs >= 0 &&
      Number.isFinite(change.score) &&
      change.score > 0
  )
  if (usableCut && durationCount < 3 && maxFrames >= 3) return 3
  return durationCount
}

function selectDistributedScenes(
  sceneChanges: readonly SceneChangeCandidate[],
  backbone: readonly number[],
  durationMs: number,
  sceneReserve: number,
  minGapMs: number,
  lastMs: number
): { backbone: number[]; scenes: number[]; replaced: boolean } {
  const anchors = [...backbone]
  const scenes: number[] = []
  let replaced = false
  const ranked = sceneChanges
    .map((change) => ({
      timestampMs: Math.min(lastMs, Math.max(0, Math.round(change.timestampMs))),
      score: change.score
    }))
    .filter((change) => Number.isFinite(change.score) && change.score > 0)
    .sort((left, right) => right.score - left.score || left.timestampMs - right.timestampMs)
  const width = durationMs / sceneReserve
  const filledBins = new Set<number>()
  const binOf = (timestampMs: number) => (width <= 0 ? 0 : Math.min(sceneReserve - 1, Math.floor(timestampMs / width)))
  const place = (timestampMs: number): boolean => {
    if (scenes.some((timestamp) => Math.abs(timestamp - timestampMs) <= minGapMs)) return false
    let nearestIndex = -1
    let nearestDistance = Number.POSITIVE_INFINITY
    for (let index = 0; index < anchors.length; index += 1) {
      const distance = Math.abs(anchors[index] - timestampMs)
      if (distance <= minGapMs && distance < nearestDistance) {
        nearestDistance = distance
        nearestIndex = index
      }
    }
    if (nearestIndex >= 0) {
      const anchor = anchors[nearestIndex]
      if (anchor >= timestampMs) return false
      anchors[nearestIndex] = timestampMs
      replaced = true
      return true
    }
    scenes.push(timestampMs)
    return true
  }

  for (const candidate of ranked) {
    if (scenes.length >= sceneReserve) break
    const bin = binOf(candidate.timestampMs)
    if (filledBins.has(bin) || !place(candidate.timestampMs)) continue
    filledBins.add(bin)
  }

  if (scenes.length < sceneReserve) {
    const leftovers = ranked
      .filter((candidate) => !filledBins.has(binOf(candidate.timestampMs)) && !scenes.includes(candidate.timestampMs))
      .map((candidate) => ({
        timestampMs: candidate.timestampMs,
        score: candidate.score,
        distance: Math.min(...[...anchors, ...scenes].map((anchor) => Math.abs(anchor - candidate.timestampMs)))
      }))
      .sort((left, right) => right.distance - left.distance || right.score - left.score)
    for (const candidate of leftovers) {
      if (scenes.length >= sceneReserve) break
      const bin = binOf(candidate.timestampMs)
      if (filledBins.has(bin) || !place(candidate.timestampMs)) continue
      filledBins.add(bin)
    }
  }

  scenes.sort((left, right) => left - right)
  return { backbone: anchors, scenes, replaced }
}
