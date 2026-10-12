/** Model scratchpad wrappers named in compaction prompts and observed in leaked transcripts. */
export const MODEL_SCRATCHPAD_TAG_NAMES = ['analysis', 'assessment', 'thinking'] as const

const MODEL_SCRATCHPAD_TAG_SET = new Set<string>(MODEL_SCRATCHPAD_TAG_NAMES)

type ParsedOpeningTag = {
  tagName: string
  opener: string
  isSelfClosing: boolean
}

/** Deterministic opener scan — avoids catastrophic backtracking from overlapping attribute regexes. */
function parseOpeningTagAt(text: string, offset: number): ParsedOpeningTag | null {
  if (text[offset] !== '<') return null
  const start = offset
  let i = offset + 1
  const nameMatch = /^[a-zA-Z][a-zA-Z0-9-]*/.exec(text.slice(i))
  if (!nameMatch) return null
  const tagName = nameMatch[0]
  i += nameMatch[0].length

  while (i < text.length) {
    while (i < text.length && (text[i] === ' ' || text[i] === '\t' || text[i] === '\n' || text[i] === '\r')) {
      i++
    }
    if (i >= text.length) return null

    if (text[i] === '>') {
      i++
      return { tagName, opener: text.slice(start, i), isSelfClosing: false }
    }
    if (text[i] === '/') {
      if (i + 1 < text.length && text[i + 1] === '>') {
        i += 2
        return { tagName, opener: text.slice(start, i), isSelfClosing: true }
      }
      return null
    }

    const attrNameMatch = /^[a-zA-Z_:][a-zA-Z0-9_:.-]*/.exec(text.slice(i))
    if (!attrNameMatch) return null
    i += attrNameMatch[0].length

    while (i < text.length && (text[i] === ' ' || text[i] === '\t')) i++
    if (i < text.length && text[i] === '=') {
      i++
      while (i < text.length && (text[i] === ' ' || text[i] === '\t')) i++
      if (i >= text.length) return null
      const quote = text[i]
      if (quote === '"' || quote === "'") {
        i++
        while (i < text.length && text[i] !== quote) i++
        if (i >= text.length) return null
        i++
      } else {
        while (i < text.length && text[i] !== ' ' && text[i] !== '\t' && text[i] !== '>' && text[i] !== '/') {
          i++
        }
      }
    }
  }
  return null
}

function parseLeadingOpeningTag(text: string): ParsedOpeningTag | null {
  const leadingWhitespace = text.match(/^\s*/)?.[0].length ?? 0
  const parsed = parseOpeningTagAt(text, leadingWhitespace)
  if (!parsed) return null
  const afterOpener = leadingWhitespace + parsed.opener.length
  if (afterOpener > text.length) return null
  return parsed
}
const CODE_FENCE_PLACEHOLDER_PREFIX = '\uE000CODE_FENCE_'
const CODE_FENCE_PLACEHOLDER_SUFFIX = '\uE001'
const CODE_FENCE_PLACEHOLDER = new RegExp(`${CODE_FENCE_PLACEHOLDER_PREFIX}(\\d+)${CODE_FENCE_PLACEHOLDER_SUFFIX}`, 'g')

function isValidFenceLinePrefix(prefix: string): boolean {
  let i = 0
  while (i < prefix.length) {
    if (prefix[i] === '>') {
      i++
      if (i < prefix.length && prefix[i] === ' ') i++
      continue
    }
    if (
      (prefix[i] === '-' || prefix[i] === '*' || prefix[i] === '+') &&
      i + 1 < prefix.length &&
      prefix[i + 1] === ' '
    ) {
      i += 2
      continue
    }
    if (prefix[i] >= '0' && prefix[i] <= '9') {
      while (i < prefix.length && prefix[i] >= '0' && prefix[i] <= '9') i++
      if (i + 1 < prefix.length && (prefix[i] === '.' || prefix[i] === ')') && prefix[i + 1] === ' ') {
        i += 2
        continue
      }
      return false
    }
    if (prefix[i] === ' ') {
      let spaces = 0
      while (i < prefix.length && prefix[i] === ' ' && spaces < 3) {
        i++
        spaces++
      }
      if (spaces === 0) return false
      continue
    }
    return false
  }
  return true
}

function fenceLinePrefixStart(text: string, fenceMarkerIndex: number): number {
  const lineStart = text.lastIndexOf('\n', fenceMarkerIndex - 1) + 1
  const prefix = text.slice(lineStart, fenceMarkerIndex)
  if (prefix.length > 0 && isValidFenceLinePrefix(prefix)) {
    return lineStart
  }
  return fenceMarkerIndex
}

function isInsideInlineCodeOnLine(text: string, markerStart: number): boolean {
  const lineStart = text.lastIndexOf('\n', markerStart - 1) + 1
  const lineSlice = text.slice(lineStart, markerStart)
  let backticks = 0
  for (let i = 0; i < lineSlice.length; i++) {
    if (lineSlice[i] === '`') backticks++
  }
  return backticks % 2 === 1
}

function isCodeFenceMarkerAtLineStart(text: string, markerStart: number): boolean {
  const lineStart = text.lastIndexOf('\n', markerStart - 1) + 1
  const prefix = text.slice(lineStart, markerStart)
  if (isValidFenceLinePrefix(prefix)) {
    return true
  }
  if (isInsideInlineCodeOnLine(text, markerStart)) {
    return false
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

/** True when a line ends with 1–2 backtick/tilde characters that may complete a fence on the next delta. */
export function textEndsWithPartialFenceMarker(text: string): boolean {
  return /(?:^|[\r\n])[^\r\n]*[`~]{1,2}$/.test(text)
}

/** True when scratchpad filtering should wait for more stream input before stripping. */
export function shouldDeferScratchpadStripping(text: string): boolean {
  return textHasUnclosedCodeFence(text) || textEndsWithPartialFenceMarker(text)
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
  const parsed = parseLeadingOpeningTag(text)
  if (!parsed || parsed.isSelfClosing || !isModelScratchpadTagName(parsed.tagName)) {
    return false
  }
  return true
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
  const parsed = parseLeadingOpeningTag(trimmed)
  return parsed ? !parsed.isSelfClosing : false
}

/** Strips known scratchpad wrappers without touching fenced code blocks. */
export function stripKnownModelScratchpadBlocksPreservingCodeFences(raw: string): string {
  const { text: masked, fences } = maskCodeFences(raw)
  const stripped = stripKnownModelScratchpadBlocks(masked)
  return unmaskCodeFences(stripped, fences)
}

function findScratchpadBlockEnd(text: string, openIndex: number, tagName: string, openerLength: number): number {
  const afterOpen = openIndex + openerLength
  const closePattern = new RegExp(`</${tagName}\\s*>`, 'i')
  const closeMatch = closePattern.exec(text.slice(afterOpen))
  if (!closeMatch || closeMatch.index === undefined) return -1
  return afterOpen + closeMatch.index + closeMatch[0].length
}

/** Strips only known model scratchpad wrappers; leaves other markup intact. */
export function stripKnownModelScratchpadBlocks(raw: string): string {
  let out = raw
  let changed = true
  while (changed) {
    changed = false
    let searchFrom = 0
    while (searchFrom < out.length) {
      const openIndex = out.indexOf('<', searchFrom)
      if (openIndex === -1) break
      const parsed = parseOpeningTagAt(out, openIndex)
      if (!parsed || parsed.isSelfClosing || !isModelScratchpadTagName(parsed.tagName)) {
        searchFrom = openIndex + 1
        continue
      }
      const end = findScratchpadBlockEnd(out, openIndex, parsed.tagName, parsed.opener.length)
      if (end === -1) {
        searchFrom = openIndex + 1
        continue
      }
      out = out.slice(0, openIndex) + out.slice(end)
      changed = true
      break
    }
  }
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
