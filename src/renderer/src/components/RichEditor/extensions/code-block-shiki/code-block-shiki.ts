import { textblockTypeInputRule } from '@tiptap/core'
import CodeBlock, { type CodeBlockOptions } from '@tiptap/extension-code-block'
import { Plugin, PluginKey } from '@tiptap/pm/state'

import { CodeBlockNodeReactRenderer } from './CodeBlockNodeView'
import { ShikiPlugin } from './shikijsPlugin'

export interface CodeBlockShikiOptions extends CodeBlockOptions {
  defaultLanguage: string
  theme: string
}
export const CodeBlockShiki = CodeBlock.extend<CodeBlockShikiOptions>({
  addOptions() {
    return {
      ...this.parent?.(),
      languageClassPrefix: 'language-',
      exitOnTripleEnter: true,
      exitOnArrowDown: true,
      defaultLanguage: 'text',
      theme: 'one-light',
      HTMLAttributes: {
        class: 'code-block-shiki'
      }
    } as CodeBlockShikiOptions
  },

  addInputRules() {
    const parent = this.parent?.()

    return [
      ...(parent || []),
      // 支持动态语言匹配: ```语言名
      textblockTypeInputRule({
        find: /^```([a-zA-Z0-9#+\-_.]+)\s/,
        type: this.type,
        getAttributes: (match) => {
          const inputLanguage = match[1]?.toLowerCase().trim()
          if (!inputLanguage) return {}
          return { language: inputLanguage }
        }
      }),
      // 支持 ~~~ 语法
      textblockTypeInputRule({
        find: /^~~~([a-zA-Z0-9#+\-_.]+)\s/,
        type: this.type,
        getAttributes: (match) => {
          const inputLanguage = match[1]?.toLowerCase().trim()
          if (!inputLanguage) return {}
          return { language: inputLanguage }
        }
      })
    ]
  },

  addNodeView() {
    return CodeBlockNodeReactRenderer
  },

  addKeyboardShortcuts() {
    return {
      Tab: () => {
        if (this.editor.isActive(this.name)) {
          return this.editor.commands.insertContent('  ')
        }
        return false
      },
      'Shift-Tab': () => {
        if (this.editor.isActive(this.name)) {
          const { selection } = this.editor.state
          const { $from } = selection
          const start = $from.start()
          const content = $from.parent.textContent

          // Find the current line
          const beforeCursor = content.slice(0, $from.pos - start - 1)
          const lines = beforeCursor.split('\n')
          const currentLineIndex = lines.length - 1
          const currentLine = lines[currentLineIndex]

          // Check if line starts with spaces that can be removed
          if (currentLine.startsWith('  ')) {
            const lineStart = start + 1 + beforeCursor.length - currentLine.length
            return this.editor.commands.deleteRange({
              from: lineStart,
              to: lineStart + 2
            })
          }
        }
        return false
      }
    }
  },

  addProseMirrorPlugins() {
    const shikiPlugin = ShikiPlugin({
      name: this.name,
      defaultLanguage: this.options.defaultLanguage,
      theme: this.options.theme
    })

    const codeBlockEventPlugin = new Plugin({
      key: new PluginKey('codeBlockEvents'),
      props: {
        handleKeyDown: (view, event) => {
          const { selection } = view.state
          const { $from } = selection

          // Check if we're inside a code block and handle Enter key
          if ($from.parent.type.name === this.name && event.key === 'Enter') {
            const content = $from.parent.textContent
            const beforeCursor = content.slice(0, $from.pos - $from.start() - 1)
            const lines = beforeCursor.split('\n')
            const currentLine = lines[lines.length - 1]

            // Get indentation from current line
            const indent = currentLine.match(/^\s*/)?.[0] || ''

            // Insert newline with same indentation
            const tr = view.state.tr.insertText('\n' + indent, selection.from, selection.to)
            view.dispatch(tr)
            return true
          }
          return false
        }
      }
    })

    return [...(this.parent?.() || []), shikiPlugin, codeBlockEventPlugin]
  },

  addAttributes() {
    return {
      ...this.parent?.(),
      theme: {
        // 默认沿用扩展级别的 theme
        default: this.options.theme,
        parseHTML: (element) => element.getAttribute('data-theme'),
        renderHTML: (attrs) => (attrs.theme ? { 'data-theme': attrs.theme } : {})
      }
    }
  }
})

export default CodeBlockShiki
