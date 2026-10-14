import type { Element, ElementContent, Root } from 'hast'
import type { ParseError } from 'katex'
import { type Pluggable, type Plugin, unified } from 'unified'
import { SKIP, visit } from 'unist-util-visit'

function closedBoundaries(source: string): number[] {
  const boundaries = [0]
  let groups = 0
  let delimiters = 0
  let awaitingDelimiter = false
  const environments: string[] = []
  const tokens = /\\(?:begin|end)\s*\{([^{}]*)\}|\\[a-zA-Z]+|\\[\s\S]|%[^\n]*(?:\n|$)|[\s\S]/gu

  for (const match of source.matchAll(tokens)) {
    const token = match[0]
    if (token === '{') groups += 1
    if (token === '}') groups -= 1
    if (groups === 0) {
      const delimiterToken = awaitingDelimiter && token.trim() !== '' && !token.startsWith('%')
      if (delimiterToken) awaitingDelimiter = false
      if (match[1] !== undefined) {
        if (token.startsWith('\\begin')) environments.push(match[1])
        else if (environments.at(-1) === match[1]) environments.pop()
      }
      if (token === '\\left') delimiters += 1
      if (token === '\\right') delimiters -= 1
      if (token === '\\left' || token === '\\right') awaitingDelimiter = true
    }
    if (groups === 0 && delimiters === 0 && !awaitingDelimiter && environments.length === 0 && token !== '\\') {
      boundaries.push(match.index + token.length)
    }
  }
  return boundaries
}

/** Render only a closed, KaTeX-valid prefix while a math source is growing. */
export const rehypeStreamingMath: Plugin<[Pluggable], Root> = function (mathRenderer) {
  const renderer = unified().use([mathRenderer])

  return (tree, file) => {
    visit(tree, 'element', (element, index, parent) => {
      if (index === undefined || !parent) return
      const firstChild = element.children[0]
      const mathElement =
        element.tagName === 'pre' && firstChild?.type === 'element' && firstChild.tagName === 'code'
          ? firstChild
          : element
      const classes = mathElement.properties.className
      if (
        !Array.isArray(classes) ||
        !classes.some((name) => ['language-math', 'math-display', 'math-inline'].includes(String(name)))
      ) {
        return
      }

      const source = mathElement.children.map((child) => (child.type === 'text' ? child.value : '')).join('')
      const boundaries = closedBoundaries(source)
      let end = source.length
      let output: ElementContent[] = []

      while (end > 0) {
        const candidate: Element = { ...mathElement, children: [{ type: 'text', value: source.slice(0, end) }] }
        const root: Root = {
          type: 'root',
          children: [mathElement === element ? candidate : { ...element, children: [candidate] }]
        }
        const messageCount = file.messages.length
        const rendered = renderer.runSync(root, file) as Root
        const messages = file.messages.splice(messageCount)
        const failure = messages.find((message) => message.source === 'rehype-katex')
        if (!failure) {
          output = rendered.children as ElementContent[]
          break
        }

        // KaTeX's error position skips suffixes that cannot repair an earlier invalid token.
        const cause = failure.cause as ParseError | undefined
        const limit = cause?.name === 'ParseError' && Number.isFinite(cause.position) ? cause.position : end
        while (boundaries.length && (boundaries.at(-1)! >= end || boundaries.at(-1)! > limit)) boundaries.pop()
        end = boundaries.pop() ?? 0
      }

      parent.children.splice(index, 1, ...output)
      return [SKIP, index + output.length]
    })
  }
}
