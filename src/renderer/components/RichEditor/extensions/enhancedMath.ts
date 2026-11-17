import { Extension, InputRule, mergeAttributes, Node } from '@tiptap/core'
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

const findFirstDelimiter = (source: string, delimiters: string[]): number => {
  const positions = delimiters.map((delimiter) => source.indexOf(delimiter)).filter((position) => position >= 0)
  return positions.length > 0 ? Math.min(...positions) : -1
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
      BlockMath.extend({
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
        },
        markdownTokenizer: {
          name: 'blockMath',
          level: 'block',
          start: (source: string) => findFirstDelimiter(source, ['$$', '\\[']),
          tokenize: (source: string) => {
            const bracketMatch = source.match(/^\\\[([\s\S]*?)\\\]/)
            if (bracketMatch) return { type: 'blockMath', raw: bracketMatch[0], latex: bracketMatch[1].trim() }
            const dollarMatch = source.match(/^\$\$([^$]+)\$\$/)
            return dollarMatch ? { type: 'blockMath', raw: dollarMatch[0], latex: dollarMatch[1].trim() } : undefined
          }
        }
      }).configure({ ...this.options.blockOptions, katexOptions: this.options.katexOptions }),
      InlineMath.extend({
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
        },
        markdownTokenizer: {
          name: 'inlineMath',
          level: 'inline',
          start: (source: string) => findFirstDelimiter(source, ['$', '\\(']),
          tokenize: (source: string) => {
            const parenMatch = source.match(/^\\\(([^\n]*?)\\\)/)
            if (parenMatch) return { type: 'inlineMath', raw: parenMatch[0], latex: parenMatch[1].trim() }
            const dollarMatch = source.match(/^\$([^$]+)\$(?!\$)/)
            return dollarMatch ? { type: 'inlineMath', raw: dollarMatch[0], latex: dollarMatch[1].trim() } : undefined
          }
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
