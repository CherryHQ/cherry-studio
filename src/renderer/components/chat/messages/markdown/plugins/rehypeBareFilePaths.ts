import type { Element, Root, RootContent, Text } from 'hast'
import { isKnownNavigationPath } from '@shared/utils/navigationPath'
import type { Plugin } from 'unified'

export type BareFilePathPlatform = 'posix' | 'windows'

export interface BareFilePathMatch {
  start: number
  end: number
  path: string
}

export const BARE_FILE_PATH_PROPERTY = 'cherryBareFilePath'

const SKIPPED_ELEMENTS = new Set([
  'a',
  'button',
  'code',
  'input',
  'kbd',
  'math',
  'option',
  'pre',
  'samp',
  'script',
  'select',
  'span',
  'style',
  'svg',
  'textarea'
])
const QUOTE_PAIRS = new Map([
  ['"', '"'],
  ["'", "'"],
  ['“', '”'],
  ['‘', '’']
])
const TRAILING_PUNCTUATION = new Set(['.', ',', ';', ':', '!', '?', '。', '，', '；', '：', '！', '？'])
const SENTENCE_PUNCTUATION = new Set([...TRAILING_PUNCTUATION].filter((character) => character !== '.'))
const WORD_CHARACTER_PATTERN = /[\p{L}\p{N}_]/u
const HTTP_METHOD_CONTEXT_PATTERN = /(?:^|\s)(?:GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS|TRACE|CONNECT)\s*[:=]?\s*$/u
const PATTERN_CONTEXT_PATTERN = /(?:^|\s)(?:regex|regexp|正则(?:表达式)?)\s*[:=]?\s*$/iu
const CONTEXT_LOOKBEHIND_LENGTH = 32

function hasControlCharacter(value: string): boolean {
  return Array.from(value).some((character) => {
    const codePoint = character.codePointAt(0)
    return codePoint !== undefined && (codePoint <= 31 || codePoint === 127)
  })
}

function isBoundary(value: string, index: number): boolean {
  if (index === 0) return true
  const previous = value[index - 1]
  const context = value.slice(Math.max(0, index - CONTEXT_LOOKBEHIND_LENGTH), index)
  return (
    !WORD_CHARACTER_PATTERN.test(previous) &&
    previous !== '/' &&
    previous !== '\\' &&
    previous !== ':' &&
    !HTTP_METHOD_CONTEXT_PATTERN.test(context) &&
    !PATTERN_CONTEXT_PATTERN.test(context)
  )
}

function isUnquotedTerminator(character: string): boolean {
  return /\s/u.test(character) || hasControlCharacter(character) || '<>`"\'|'.includes(character)
}

function isLikelySentenceBoundary(
  value: string,
  pathStart: number,
  index: number,
  platform: BareFilePathPlatform
): boolean {
  const character = value[index]
  if (!character || !SENTENCE_PUNCTUATION.has(character)) return false
  if (platform === 'windows' && character === ':') return false

  // A punctuation mark in the middle of a filename (for example
  // `/tmp/report,final.txt`) is part of the path. Once a complete filename
  // has already been seen, punctuation followed by prose is a sentence
  // boundary instead of another path character.
  const prefix = value.slice(pathStart, index)
  if (!hasClearFileExtension(prefix)) return false
  const suffix = value.slice(index + 1)
  if (!suffix) return true
  const next = suffix[0]
  return Boolean(next && WORD_CHARACTER_PATTERN.test(next) && next !== '/' && next !== '\\')
}

function trimUnmatchedClosingBrackets(value: string): string {
  const pairs = [
    ['(', ')'],
    ['[', ']'],
    ['{', '}'],
    ['（', '）'],
    ['【', '】'],
    ['［', '］'],
    ['｛', '｝']
  ] as const
  const balances = new Map<string, number>(pairs.map(([opening]) => [opening, 0]))
  const closingToOpening = new Map<string, string>(pairs.map(([opening, closing]) => [closing, opening]))

  for (const character of value) {
    if (balances.has(character)) balances.set(character, (balances.get(character) ?? 0) + 1)
    const opening = closingToOpening.get(character)
    if (opening) balances.set(opening, (balances.get(opening) ?? 0) - 1)
  }

  let end = value.length
  while (end > 0) {
    const finalCharacter = value[end - 1]
    if (finalCharacter && TRAILING_PUNCTUATION.has(finalCharacter)) {
      end -= 1
      continue
    }

    const opening = finalCharacter ? closingToOpening.get(finalCharacter) : undefined
    if (opening && (balances.get(opening) ?? 0) < 0) {
      balances.set(opening, (balances.get(opening) ?? 0) + 1)
      end -= 1
      continue
    }
    break
  }

  return value.slice(0, end)
}

function hasValidSegments(value: string, separatorPattern: RegExp): boolean {
  const segments = value.split(separatorPattern)
  return segments.some(Boolean) && segments.every((segment) => segment !== '.' && segment !== '..')
}

function isValidPosixPath(value: string): boolean {
  if (value === '/' || value === '~/' || value.startsWith('//')) return false

  if (value.startsWith('~/')) return hasValidSegments(value.slice(2), /\//)
  if (!value.startsWith('/')) return false
  return hasValidSegments(value.slice(1), /\//)
}

function isValidWindowsPath(value: string): boolean {
  const locationSuffix = value.match(/(?::\d+){1,2}$/u)?.[0] ?? ''
  const pathWithoutLocation = locationSuffix ? value.slice(0, -locationSuffix.length) : value
  const invalidTailPattern = /[<>:"|?*]/

  if (/^[A-Za-z]:[\\/]/.test(pathWithoutLocation)) {
    const tail = pathWithoutLocation.slice(3)
    return !invalidTailPattern.test(tail) && (tail.length === 0 || hasValidSegments(tail, /[\\/]/))
  }

  if (pathWithoutLocation.startsWith('~\\') || pathWithoutLocation.startsWith('~/')) {
    const tail = pathWithoutLocation.slice(2)
    return tail.length > 0 && !invalidTailPattern.test(tail) && hasValidSegments(tail, /[\\/]/)
  }

  if (!pathWithoutLocation.startsWith('\\\\')) return false
  const segments = pathWithoutLocation.slice(2).split(/[\\/]/)
  return (
    segments.length >= 2 &&
    segments[0].length > 0 &&
    segments[1].length > 0 &&
    !invalidTailPattern.test(pathWithoutLocation.slice(2))
  )
}

function isValidPath(value: string, platform: BareFilePathPlatform, allowWhitespace: boolean): boolean {
  if (platform === 'windows' && isKnownNavigationPath(value)) return true
  if (!value || hasControlCharacter(value) || (!allowWhitespace && /\s/u.test(value))) return false
  if (value.trim() !== value) return false
  return platform === 'windows' ? isValidWindowsPath(value) : isValidPosixPath(value)
}

function startsPath(value: string, index: number, platform: BareFilePathPlatform): boolean {
  if (!isBoundary(value, index)) return false

  if (platform === 'posix') {
    return value.startsWith('~/', index) || (value[index] === '/' && value[index + 1] !== '/')
  }

  return (
    ((value.startsWith('/app/', index) || value.startsWith('/settings/', index)) && value[index] === '/') ||
    value.startsWith('~\\', index) ||
    value.startsWith('~/', index) ||
    value.startsWith('\\\\', index) ||
    (/^[A-Za-z]$/.test(value[index] ?? '') && value[index + 1] === ':' && /[\\/]/.test(value[index + 2] ?? ''))
  )
}

function collectClosingQuotePositions(value: string): Map<string, number[]> {
  const positions = new Map<string, number[]>()
  for (const closingQuote of new Set(QUOTE_PAIRS.values())) positions.set(closingQuote, [])
  for (let index = 0; index < value.length; index += 1) {
    positions.get(value[index])?.push(index)
  }
  return positions
}

function findClosingQuote(positions: readonly number[], start: number): number {
  let low = 0
  let high = positions.length
  while (low < high) {
    const middle = Math.floor((low + high) / 2)
    if (positions[middle] < start) low = middle + 1
    else high = middle
  }
  return positions[low] ?? -1
}

function looksLikeUnquotedPathContinuation(value: string, end: number): boolean {
  if (value[end] !== ' ' && value[end] !== '\t') return false
  let nextStart = end
  while (value[nextStart] === ' ' || value[nextStart] === '\t') nextStart += 1
  let nextEnd = nextStart
  while (nextEnd < value.length && !isUnquotedTerminator(value[nextEnd])) nextEnd += 1
  const nextToken = trimUnmatchedClosingBrackets(value.slice(nextStart, nextEnd))
  if (startsPath(value, nextStart, 'posix') || startsPath(value, nextStart, 'windows')) return false
  if (/[，。；：！？（）【】「」“”‘’]/u.test(nextToken)) return false
  return /[\\/]/.test(nextToken) || /\.[\p{L}\p{N}]+$/u.test(nextToken)
}

function hasClearFileExtension(value: string): boolean {
  const finalSegment = value.split(/[\\/]/).at(-1) ?? ''
  return /^[^.].*\.[\p{L}\p{N}][\p{L}\p{N}_+-]*$/u.test(finalSegment)
}

export function findBareFilePathMatches(value: string, platform: BareFilePathPlatform): BareFilePathMatch[] {
  const matches: BareFilePathMatch[] = []
  const closingQuotePositions = collectClosingQuotePositions(value)

  for (let index = 0; index < value.length; index += 1) {
    const closingQuote = QUOTE_PAIRS.get(value[index])
    if (closingQuote && startsPath(value, index + 1, platform)) {
      const closingIndex = findClosingQuote(closingQuotePositions.get(closingQuote) ?? [], index + 1)
      if (closingIndex > index + 1) {
        const quotedValue = value.slice(index + 1, closingIndex)
        if (isValidPath(quotedValue, platform, true)) {
          matches.push({ start: index + 1, end: closingIndex, path: quotedValue })
          index = closingIndex
          continue
        }
        index = closingIndex
        continue
      }
      if (closingIndex === -1) {
        let rawEnd = index + 1
        while (rawEnd < value.length && !isUnquotedTerminator(value[rawEnd])) rawEnd += 1
        index = Math.max(index, rawEnd - 1)
        continue
      }
    }

    if (!startsPath(value, index, platform)) continue

    let end = index
    while (
      end < value.length &&
      !isUnquotedTerminator(value[end]) &&
      !isLikelySentenceBoundary(value, index, end, platform)
    )
      end += 1
    let candidate = trimUnmatchedClosingBrackets(value.slice(index, end))
    while (platform === 'posix' && !hasClearFileExtension(candidate) && looksLikeUnquotedPathContinuation(value, end)) {
      let nextStart = end
      while (value[nextStart] === ' ' || value[nextStart] === '\t') nextStart += 1
      let nextEnd = nextStart
      while (
        nextEnd < value.length &&
        !isUnquotedTerminator(value[nextEnd]) &&
        !isLikelySentenceBoundary(value, nextStart, nextEnd, platform)
      )
        nextEnd += 1
      end = nextEnd
      candidate = trimUnmatchedClosingBrackets(value.slice(index, end))
    }
    const scannedEnd = end
    if (end < value.length && hasControlCharacter(value[end]) && !['\t', '\n', '\r'].includes(value[end])) {
      index = Math.max(index, scannedEnd - 1)
      continue
    }
    if (!isValidPath(candidate, platform, /\s/u.test(candidate))) {
      index = Math.max(index, scannedEnd - 1)
      continue
    }

    matches.push({ start: index, end: index + candidate.length, path: candidate })
    index = Math.max(index + candidate.length - 1, scannedEnd - 1)
  }

  return matches
}

function createMarker(path: string): Element {
  return {
    type: 'element',
    tagName: 'span',
    properties: { [BARE_FILE_PATH_PROPERTY]: path },
    children: [{ type: 'text', value: path }]
  }
}

function isSkippedElement(node: Element): boolean {
  if (SKIPPED_ELEMENTS.has(node.tagName)) return true
  const className = node.properties?.className
  const classes = Array.isArray(className) ? className : typeof className === 'string' ? className.split(/\s+/) : []
  return classes.some((value) => typeof value === 'string' && value.startsWith('katex'))
}

function splitTextNode(node: Text, platform: BareFilePathPlatform): RootContent[] {
  const matches = findBareFilePathMatches(node.value, platform)
  if (matches.length === 0) return [node]

  const children: RootContent[] = []
  let cursor = 0
  for (const match of matches) {
    if (match.start > cursor) children.push({ type: 'text', value: node.value.slice(cursor, match.start) })
    children.push(createMarker(match.path))
    cursor = match.end
  }
  if (cursor < node.value.length) children.push({ type: 'text', value: node.value.slice(cursor) })
  return children
}

function transformChildren(parent: Root | Element, platform: BareFilePathPlatform): void {
  const transformedChildren: RootContent[] = []

  for (const child of parent.children) {
    if (child.type === 'text') {
      transformedChildren.push(...splitTextNode(child, platform))
      continue
    }

    if (child.type === 'element') {
      if (child.properties?.[BARE_FILE_PATH_PROPERTY] !== undefined || isSkippedElement(child)) {
        transformedChildren.push(child)
        continue
      }
      transformChildren(child, platform)
    }
    transformedChildren.push(child)
  }

  parent.children = transformedChildren
}

interface RehypeBareFilePathsOptions {
  platform: BareFilePathPlatform
}

export const rehypeBareFilePaths: Plugin<[RehypeBareFilePathsOptions], Root> = ({ platform }) => {
  return (tree) => transformChildren(tree, platform)
}
