import { mergeAttributes, Node } from '@tiptap/core'
import Math from '@tiptap/extension-mathematics'
import { ReactNodeViewRenderer } from '@tiptap/react'

import MathPlaceholderNodeView from '../components/placeholder/MathPlaceholderNodeView'

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    mathPlaceholder: {
      insertMathPlaceholder: (options?: { mathType?: 'block' | 'inline' }) => ReturnType
    }
  }
}

// Enhanced Math extension that emits events instead of using prompt
export const EnhancedMath = Math.extend({
  addCommands() {
    return {
      ...this.parent?.(),
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
    const base = (this.parent?.() as any[]) || []
    return [
      ...base,
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
            }),
            'Math equation placeholder - click to edit'
          ]
        },

        addNodeView() {
          return ReactNodeViewRenderer(MathPlaceholderNodeView)
        },

        addCommands() {
          return {
            insertMathPlaceholder:
              (options: { mathType?: 'block' | 'inline' } = {}) =>
              ({ commands }) => {
                return commands.insertContent({
                  type: this.name,
                  attrs: {
                    mathType: options.mathType || 'block'
                  }
                })
              }
          }
        }
      })
    ]
  }
})
