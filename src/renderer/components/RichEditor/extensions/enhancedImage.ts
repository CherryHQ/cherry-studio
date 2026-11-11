import { mergeAttributes, Node } from '@tiptap/core'
import Image, { type ImageOptions } from '@tiptap/extension-image'
import { ReactNodeViewRenderer } from '@tiptap/react'

import ImagePlaceholderNodeView from '../components/placeholder/ImagePlaceholderNodeView'

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    imagePlaceholder: {
      insertImagePlaceholder: () => ReturnType
    }
  }
}

interface EnhancedImageOptions extends ImageOptions {
  enableInputRules: boolean
  /** Maps the stored destination to the URL to display; returns null when it cannot be resolved. */
  resolveSrc?: (src: string) => string | null
}

const MARKDOWN_SRC_ATTRIBUTE = 'data-markdown-src'

// Enhanced Image extension that emits events for image upload
export const EnhancedImage = Image.extend<EnhancedImageOptions>({
  addOptions() {
    // @tiptap/extension-image@3.26 made `inline`/`resize` required options. Spreading the
    // optional `this.parent?.()` widens them to optional, so cast back to our extended
    // option type — the parent extension always provides the real defaults at runtime.
    return {
      ...this.parent?.(),
      allowBase64: true,
      enableInputRules: true,
      HTMLAttributes: {
        class: 'rich-editor-image'
      }
    } as EnhancedImageOptions
  },

  addInputRules() {
    return this.options.enableInputRules ? (this.parent?.() ?? []) : []
  },

  addAttributes() {
    const { resolveSrc } = this.options
    return {
      ...this.parent?.(),
      src: {
        default: null,
        // Copied or dragged images carry the stored destination, not the resolved display URL.
        parseHTML: (element) => element.getAttribute(MARKDOWN_SRC_ATTRIBUTE) ?? element.getAttribute('src'),
        renderHTML: (attributes) => {
          if (!attributes.src) {
            return {}
          }
          const displaySrc = resolveSrc?.(attributes.src)
          if (!displaySrc || displaySrc === attributes.src) {
            return {
              src: attributes.src
            }
          }
          return {
            src: displaySrc,
            [MARKDOWN_SRC_ATTRIBUTE]: attributes.src
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
