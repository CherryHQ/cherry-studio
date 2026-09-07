const CJK_SENTENCE_ENDINGS = '。！？'
const ASCII_SENTENCE_ENDINGS = '.!?'
const NORMALIZED_WHITESPACE_PATTERN = /\s+/g
const WHITESPACE_CHARACTER_PATTERN = /\s/
const CONTINUATION_MARKER_LENGTH = 32

export interface ThinkingPreviewScanState {
  contentLength: number
  continuationMarker: string
  latestCompletedSegment: string
  nextIndex: number
  segmentStart: number
}

interface ThinkingPreviewScanResult {
  preview: string
  state: ThinkingPreviewScanState
}

export function normalizeThinkingPreview(content: string): string {
  return content.replace(NORMALIZED_WHITESPACE_PATTERN, ' ').trim()
}

export function scanThinkingPreview(
  content: string,
  previousState?: ThinkingPreviewScanState
): ThinkingPreviewScanResult {
  // processUIMessageStream assembles a streaming reasoning part with `text += delta`.
  // A fixed-size marker also detects unexpected tail rewrites without comparing the full prefix.
  const continuationMarkerStart = previousState
    ? Math.max(0, previousState.contentLength - previousState.continuationMarker.length)
    : 0
  const canContinue =
    previousState !== undefined &&
    content.length > previousState.contentLength &&
    content.slice(continuationMarkerStart, previousState.contentLength) === previousState.continuationMarker
  let latestCompletedSegment = canContinue ? previousState.latestCompletedSegment : ''
  let index = canContinue ? previousState.nextIndex : 0
  let segmentStart = canContinue ? previousState.segmentStart : 0

  while (index < content.length - 1) {
    const character = content[index]
    const nextCharacter = content[index + 1]
    const isLineEnding = character === '\n' || character === '\r'
    const isFollowingCjkSentenceEnding = CJK_SENTENCE_ENDINGS.includes(nextCharacter)
    const isSentenceEnding =
      (CJK_SENTENCE_ENDINGS.includes(character) && !isFollowingCjkSentenceEnding) ||
      (ASCII_SENTENCE_ENDINGS.includes(character) && WHITESPACE_CHARACTER_PATTERN.test(nextCharacter))

    if (!isLineEnding && !isSentenceEnding) {
      index += 1
      continue
    }

    const segmentEnd = isLineEnding ? index : index + 1
    const completedSegment = normalizeThinkingPreview(content.slice(segmentStart, segmentEnd))
    if (completedSegment) latestCompletedSegment = completedSegment

    index += character === '\r' && nextCharacter === '\n' ? 2 : 1
    segmentStart = index
  }

  const trailingCharacter = content[index]
  const isTrailingLineEnding = trailingCharacter === '\n' || trailingCharacter === '\r'
  const isTrailingCjkSentenceEnding = CJK_SENTENCE_ENDINGS.includes(trailingCharacter)
  let preview = latestCompletedSegment
  if (isTrailingLineEnding) {
    const completedSegment = normalizeThinkingPreview(content.slice(segmentStart, index))
    if (completedSegment) latestCompletedSegment = completedSegment
    index += 1
    segmentStart = index
    preview = latestCompletedSegment
  } else if (isTrailingCjkSentenceEnding) {
    // Show it immediately, but leave the cursor on the punctuation in case the
    // next chunk appends another CJK sentence ending that belongs to this segment.
    const completedSegment = normalizeThinkingPreview(content.slice(segmentStart, index + 1))
    if (completedSegment) preview = completedSegment
  }

  return {
    preview,
    state: {
      contentLength: content.length,
      continuationMarker: content.slice(-CONTINUATION_MARKER_LENGTH),
      latestCompletedSegment,
      nextIndex: index,
      segmentStart
    }
  }
}
