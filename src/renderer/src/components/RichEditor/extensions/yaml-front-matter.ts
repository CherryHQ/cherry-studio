import { mergeAttributes, Node } from '@tiptap/core'
import { ReactNodeViewRenderer } from '@tiptap/react'

import YamlFrontMatterNodeView from '../components/YamlFrontMatterNodeView'

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    yamlFrontMatter: {
      insertYamlFrontMatter: (content?: string) => ReturnType
    }
  }
}

export const YamlFrontMatter = Node.create({
  name: 'yamlFrontMatter',
  group: 'block',
  atom: true,
  draggable: false,

  addOptions() {
    return {
      HTMLAttributes: {}
    }
  },

  addAttributes() {
    return {
      content: {
        default: '',
        parseHTML: (element) => {
          const dataContent = element.getAttribute('data-content')
          if (dataContent) {
            // Decode HTML entities that might be in the data-content attribute
            const textarea = document.createElement('textarea')
            textarea.innerHTML = dataContent
            return textarea.value
          }
          return element.textContent || ''
        },
        renderHTML: (attributes) => ({
          'data-content': attributes.content
        })
      }
    }
  },

  parseHTML() {
    return [
      {
        tag: 'div[data-type="yaml-front-matter"]',
        getAttrs: (element) => {
          if (typeof element === 'string') return false

          const htmlElement = element as HTMLElement
          const dataContent = htmlElement.getAttribute('data-content')
          const textContent = htmlElement.textContent || ''

          return {
            content: dataContent || textContent
          }
        }
      }
    ]
  },

  renderHTML({ HTMLAttributes, node }) {
    const content = node.attrs.content || ''
    return [
      'div',
      mergeAttributes(HTMLAttributes, {
        'data-type': 'yaml-front-matter',
        'data-content': content
      }),
      content
    ]
  },

  addCommands() {
    return {
      insertYamlFrontMatter:
        (content = '') =>
        ({ commands }) => {
          return commands.insertContent({
            type: this.name,
            attrs: {
              content
            }
          })
        }
    }
  },

  addNodeView() {
    return ReactNodeViewRenderer(YamlFrontMatterNodeView)
  },

  addInputRules() {
    return []
  }
})
