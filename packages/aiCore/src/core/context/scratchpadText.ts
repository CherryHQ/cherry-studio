/** Model scratchpad wrappers named in compaction prompts and observed in leaked transcripts. */
export const MODEL_SCRATCHPAD_TAG_NAMES = ['analysis', 'assessment', 'thinking'] as const

const MODEL_SCRATCHPAD_TAG_SET = new Set<string>(MODEL_SCRATCHPAD_TAG_NAMES)

/** Paired-tag opener; self-closing tags (`<thinking />`) are excluded. */
const PAIRED_TAG_OPEN_SUFFIX = '(?:\\s+(?:[^/>]|"[^"]*"|\'[^\']*\')*)?>'

const SCRATCHPAD_OPENING_TAG = new RegExp(
  `^\\s*<(${MODEL_SCRATCHPAD_TAG_NAMES.join('|')})${PAIRED_TAG_OPEN_SUFFIX}`,
  'i'
)
const NON_SCRATCHPAD_OPENING_TAG = new RegExp(`^\\s*<([a-z][a-z0-9-]*)${PAIRED_TAG_OPEN_SUFFIX}`, 'i')

function isSelfClosingTagOpener(opener: string): boolean {
  return /\/\s*>$/.test(opener)
}
const CODE_FENCE_PLACEHOLDER_PREFIX = '\uE000CODE_FENCE_'
const CODE_FENCE_PLACEHOLDER_SUFFIX = '\uE001'
const CODE_FENCE_PLACEHOLDER = new RegExp(`${CODE_FENCE_PLACEHOLDER_PREFIX}(\\d+)${CODE_FENCE_PLACEHOLDER_SUFFIX}`, 'g')

function fenceLinePrefixStart(text: string, fenceMarkerIndex: number): number {
  const lineStart = text.lastIndexOf('\n', fenceMarkerIndex - 1) + 1
  const prefix = text.slice(lineStart, fenceMarkerIndex)
  return /^(?:> ?)+$/.test(prefix) ? lineStart : fenceMarkerIndex
}

function isCodeFenceMarkerAtLineStart(text: string, markerStart: number): boolean {
  const lineStart = text.lastIndexOf('\n', markerStart - 1) + 1
  const prefix = text.slice(lineStart, markerStart)
  if (/^(?:(?: {1,3})|(?:> ?)*)*$/.test(prefix)) {
    return true
  }
  return /<\/(?:analysis|assessment|thinking)\s*>$/i.test(prefix)
}

function maskCodeFences(text: string): { text: string; fences: string[] } {
  const fences: string[] = []
  let out = ''
  let pos = 0

  while (pos < text.length) {
    const rel = text.slice(pos).search(/[`~]{3,}/)
    if (rel === -1) {
      out += text.slice(pos)
      break
    }
    const markerStart = pos + rel
    if (!isCodeFenceMarkerAtLineStart(text, markerStart)) {
      out += text.slice(pos, markerStart + 1)
      pos = markerStart + 1
      continue
    }
    const fenceStart = fenceLinePrefixStart(text, markerStart)
    out += text.slice(pos, fenceStart)
    const openMatch = text.slice(markerStart).match(/^([`~])\1{2,}/)
    if (!openMatch) {
      out += text[fenceStart]
      pos = fenceStart + 1
      continue
    }

    const fenceChar = openMatch[1]
    const fenceLen = openMatch[0].length
    const afterOpen = markerStart + openMatch[0].length
    const closePattern = new RegExp(
      `(?:\\r\\n|\\n)(?:(?:> ?)+)?[ \\t]*\\${fenceChar}{${fenceLen},}[ \\t]*(?:\\r\\n|\\n|$)`
    )
    const closeMatch = closePattern.exec(text.slice(afterOpen))
    if (!closeMatch) {
      const fenceEnd = text.length
      fences.push(text.slice(fenceStart, fenceEnd))
      out += `${CODE_FENCE_PLACEHOLDER_PREFIX}${fences.length - 1}${CODE_FENCE_PLACEHOLDER_SUFFIX}`
      pos = fenceEnd
      continue
    }

    const fenceEnd = afterOpen + closeMatch.index + closeMatch[0].length
    fences.push(text.slice(fenceStart, fenceEnd))
    out += `${CODE_FENCE_PLACEHOLDER_PREFIX}${fences.length - 1}${CODE_FENCE_PLACEHOLDER_SUFFIX}`
    pos = fenceEnd
  }

  return { text: out, fences }
}

function unmaskCodeFences(text: string, fences: string[]): string {
  return text.replace(CODE_FENCE_PLACEHOLDER, (_, index) => fences[Number(index)] ?? '')
}

/** True when the text opens a fenced code block that has no closing delimiter yet. */
export function textHasUnclosedCodeFence(text: string): boolean {
  let pos = 0
  while (pos < text.length) {
    const rel = text.slice(pos).search(/[`~]{3,}/)
    if (rel === -1) return false
    const markerStart = pos + rel
    if (!isCodeFenceMarkerAtLineStart(text, markerStart)) {
      pos = markerStart + 1
      continue
    }
    const openMatch = text.slice(markerStart).match(/^([`~])\1{2,}/)
    if (!openMatch) {
      pos = markerStart + 1
      continue
    }

    const fenceChar = openMatch[1]
    const fenceLen = openMatch[0].length
    const afterOpen = markerStart + openMatch[0].length
    const closePattern = new RegExp(
      `(?:\\r\\n|\\n)(?:(?:> ?)+)?[ \\t]*\\${fenceChar}{${fenceLen},}[ \\t]*(?:\\r\\n|\\n|$)`
    )
    const closeMatch = closePattern.exec(text.slice(afterOpen))
    if (!closeMatch) return true
    pos = afterOpen + closeMatch.index + closeMatch[0].length
  }
  return false
}

function isModelScratchpadTagName(tag: string): boolean {
  return MODEL_SCRATCHPAD_TAG_SET.has(tag.toLowerCase())
}

export function textStartsWithModelScratchpadTag(text: string): boolean {
  const match = text.match(SCRATCHPAD_OPENING_TAG)
  if (!match || !isModelScratchpadTagName(match[1])) {
    return false
  }
  return !isSelfClosingTagOpener(match[0])
}

/** Opening markup that is not a known model scratchpad wrapper (e.g. `<p>`, `<thinking-note>`). */
export function textStartsWithNonScratchpadOpeningTag(text: string): boolean {
  const trimmed = text.trimStart()
  if (!trimmed.startsWith('<') || !trimmed.includes('>')) {
    return false
  }
  if (textStartsWithModelScratchpadTag(trimmed)) {
    return false
  }
  const match = trimmed.match(NON_SCRATCHPAD_OPENING_TAG)
  return match ? !isSelfClosingTagOpener(match[0]) : false
}

/** Strips known scratchpad wrappers without touching fenced code blocks. */
export function stripKnownModelScratchpadBlocksPreservingCodeFences(raw: string): string {
  const { text: masked, fences } = maskCodeFences(raw)
  const stripped = stripKnownModelScratchpadBlocks(masked)
  return unmaskCodeFences(stripped, fences)
}

/** Strips only known model scratchpad wrappers; leaves other markup intact. */
export function stripKnownModelScratchpadBlocks(raw: string): string {
  let out = raw
  let previous: string
  do {
    previous = out
    for (const tag of MODEL_SCRATCHPAD_TAG_NAMES) {
      const block = new RegExp(`<${tag}${PAIRED_TAG_OPEN_SUFFIX}[\\s\\S]*?<\\/${tag}\\s*>`, 'gi')
      out = out.replace(block, '')
    }
  } while (out !== previous)
  return out
}

/** Removes model scratchpad scaffolding from compaction output (see {@link MODEL_SCRATCHPAD_TAG_NAMES}). */
function unwrapWholeSummaryWrapper(text: string): string | null {
  const trimmed = text.trim()
  const opening = /^<summary\b[^>]*>/i.exec(trimmed)
  if (!opening) {
    return null
  }

  const closing = /<\/summary\s*>$/i.exec(trimmed)
  if (!closing || closing.index === undefined) {
    return null
  }

  return trimmed.slice(opening[0].length, closing.index)
}

export function stripModelScratchpadBlocks(raw: string): string {
  const { text: masked, fences } = maskCodeFences(raw)
  let out = stripKnownModelScratchpadBlocks(masked)

  const unwrapped = unwrapWholeSummaryWrapper(out)
  if (unwrapped !== null) {
    out = unwrapped
  }

  out = unmaskCodeFences(out, fences)
  return out.replace(/\n{3,}/g, '\n\n').trim()
}
