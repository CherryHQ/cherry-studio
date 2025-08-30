import { mergeAttributes, Node } from '@tiptap/core'
import Image from '@tiptap/extension-image'
import { ReactNodeViewRenderer } from '@tiptap/react'

import ImagePlaceholderNodeView from '../components/placeholder/ImagePlaceholderNodeView'

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    imagePlaceholder: {
      insertImagePlaceholder: () => ReturnType
    }
  }
}

// Enhanced Image extension that emits events for image upload
export const EnhancedImage = Image.extend({
  addOptions() {
    return {
      ...this.parent?.(),
      allowBase64: true,
      HTMLAttributes: {
        class: 'rich-editor-image'
      }
    }
  },

  addAttributes() {
    return {
      ...this.parent?.(),
      src: {
        default: null,
        parseHTML: (element) => element.getAttribute('src'),
        renderHTML: (attributes) => {
          if (!attributes.src) {
            return {}
          }
          return {
            src: attributes.src
          }
        }
      },
      alt: {
        default: null
      },
      title: {
        default: null
      },
      width: {
        default: null
      },
      height: {
        default: null
      }
    }
  },

  addCommands() {
    return {
      ...this.parent?.(),
      insertImagePlaceholder:
        () =>
        ({ commands }) => {
          return commands.insertContent({
            type: 'imagePlaceholder',
            attrs: {}
          })
        }
    }
  },

  addExtensions() {
    const base = (this.parent?.() as any[]) || []
    return [
      ...base,
      Node.create({
        name: 'imagePlaceholder',
        group: 'block',
        content: 'block+',
        atom: true,
        draggable: true,

        addOptions() {
          return {
            HTMLAttributes: {}
          }
        },

        parseHTML() {
          return [
            {
              tag: 'div[data-type="image-placeholder"]'
            }
          ]
        },

        renderHTML({ HTMLAttributes }) {
          return [
            'div',
            mergeAttributes(HTMLAttributes, {
              'data-type': 'image-placeholder'
            })
          ]
        },

        addNodeView() {
          return ReactNodeViewRenderer(ImagePlaceholderNodeView)
        },

        addCommands() {
          return {
            insertImagePlaceholder:
              () =>
              ({ commands }) => {
                return commands.insertContent({
                  type: this.name,
                  attrs: {}
                })
              }
          }
        }
      })
    ]
  }
})
