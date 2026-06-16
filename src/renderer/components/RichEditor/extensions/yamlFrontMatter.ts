import { type MarkdownToken, mergeAttributes, Node } from '@tiptap/core'
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

  // Native markdown parse/serialize. YAML front matter (`---` … `---`) is not part of
  // standard markdown, so it needs its own marked tokenizer to be picked up by @tiptap/markdown.
  markdownTokenizer: {
    name: 'yamlFrontMatter',
    level: 'block',
    start(src: string) {
      return src.match(/^---\n/) ? 0 : -1
    },
    tokenize(src: string, tokens: MarkdownToken[] = []) {
      // Front matter is only valid at the very top of the document.
      const hasExistingContent = tokens.some((token) => token.type && token.type !== 'space')
      if (hasExistingContent) {
        return undefined
      }

      const match = /^---\n([\s\S]*?)\n---(?:\n|$)/.exec(src)
      if (!match) {
        return undefined
      }

      return {
        type: 'yamlFrontMatter',
        raw: match[0],
        text: match[1] // YAML body without the `---` delimiters
      }
    }
  },

  parseMarkdown(token, helpers) {
    return helpers.createNode('yamlFrontMatter', { content: token.text || '' })
  },

  renderMarkdown(node) {
    const content = node.attrs?.content || ''
    if (!content.trim()) {
      return ''
    }
    // The stored content has no delimiters; add them back. Tolerate the legacy case
    // where a trailing `---` was kept inside the content attribute.
    if (content.endsWith('---')) {
      return `---\n${content}\n\n`
    }
    return `---\n${content}\n---\n\n`
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
        tag: 'div[data-type="yamlFrontMatter"]',
        getAttrs: (element) => {
          if (typeof element === 'string') return false

          const htmlElement = element
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
        'data-type': 'yamlFrontMatter',
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
