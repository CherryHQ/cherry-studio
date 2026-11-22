import { Extension, InputRule, type MarkdownToken, mergeAttributes, Node } from '@tiptap/core'
import { BlockMath, InlineMath, type MathematicsOptions } from '@tiptap/extension-mathematics'
import { ReactNodeViewRenderer } from '@tiptap/react'

import MathPlaceholderNodeView from '../components/placeholder/MathPlaceholderNodeView'

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    enhancedMath: {
      insertMathPlaceholder: (options?: { mathType?: 'block' | 'inline' }) => ReturnType
    }
  }
}

// EnhancedMath takes the same options as upstream Mathematics (block/inline/katex).
export type EnhancedMathOptions = MathematicsOptions

const mathSourceAttributes = {
  delimiter: {
    default: null,
    parseHTML: (element: HTMLElement) => element.getAttribute('data-math-delimiter'),
    renderHTML: (attrs: { delimiter?: unknown }) => (attrs.delimiter ? { 'data-math-delimiter': attrs.delimiter } : {})
  },
  markdownSource: {
    default: null,
    parseHTML: (element: HTMLElement) => {
      const raw = element.getAttribute('data-math-source')
      if (raw === null) return null
      return {
        raw,
        latex: element.getAttribute('data-math-source-latex') ?? element.getAttribute('data-latex') ?? ''
      }
    },
    renderHTML: (attrs: { markdownSource?: { raw?: unknown; latex?: unknown } | null }) => {
      const source = attrs.markdownSource
      return source ? { 'data-math-source': source.raw, 'data-math-source-latex': source.latex } : {}
    }
  }
}

const wrapped = new WeakSet<object>()
const roots = new WeakMap<object, string[]>()
let lexingProtectedSpans = false
const protectedSpans = new WeakMap<object, Map<string, { references: string; spans: Map<number, number> }>>()
const protectedTypes = new Set(['codespan', 'link', 'autolink', 'url', 'html'])

const backslashMath = (block: boolean) => {
  const name = block ? 'backslashBlockMath' : 'backslashInlineMath'
  // Marked can reuse token arrays for different sources. Reuse pairs only for verified suffixes.
  const scans = new WeakMap<object, { src: string; pairs: Map<number, number> }>()
  return Extension.create({
    name,
    parseMarkdown: (token) => ({
      type: block ? 'blockMath' : 'inlineMath',
      attrs: {
        latex: token.latex,
        delimiter: token.delimiter,
        markdownSource: { raw: token.markdownSourceRaw ?? token.raw, latex: token.latex }
      }
    }),
    markdownTokenizer: {
      name,
      level: block ? 'block' : 'inline',
      start: (src) => {
        if (lexingProtectedSpans) return -1
        if (!block) return src.indexOf('\\')
        const candidate = /\n {0,3}\\\[[ \t]*\n/.exec(src)
        return candidate ? candidate.index + 1 : -1
      },
      tokenize: (src, tokens, helper) => {
        if (lexingProtectedSpans) return undefined
        if (block) {
          const { lexer } = helper as typeof helper & {
            lexer?: {
              blockTokens?: (src: string, tokens?: MarkdownToken[], lastParagraphClipped?: boolean) => MarkdownToken[]
            }
          }
          if (lexer && typeof lexer.blockTokens === 'function') {
            if (!wrapped.has(lexer)) {
              // Installation can happen inside a nested call; only wrapped calls have trusted roots.
              const stack: string[] = []
              const original = lexer.blockTokens
              lexer.blockTokens = function (source, ...args) {
                stack.push(source)
                try {
                  return original.call(this, source, ...args)
                } finally {
                  stack.pop()
                }
              }
              roots.set(lexer, stack)
              wrapped.add(lexer)
            }
          }
          const root = lexer ? roots.get(lexer)?.at(-1) : undefined
          if (root !== undefined && src.length <= root.length && root.endsWith(src)) {
            const start = root.length - src.length
            if (start !== 0 && root[start - 1] !== '\n') return undefined
          } else if (tokens.length && !tokens.at(-1)?.raw?.endsWith('\n')) {
            return undefined
          }
        }
        const opener = block ? /^ {0,3}(\\\[)[ \t]*\n/.exec(src) : /^(\\[[(])/.exec(src)
        if (!opener) return undefined
        const offset = block ? src.indexOf('\\[') : 0
        const open = src[offset + 1]
        const close = open === '[' ? ']' : ')'
        let scan = scans.get(tokens)
        const suffixStart = scan ? scan.src.length - src.length : -1
        const isSuffix = scan && suffixStart >= 0 && scan.src.slice(suffixStart) === src
        let precedingSlashes = 0
        if (scan && isSuffix) {
          for (let i = suffixStart - 1; i >= 0 && scan.src[i] === '\\'; i--) precedingSlashes++
        }
        if (!scan || !isSuffix || precedingSlashes % 2 !== 0) {
          const pairs = new Map<number, number>()
          const stacks: Record<'[' | '(', number[]> = { '[': [], '(': [] }
          const excluded = new Map<number, number>()
          const protectedStarts = new Set<number>()
          let protectedEnd = 0
          const parenStarts: number[] = []
          // Escaped brackets (including math openers) cannot start a Marked link.
          const needsMask =
            (src.includes('\\[') || src.includes('\\(')) &&
            /[`<@]|(?:https?|ftp):\/\/|www\.|(?:^|[^\\])(?:\\\\)*\[/i.test(src)
          if (needsMask) {
            const lexer = (helper as typeof helper & { lexer?: { options: object; tokens: { links: unknown } } }).lexer
            const instance = lexer?.options ?? helper
            const references = JSON.stringify(lexer?.tokens.links ?? {})
            let cache = protectedSpans.get(instance)
            if (!cache) {
              cache = new Map()
              protectedSpans.set(instance, cache)
            }
            const cached = cache.get(src)
            let spans = cached?.references === references ? cached.spans : undefined
            if (!spans) {
              spans = new Map()
              lexingProtectedSpans = true
              try {
                // The active lexer carries this Marked instance's options and reference definitions.
                let offset = 0
                for (const token of helper.inlineTokens(src)) {
                  const raw = token.raw ?? ''
                  if (raw === '') continue
                  const end = offset + raw.length
                  if (token.type !== undefined && protectedTypes.has(token.type)) spans.set(offset, end)
                  offset = end
                }
              } finally {
                lexingProtectedSpans = false
              }
              if (cache.size >= 32) cache.delete(cache.keys().next().value!)
              cache.set(src, { references, spans })
            }
            for (const [start, end] of spans) {
              excluded.set(start, end)
              protectedStarts.add(start)
            }
          }
          const accept = (start: number, end: number) => {
            excluded.set(start, end)
            if (src.slice(start, end).includes('\n')) parenStarts.length = 0
          }
          for (let i = 0; i < src.length;) {
            const skip = excluded.get(i)
            if (skip !== undefined) {
              protectedEnd = skip
              if (src.slice(i, skip).includes('\n')) parenStarts.length = 0
              i = skip
              continue
            }
            if (src[i] === '$') {
              // Match upstream dollar tokenizers, including escaped closing dollars.
              const rest = src.slice(i)
              const match = /^\$\$([^$]+)\$\$/.exec(rest) ?? /^\$([^$]+)\$(?!\$)/.exec(rest)
              if (match) {
                const end = i + match[0].length
                accept(i, end)
                i = end
              } else i++
              continue
            }
            if (src[i] === '\n') {
              parenStarts.length = 0
            }
            if (src[i] === '\\') {
              const next = src[i + 1]
              if (next === '\n') {
                parenStarts.length = 0
              }
              if (next === '(') parenStarts.push(i)
              else if (next === ')') {
                const start = parenStarts.at(-1)
                if (start !== undefined && start >= protectedEnd) {
                  parenStarts.pop()
                  if (!block) pairs.set(src.length - start, src.length - (i + 2))
                  accept(start, i + 2)
                }
              }
              i += 2
              continue
            }
            i++
          }
          protectedEnd = 0
          let lineStart = 0
          let blockFallback: number | undefined
          for (let i = 0; i < src.length; i++) {
            if (src[i] === '\n') lineStart = i + 1
            const skip = excluded.get(i)
            if (skip !== undefined && (!block || !protectedStarts.has(i))) {
              if (protectedStarts.has(i)) protectedEnd = skip
              const lastNewline = src.slice(i, skip).lastIndexOf('\n')
              if (lastNewline >= 0) {
                lineStart = i + lastNewline + 1
                if (!block) {
                  stacks['['] = []
                  stacks['('] = []
                }
              }
              i = skip - 1
              continue
            }
            if (!block && src[i] === '\n') {
              stacks['['] = []
              stacks['('] = []
            }
            if (src[i] !== '\\') continue
            if (block && (i - lineStart > 3 || !/^ {0,3}$/.test(src.slice(lineStart, i)))) {
              i++
              continue
            }
            const next = src[++i]
            if (next === '\n') lineStart = i + 1
            if (!block && next === '\n') {
              stacks['['] = []
              stacks['('] = []
            }
            if (next === '[' || next === '(') {
              if (!block || stacks[next].length === 0) stacks[next].push(i - 1)
            } else if (next === ']' || next === ')') {
              const stack = stacks[next === ']' ? '[' : '(']
              // Only inline pairs compete with Marked spans for their closer.
              if (!block && stack.length && stack[stack.length - 1] < protectedEnd) continue
              if (block) {
                let tail = i + 1
                while (src[tail] === ' ' || src[tail] === '\t') tail++
                if (tail < src.length && src[tail] !== '\n' && !src.startsWith('\\[', i + 1)) {
                  blockFallback ??= i + 1
                  continue
                }
                blockFallback = undefined
              }
              const start = stacks[next === ']' ? '[' : '('].pop()
              if (start !== undefined) pairs.set(src.length - start, src.length - (i + 1))
            }
          }
          if (blockFallback !== undefined && stacks['['].length) {
            pairs.set(src.length - stacks['['][0], src.length - blockFallback)
          }
          scan = { src, pairs }
          scans.set(tokens, scan)
        }
        const remaining = scan.pairs.get(src.length - offset)
        if (remaining === undefined) return undefined
        const end = src.length - remaining
        const raw = src.slice(0, end)
        const body = src.slice(offset + 2, end - 2)
        const latex = block
          ? body.replace(/^[ \t]*\n/, '').replace(/\n {0,3}$/, '')
          : body.replace(/\\[\s\S]/g, (pair) => (pair === `\\${open}` || pair === `\\${close}` ? '' : pair)).trim()
        return { type: name, raw, markdownSourceRaw: raw, latex, delimiter: open === '[' ? 'bracket' : 'paren' }
      }
    }
  })
}

export const EnhancedMath = Extension.create<EnhancedMathOptions>({
  name: 'enhancedMath',

  addOptions() {
    return {
      inlineOptions: undefined,
      blockOptions: undefined,
      katexOptions: undefined
    }
  },

  addCommands() {
    return {
      insertMathPlaceholder:
        (options: { mathType?: 'block' | 'inline' } = {}) =>
        ({ commands }) => {
          return commands.insertContent({
            type: 'mathPlaceholder',
            attrs: {
              mathType: options.mathType || 'block'
            }
          })
        }
    }
  },

  addExtensions() {
    return [
      backslashMath(false),
      BlockMath.extend({
        addAttributes() {
          return { ...this.parent?.(), ...mathSourceAttributes }
        },
        renderMarkdown(node) {
          const { latex = '', delimiter, markdownSource } = node.attrs ?? {}
          if (!delimiter) return ['$$', latex || '', '$$'].join('\n')
          if (markdownSource && latex === markdownSource.latex) return markdownSource.raw
          return ['\\[', latex, '\\]'].join('\n')
        },
        renderText({ node }) {
          const latex = node.attrs.latex
          return latex ? ['$$', latex, '$$'].join('\n') : ''
        },
        addInputRules() {
          return [
            new InputRule({
              find: /^\$\$([^$]+)\$\$$/,
              handler: ({ state, range, match }) => {
                const [, latex] = match
                const { tr } = state
                const start = range.from
                const end = range.to
                tr.replaceWith(start, end, this.type.create({ latex }))
              }
            })
          ]
        }
      }).configure({ ...this.options.blockOptions, katexOptions: this.options.katexOptions }),
      backslashMath(true),
      InlineMath.extend({
        addAttributes() {
          return { ...this.parent?.(), ...mathSourceAttributes }
        },
        renderMarkdown(node, _helpers, context) {
          const { latex = '', delimiter, markdownSource } = node.attrs ?? {}
          if (!delimiter) return `$${latex || ''}$`
          if (markdownSource && latex === markdownSource.latex) return markdownSource.raw
          const close = delimiter === 'paren' ? '\\)' : '\\]'
          const parent = context?.meta?.parentNode
          const canPromote =
            context?.parentType === 'paragraph' &&
            parent?.content?.length === 1 &&
            ['doc', 'blockquote'].includes(context?.meta?.grandparentType)
          if (
            canPromote &&
            (latex.includes('\n') || latex.includes(close) || latex !== latex.trim()) &&
            !/^ {0,3}\\\]/m.test(latex) &&
            !latex.includes('$')
          ) {
            return ['\\[', latex, '\\]'].join('\n')
          }
          return delimiter === 'paren' ? `\\(${latex}\\)` : `\\[${latex}\\]`
        },
        renderText({ node }) {
          const latex = node.attrs.latex
          return latex ? `$${latex}$` : ''
        },
        addInputRules() {
          return [
            new InputRule({
              find: /(?<!\$)(\$([^$\n]+?)\$)(?!\$)$/,
              handler: ({ state, range, match }): void | null => {
                let containsNonText = false

                state.doc.nodesBetween(range.from, range.to, (node) => {
                  if (node.isInline && !node.isText) {
                    containsNonText = true
                  }
                })

                if (containsNonText) return null

                const latex = match[2]
                const { tr } = state

                tr.replaceWith(range.from, range.to, this.type.create({ latex }))
              }
            })
          ]
        }
      }).configure({ ...this.options.inlineOptions, katexOptions: this.options.katexOptions }),
      Node.create({
        name: 'mathPlaceholder',
        group: 'block',
        atom: true,
        draggable: true,

        addOptions() {
          return {
            HTMLAttributes: {}
          }
        },

        addAttributes() {
          return {
            mathType: {
              default: 'block',
              parseHTML: (element) => element.getAttribute('data-math-type'),
              renderHTML: (attributes) => ({
                'data-math-type': attributes.mathType
              })
            }
          }
        },

        parseHTML() {
          return [
            {
              tag: 'div[data-type="math-placeholder"]'
            }
          ]
        },

        renderHTML({ HTMLAttributes }) {
          return [
            'div',
            mergeAttributes(HTMLAttributes, {
              'data-type': 'math-placeholder'
            })
          ]
        },

        addNodeView() {
          return ReactNodeViewRenderer(MathPlaceholderNodeView)
        }
      })
    ]
  }
})
