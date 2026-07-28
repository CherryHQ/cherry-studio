import { Extension, InputRule, mergeAttributes, Node } from '@tiptap/core'
import { BlockMath, InlineMath } from '@tiptap/extension-mathematics'
import { ReactNodeViewRenderer } from '@tiptap/react'

import MathPlaceholderNodeView from '../components/placeholder/MathPlaceholderNodeView'

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    enhancedMath: {
      insertMathPlaceholder: (options?: { mathType?: 'block' | 'inline' }) => ReturnType
    }
  }
}

export const EnhancedMath = Extension.create({
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
      InlineMath.extend({
        addInputRules() {
          return [
            new InputRule({
              find: /(^|[^$])(\$([^$\n]+?)\$)(?!\$)/,
              handler: ({ state, range, match }) => {
                const latex = match[3]
                const { tr } = state
                const start = range.from
                const end = range.to

                tr.replaceWith(start, end, this.type.create({ latex }))
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
