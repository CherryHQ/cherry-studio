import { textblockTypeInputRule } from '@tiptap/core'
import CodeBlock, { type CodeBlockOptions } from '@tiptap/extension-code-block'

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
    }
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

  addProseMirrorPlugins() {
    const shikiPlugin = ShikiPlugin({
      name: this.name,
      defaultLanguage: this.options.defaultLanguage,
      theme: this.options.theme
    })

    return [...(this.parent?.() || []), shikiPlugin]
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
