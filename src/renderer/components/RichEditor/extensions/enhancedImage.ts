import { getRenderedAttributes, mergeAttributes, Node } from '@tiptap/core'
import Image, { type ImageOptions } from '@tiptap/extension-image'
import { ReactNodeViewRenderer } from '@tiptap/react'

import ImagePlaceholderNodeView from '../components/placeholder/ImagePlaceholderNodeView'
import { resolveImageSrc } from './resolveImageSrc'

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    imagePlaceholder: {
      insertImagePlaceholder: () => ReturnType
    }
  }
}

interface EnhancedImageOptions extends ImageOptions {
  /** Directory used to resolve relative image sources for display only. */
  imageBaseDir?: string
  enableInputRules: boolean
}

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

  addNodeView() {
    if (!this.options.imageBaseDir) return this.parent?.() ?? null

    return ({ node, HTMLAttributes }) => {
      const dom = document.createElement('img')
      const ownedAttributes = ['src', 'alt', 'title', 'width', 'height']
      const ownedClasses = new Set<string>()
      const extraAttributes = new Set<string>()
      const updateAttributes = (attributes: Record<string, unknown>) => {
        const merged = mergeAttributes(this.options.HTMLAttributes, attributes)
        for (const name of extraAttributes) {
          if (merged[name] == null) {
            dom.removeAttribute(name)
            extraAttributes.delete(name)
          }
        }
        for (const [name, value] of Object.entries(merged)) {
          if (
            ownedAttributes.includes(name) ||
            ['class', 'draggable', 'contenteditable'].includes(name) ||
            value == null
          ) {
            continue
          }
          dom.setAttribute(name, String(value))
          extraAttributes.add(name)
        }
        for (const name of ownedAttributes) {
          const value = merged[name]
          if (value == null) {
            dom.removeAttribute(name)
          } else {
            dom.setAttribute(name, name === 'src' ? resolveImageSrc(value, this.options.imageBaseDir) : String(value))
          }
        }
        const classes = new Set<string>(
          String(merged.class ?? '')
            .split(/\s+/)
            .filter(Boolean)
        )
        for (const token of ownedClasses) {
          if (!classes.has(token)) {
            dom.classList.remove(token)
            ownedClasses.delete(token)
          }
        }
        for (const token of classes) {
          if (!dom.classList.contains(token)) {
            dom.classList.add(token)
            ownedClasses.add(token)
          }
        }
      }
      updateAttributes(HTMLAttributes)

      return {
        dom,
        update: (updatedNode) => {
          if (updatedNode.type !== node.type) return false
          updateAttributes(getRenderedAttributes(updatedNode, this.editor.extensionManager.attributes))
          return true
        },
        ignoreMutation: () => true
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
