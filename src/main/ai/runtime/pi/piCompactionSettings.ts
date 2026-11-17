import { MIN_INPUT_ROOM_RATIO } from '../../constants'
import { resolveInputRoom } from '../../contextBuild/resolveInputRoom'

/** Pi estimates tokens as chars / 4; reserve this share of the window against that estimate's error. */
const ESTIMATE_MARGIN_RATIO = 0.1
/** Summary input stays under the input room, leaving headroom for the summarizer prompt and framing. */
const SUMMARY_INPUT_RATIO = 0.8

export function resolvePiCompactionSettings(contextWindow: number, maxOutputTokens: number) {
  return {
    reserveTokens: Math.min(
      maxOutputTokens + Math.ceil(contextWindow * ESTIMATE_MARGIN_RATIO),
      Math.floor(contextWindow * (1 - MIN_INPUT_ROOM_RATIO))
    ),
    keepRecentTokens: Math.floor(contextWindow * MIN_INPUT_ROOM_RATIO)
  }
}

export function resolvePiSummaryInputBudget(contextWindow: number, maxOutputTokens: number): number {
  return Math.floor(resolveInputRoom(contextWindow, maxOutputTokens) * SUMMARY_INPUT_RATIO)
}
