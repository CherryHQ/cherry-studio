import type { Data, InlineMath, Link, Math, Paragraph, PhrasingContent, Root, RootContent, Text } from 'mdast'
import type { CompileContext, Extension as FromMarkdownExtension } from 'mdast-util-from-markdown'
import type { Construct, Extension as MicromarkExtension, State, Token, Tokenizer } from 'micromark-util-types'
import type { Plugin } from 'unified'
import type { Parent, Position } from 'unist'
import { visit } from 'unist-util-visit'

declare module 'micromark-util-types' {
  interface TokenTypeMap {
    latexDelimitedMath: 'latexDelimitedMath'
    latexDirectMath: 'latexDirectMath'
    latexDirectMathData: 'latexDirectMathData'
    latexEnvironmentMath: 'latexEnvironmentMath'
    latexMathData: 'latexMathData'
  }
}

declare module 'mdast' {
  interface Math {
    type: 'math'
    value: string
    meta?: string | null | undefined
    data?: Data | undefined
    position?: Position | undefined
  }

  interface InlineMath {
    type: 'inlineMath'
    value: string
    data?: Data | undefined
    position?: Position | undefined
  }

  interface PhrasingContentMap {
    inlineMath: InlineMath
  }

  interface RootContentMap {
    inlineMath: InlineMath
    math: Math
  }
}

type LatexMathKind = 'bracket' | 'environment' | 'paren'

interface LatexMathData extends Data {
  latexMathKind?: LatexMathKind
}

const BACKSLASH = 92
const DOLLAR = 36
const OPEN_PAREN = 40
const CLOSE_PAREN = 41
const OPEN_BRACKET = 91
const CLOSE_BRACKET = 93
const SPACE = 32
const ENVIRONMENT_NAMES = new Set([
  'equation',
  'equation*',
  'align',
  'align*',
  'aligned',
  'gather',
  'gather*',
  'gathered',
  'multline',
  'multline*'
])

function removeNestedDelimiters(value: string, kind: Exclude<LatexMathKind, 'environment'>): string {
  const open = kind === 'paren' ? OPEN_PAREN : OPEN_BRACKET
  const close = kind === 'paren' ? CLOSE_PAREN : CLOSE_BRACKET
  let result = ''

  for (let index = 0; index < value.length; index += 1) {
    if (value.charCodeAt(index) !== BACKSLASH || index + 1 === value.length) {
      result += value[index]
      continue
    }

    const marker = value.charCodeAt(index + 1)
    if (marker === open || marker === close) {
      index += 1
      continue
    }

    result += value.slice(index, index + 2)
    index += 1
  }

  return result
}

const latexDelimitedMath: Construct = {
  name: 'latexDelimitedMath',
  tokenize: function tokenizeLatexDelimitedMath(effects, ok, nok) {
    let open = 0
    let close = 0
    let depth = 1

    return start

    function start(code: number | null): State | undefined {
      if (code !== BACKSLASH) return nok(code)
      effects.enter('latexDelimitedMath')
      effects.consume(code)
      return openingMarker
    }

    function openingMarker(code: number | null): State | undefined {
      if (code === OPEN_PAREN) {
        open = OPEN_PAREN
        close = CLOSE_PAREN
      } else if (code === OPEN_BRACKET) {
        open = OPEN_BRACKET
        close = CLOSE_BRACKET
      } else {
        return nok(code)
      }
      effects.consume(code)
      return contentStart
    }

    function contentStart(code: number | null): State | undefined {
      if (code === null) return nok(code)
      if (code <= -3) {
        effects.enter('lineEnding')
        effects.consume(code)
        effects.exit('lineEnding')
        return contentStart
      }
      effects.enter('latexMathData')
      return content(code)
    }

    function content(code: number | null): State | undefined {
      if (code === null || code <= -3) {
        effects.exit('latexMathData')
        return code === null ? nok(code) : contentStart(code)
      }
      effects.consume(code)
      return code === BACKSLASH ? afterBackslash : content
    }

    function afterBackslash(code: number | null): State | undefined {
      if (code === null) return nok(code)
      effects.consume(code)
      if (code === open) depth += 1
      if (code === close) depth -= 1
      if (depth === 0) {
        effects.exit('latexMathData')
        effects.exit('latexDelimitedMath')
        return ok
      }
      return content
    }
  } satisfies Tokenizer
}

const latexNonLazyContinuation: Construct = {
  partial: true,
  tokenize: function tokenizeLatexNonLazyContinuation(effects, ok, nok) {
    const lineStart = (code: number | null): State | undefined => {
      return this.parser.lazy[this.now().line] ? nok(code) : ok(code)
    }

    return start

    function start(code: number | null): State | undefined {
      if (code === null) return ok(code)
      effects.enter('lineEnding')
      effects.consume(code)
      effects.exit('lineEnding')
      return lineStart
    }
  } satisfies Tokenizer
}

const latexDirectMath: Construct = {
  name: 'latexDirectMath',
  concrete: true,
  tokenize: function tokenizeLatexDirectMath(effects, ok, nok) {
    const beginPrefix = 'begin{'
    let indentation = 0
    let fenceSize = 0
    let prefixIndex = 0
    let environmentName = ''
    let opening = ''
    let closing = ''
    let candidate = ''
    let candidateIndex = 0
    let candidateDepth = 0
    let depth = 1
    let remainingFence = 0

    return start

    function start(code: number | null): State | undefined {
      effects.enter('latexDirectMath')
      return linePrefix(code)
    }

    function linePrefix(code: number | null): State | undefined {
      if (code === SPACE && indentation < 3) {
        indentation += 1
        effects.consume(code)
        return linePrefix
      }
      return openingFence(code)
    }

    function openingFence(code: number | null): State | undefined {
      if (code === DOLLAR) {
        fenceSize += 1
        effects.consume(code)
        return openingFence
      }
      if (fenceSize < 2 || code !== BACKSLASH) return nok(code)
      effects.consume(code)
      return begin
    }

    function begin(code: number | null): State | undefined {
      if (code !== beginPrefix.charCodeAt(prefixIndex)) return nok(code)
      effects.consume(code)
      prefixIndex += 1
      return prefixIndex === beginPrefix.length ? name : begin
    }

    function name(code: number | null): State | undefined {
      if (code === 125) {
        if (!environmentName) return nok(code)
        effects.consume(code)
        opening = `\\begin{${environmentName}}`
        closing = `\\end{${environmentName}}`
        return contentStart
      }
      if (code === null || !/[A-Za-z*]/.test(String.fromCharCode(code))) return nok(code)
      environmentName += String.fromCharCode(code)
      effects.consume(code)
      return name
    }

    function contentStart(code: number | null): State | undefined {
      if (code === null) return nok(code)
      if (code <= -3) return effects.attempt(latexNonLazyContinuation, contentStart, nok)(code)
      effects.enter('latexDirectMathData')
      return content(code)
    }

    function content(code: number | null): State | undefined {
      if (code === null) return nok(code)
      if (code <= -3) {
        effects.exit('latexDirectMathData')
        return effects.attempt(latexNonLazyContinuation, contentStart, nok)(code)
      }
      effects.consume(code)
      return code === BACKSLASH ? candidateStart : content
    }

    function candidateStart(code: number | null): State | undefined {
      if (code === opening.charCodeAt(1)) {
        candidate = opening
        candidateDepth = 1
      } else if (code === closing.charCodeAt(1)) {
        candidate = closing
        candidateDepth = -1
      } else {
        return content(code)
      }
      candidateIndex = 1
      return candidateMatch(code)
    }

    function candidateMatch(code: number | null): State | undefined {
      if (code !== candidate.charCodeAt(candidateIndex)) return content(code)
      effects.consume(code)
      candidateIndex += 1
      if (candidateIndex !== candidate.length) return candidateMatch

      depth += candidateDepth
      if (depth === 0) {
        remainingFence = fenceSize
        return closingFence
      }
      return content
    }

    function closingFence(code: number | null): State | undefined {
      if (remainingFence > 0) {
        if (code !== DOLLAR) return nok(code)
        remainingFence -= 1
        effects.consume(code)
        return closingFence
      }
      if (code === SPACE || code === 9) {
        effects.consume(code)
        return closingFence
      }
      if (code !== null && code > -3) return nok(code)
      effects.exit('latexDirectMathData')
      effects.exit('latexDirectMath')
      return ok(code)
    }
  } satisfies Tokenizer
}

const latexEnvironmentMath: Construct = {
  name: 'latexEnvironmentMath',
  previous(code) {
    return code === null || code <= -3 || code === 32
  },
  tokenize: function tokenizeLatexEnvironmentMath(effects, ok, nok) {
    const startColumn = this.now().column
    const beginPrefix = 'begin{'
    let prefixIndex = 0
    let environmentName = ''
    let opening = ''
    let closing = ''
    let candidate = ''
    let candidateIndex = 0
    let candidateDepth = 0
    let depth = 1

    return start

    function start(code: number | null): State | undefined {
      if (code !== BACKSLASH || startColumn > 4) return nok(code)
      effects.enter('latexEnvironmentMath')
      effects.consume(code)
      return begin
    }

    function begin(code: number | null): State | undefined {
      if (code !== beginPrefix.charCodeAt(prefixIndex)) return nok(code)
      effects.consume(code)
      prefixIndex += 1
      return prefixIndex === beginPrefix.length ? name : begin
    }

    function name(code: number | null): State | undefined {
      if (code === 125) {
        if (!ENVIRONMENT_NAMES.has(environmentName)) return nok(code)
        effects.consume(code)
        opening = `\\begin{${environmentName}}`
        closing = `\\end{${environmentName}}`
        return contentStart
      }
      if (code === null || !/[A-Za-z*]/.test(String.fromCharCode(code))) return nok(code)
      environmentName += String.fromCharCode(code)
      effects.consume(code)
      return name
    }

    function contentStart(code: number | null): State | undefined {
      if (code === null) return nok(code)
      if (code <= -3) {
        effects.enter('lineEnding')
        effects.consume(code)
        effects.exit('lineEnding')
        return contentStart
      }
      effects.enter('latexMathData')
      return content(code)
    }

    function content(code: number | null): State | undefined {
      if (code === null || code <= -3) {
        effects.exit('latexMathData')
        return code === null ? nok(code) : contentStart(code)
      }
      effects.consume(code)
      if (code !== BACKSLASH) return content
      return candidateStart
    }

    function candidateStart(code: number | null): State | undefined {
      if (code === opening.charCodeAt(1)) {
        candidate = opening
        candidateDepth = 1
      } else if (code === closing.charCodeAt(1)) {
        candidate = closing
        candidateDepth = -1
      } else {
        return content(code)
      }
      candidateIndex = 1
      return candidateMatch(code)
    }

    function candidateMatch(code: number | null): State | undefined {
      if (code !== candidate.charCodeAt(candidateIndex)) return content(code)
      effects.consume(code)
      candidateIndex += 1
      if (candidateIndex !== candidate.length) return candidateMatch

      depth += candidateDepth
      if (depth === 0) {
        effects.exit('latexMathData')
        effects.exit('latexEnvironmentMath')
        return ok
      }
      return content
    }
  } satisfies Tokenizer
}

const latexMathSyntax: MicromarkExtension = {
  flowInitial: {
    [DOLLAR]: latexDirectMath,
    [SPACE]: latexDirectMath
  },
  text: {
    [BACKSLASH]: [latexDelimitedMath, latexEnvironmentMath]
  }
}

function createDirectMath(token: Token, context: CompileContext): void {
  const raw = context.sliceSerialize(token).trimStart()
  const fence = /^\${2,}/.exec(raw)?.[0]
  if (!fence) return
  const closingIndex = raw.lastIndexOf(fence)
  const value = raw.slice(fence.length, closingIndex)
  const node: Math = {
    type: 'math',
    meta: null,
    value,
    data: {
      hName: 'pre',
      hChildren: [
        {
          type: 'element',
          tagName: 'code',
          properties: { className: ['language-math', 'math-display'] },
          children: [{ type: 'text', value }]
        }
      ]
    }
  }
  context.enter(node, token)
}

function createInlineMath(token: Token, context: CompileContext): void {
  const raw = context.sliceSerialize(token)
  const kind: LatexMathKind = raw[1] === '(' ? 'paren' : raw[1] === '[' ? 'bracket' : 'environment'
  const value = kind === 'environment' ? raw : removeNestedDelimiters(raw.slice(2, -2), kind)

  const node: InlineMath = {
    type: 'inlineMath',
    value,
    data: {
      hName: 'code',
      hProperties: { className: ['language-math', 'math-inline'] },
      hChildren: [],
      latexMathKind: kind
    } as LatexMathData
  }
  context.enter(node, token)
  context.buffer()
}

function exitInlineMath(token: Token, context: CompileContext): void {
  context.resume()
  const node = context.stack[context.stack.length - 1]
  if (node.type !== 'inlineMath') return
  context.exit(token)
  node.data!.hChildren = [{ type: 'text', value: node.value }]
}

const latexMathFromMarkdown: FromMarkdownExtension = {
  canContainEols: ['latexDelimitedMath', 'latexDirectMath', 'latexEnvironmentMath'],
  enter: {
    latexDelimitedMath(this: CompileContext, token: Token) {
      createInlineMath(token, this)
    },
    latexDirectMath(this: CompileContext, token: Token) {
      createDirectMath(token, this)
    },
    latexEnvironmentMath(this: CompileContext, token: Token) {
      createInlineMath(token, this)
    }
  },
  exit: {
    latexMathData(this: CompileContext, token: Token) {
      this.config.enter.data.call(this, token)
      this.config.exit.data.call(this, token)
    },
    latexDelimitedMath(this: CompileContext, token: Token) {
      exitInlineMath(token, this)
    },
    latexDirectMath(this: CompileContext, token: Token) {
      this.exit(token)
    },
    latexEnvironmentMath(this: CompileContext, token: Token) {
      exitInlineMath(token, this)
    }
  }
}

function getLatexMathKind(node: InlineMath): LatexMathKind | undefined {
  return node.data?.latexMathKind
}

function toPlainText(node: InlineMath): Text {
  const kind = getLatexMathKind(node)
  const value = kind === 'paren' ? `(${node.value})` : kind === 'bracket' ? `[${node.value}]` : node.value
  return { type: 'text', value, position: node.position }
}

function isInlineMath(node: unknown): node is InlineMath {
  return typeof node === 'object' && node !== null && 'type' in node && node.type === 'inlineMath' && 'value' in node
}

function demoteLinkMath(node: Link): void {
  const demote = (parent: Parent): void => {
    parent.children = parent.children.map((child) => {
      if (isInlineMath(child) && getLatexMathKind(child)) return toPlainText(child)
      if ('children' in child && Array.isArray(child.children)) demote(child as Parent)
      return child
    })
  }
  demote(node)
}

function isIndependentEnvironment(node: InlineMath, source: string): boolean {
  const offset = node.position?.start.offset
  if (offset === undefined) return false
  const lineStart = Math.max(source.lastIndexOf('\n', offset - 1), source.lastIndexOf('\r', offset - 1)) + 1
  return /^ {0,3}$/.test(source.slice(lineStart, offset))
}

function demoteEmbeddedEnvironments(tree: Root, source: string): void {
  visit(tree, 'inlineMath', (node, index, parent) => {
    if (
      getLatexMathKind(node) === 'environment' &&
      !isIndependentEnvironment(node, source) &&
      parent &&
      typeof index === 'number'
    ) {
      parent.children[index] = toPlainText(node)
    }
  })
}

function isDisplayLatexMath(node: InlineMath): boolean {
  const kind = getLatexMathKind(node)
  return (
    kind === 'environment' ||
    (kind === 'bracket' && (node.value.includes('\n') || /\\(?:begin|tag)\b/.test(node.value)))
  )
}

function createDisplayMath(node: InlineMath): Math {
  return {
    type: 'math',
    meta: null,
    value: node.value,
    data: {
      hName: 'pre',
      hChildren: [
        {
          type: 'element',
          tagName: 'code',
          properties: { className: ['language-math', 'math-display'] },
          children: [{ type: 'text', value: node.value }]
        }
      ]
    },
    position: node.position
  }
}

function createParagraph(children: PhrasingContent[]): Paragraph | undefined {
  if (children.length === 0) return undefined
  const first = children[0]
  const last = children[children.length - 1]
  return {
    type: 'paragraph',
    children,
    position: first.position && last.position ? { start: first.position.start, end: last.position.end } : undefined
  }
}

function splitDisplayMath(paragraph: Paragraph): RootContent[] {
  const result: RootContent[] = []
  let phrasing: PhrasingContent[] = []

  for (const child of paragraph.children) {
    if (child.type !== 'inlineMath' || !isDisplayLatexMath(child)) {
      if (child.type === 'inlineMath') delete child.data?.latexMathKind
      phrasing.push(child)
      continue
    }

    const before = createParagraph(phrasing)
    if (before) result.push(before)
    result.push(createDisplayMath(child))
    phrasing = []
  }

  const after = createParagraph(phrasing)
  if (after) result.push(after)
  return result
}

function promoteDisplayMath(tree: Root): void {
  visit(tree, 'paragraph', (node, index, parent) => {
    if (
      !parent ||
      typeof index !== 'number' ||
      !node.children.some((child) => child.type === 'inlineMath' && isDisplayLatexMath(child))
    ) {
      return
    }
    const replacements = splitDisplayMath(node)
    parent.children.splice(index, 1, ...replacements)
    return index + replacements.length
  })
}

function repairMathMeta(tree: Root, source: string): void {
  visit(tree, 'math', (node) => {
    if (!/^\\(?:begin|tag)\b/.test(node.meta ?? '')) return
    const start = node.position?.start.offset
    const end = node.position?.end.offset
    if (start === undefined || end === undefined) return

    const raw = source.slice(start, end)
    const match = /^(\${2,})([^\r\n$]+)(\r\n|\n|\r)([\s\S]*[^\r\n])(?:\r\n|\n|\r)?\1[ \t]*$/.exec(raw)
    if (!match) return

    node.value = `${match[2]}${match[3]}${match[4]}`
    node.meta = null
    node.data = {
      hName: 'pre',
      hChildren: [
        {
          type: 'element',
          tagName: 'code',
          properties: { className: ['language-math', 'math-display'] },
          children: [{ type: 'text', value: node.value }]
        }
      ]
    }
  })
}

export const remarkLatexMath: Plugin<[], Root> = function remarkLatexMath() {
  const data = this.data()
  const micromarkExtensions = data.micromarkExtensions || (data.micromarkExtensions = [])
  const fromMarkdownExtensions = data.fromMarkdownExtensions || (data.fromMarkdownExtensions = [])
  micromarkExtensions.push(latexMathSyntax)
  fromMarkdownExtensions.push(latexMathFromMarkdown)

  return (tree, file) => {
    const source = String(file)
    visit(tree, 'link', demoteLinkMath)
    demoteEmbeddedEnvironments(tree, source)
    promoteDisplayMath(tree)
    repairMathMeta(tree, source)
  }
}
