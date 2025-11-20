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

  // Custom tokenizer for YAML front matter
  markdownTokenizer: {
    name: 'yamlFrontMatter',
    level: 'block',

    start(src: string) {
      const result = src.match(/^---\n/) ? 0 : -1
      return result
    },
    // Parse YAML front matter
    tokenize(src: string) {
      // Match: ---\n...yaml content...\n---
      const match = /^---\n([\s\S]*?)\n---(?:\n|$)/.exec(src)

      if (!match) {
        return undefined
      }

      const token = {
        type: 'yamlFrontMatter',
        raw: match[0],
        text: match[1] // YAML content without delimiters
      }
      return token
    }
  },

  // Parse markdown token to Tiptap JSON
  parseMarkdown(token, helpers) {
    const attrs = {
      content: token.text || ''
    }

    return helpers.createNode('yamlFrontMatter', attrs)
  },

  // Serialize Tiptap node to markdown
  renderMarkdown(node) {
    const content = node.attrs?.content || ''
    if (!content.trim()) {
      return ''
    }

    let result = ''

    // Ensure proper format with opening and closing ---
    // The content is stored without the --- delimiters, so we need to add them back
    if (content.endsWith('---')) {
      // Content already has closing ---, just add opening
      result = '---\n' + content + '\n\n'
    } else {
      // Add both opening and closing ---
      result = '---\n' + content + '\n---\n\n'
    }
    return result
  },

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
