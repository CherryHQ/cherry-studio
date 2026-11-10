import { type MarkdownLexerConfiguration, Node } from '@tiptap/core'
import { Plugin } from '@tiptap/pm/state'

export const WikiLink = Node.create<{ onClick: (target: string) => void }>({
  name: 'wikiLink',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: false,

  addOptions() {
    return { onClick: () => {} }
  },
  addAttributes() {
    return {
      raw: { default: '', parseHTML: (element) => element.getAttribute('data-wiki-raw') },
      target: { default: null, parseHTML: (element) => element.getAttribute('data-wiki-target') },
      label: { default: '', parseHTML: (element) => element.getAttribute('data-wiki-label') }
    }
  },
  markdownTokenizer: {
    name: 'wikiLink',
    level: 'inline',
    start(src) {
      return src.search(/!?\[\[(?!\[)/)
    },
    tokenize(src, _tokens, helpers) {
      const lexer = (helpers as MarkdownLexerConfiguration & { lexer?: { state?: { inLink?: boolean } } })?.lexer
      if (lexer?.state?.inLink) return undefined
      if ((!src.startsWith('[[') && !src.startsWith('![[')) || /^!?\[\[\[/.test(src)) return undefined
      const offset = src.startsWith('!') ? 1 : 0
      let depth = 0
      let end = -1
      for (let i = offset; i < src.length && src[i] !== '\n'; i++) {
        if (src[i] === '\\' && i + 1 < src.length) {
          i++
          continue
        }
        if (src[i] === '[') depth++
        if (src[i] === ']' && --depth === 0) {
          end = i + 1
          break
        }
      }
      if (end < 0) return undefined
      const raw = src.slice(0, end)
      if (!raw.startsWith('!') && /^(?:\([^\n]*?\)|\[(?!\[)[^\n\]]*\])/.test(src.slice(raw.length))) return undefined
      const inner = raw.slice(raw.startsWith('!') ? 3 : 2, -2)
      const parts = inner.split('|')
      const target = parts[0]
      const navigable =
        raw.endsWith(']]') &&
        !raw.startsWith('!') &&
        parts.length <= 2 &&
        !!target &&
        !inner.includes('[') &&
        !/(?<!\\)\]/.test(inner) &&
        !inner.includes('#')
      if (raw.startsWith('!') || inner.includes('#')) return { type: 'wikiLink', raw, literal: true, text: raw }
      return { type: 'wikiLink', raw, target: navigable ? target : null, text: navigable ? (parts[1] ?? target) : raw }
    }
  },
  parseMarkdown(token, helpers) {
    return token.literal
      ? helpers.createNode('markdownLiteral', { raw: token.raw })
      : helpers.createNode('wikiLink', { raw: token.raw, target: token.target, label: token.text })
  },
  renderMarkdown(node) {
    return node.attrs?.raw || ''
  },
  renderText({ node }) {
    return node.attrs.raw
  },
  extendNodeSchema(extension) {
    return extension.name === 'wikiLink' ? { leafText: (node) => node.attrs.raw } : {}
  },
  parseHTML() {
    return [{ tag: 'span[data-wiki-link]' }]
  },
  renderHTML({ node }) {
    return [
      'span',
      {
        'data-wiki-link': '',
        'data-wiki-raw': node.attrs.raw,
        'data-wiki-target': node.attrs.target,
        'data-wiki-label': node.attrs.label,
        class: node.attrs.target ? 'wiki-link' : ''
      },
      node.attrs.label
    ]
  },
  addProseMirrorPlugins() {
    const onClick = this.options.onClick
    return [
      new Plugin({
        props: {
          handleDOMEvents: {
            click: (view, event) => {
              if (event.button !== 0 || (view.editable && !event.metaKey && !event.ctrlKey)) return false
              const element = event.target instanceof Element ? event.target.closest('[data-wiki-link]') : null
              const target = element?.getAttribute('data-wiki-target')
              if (!target || !view.dom.contains(element)) return false
              onClick(target)
              return true
            }
          }
        }
      })
    ]
  }
})

export const MarkdownLiteral = Node.create({
  name: 'markdownLiteral',
  group: 'inline',
  inline: true,
  atom: true,
  addAttributes() {
    return { raw: { default: '', parseHTML: (element) => element.getAttribute('data-markdown-literal') } }
  },
  renderMarkdown(node) {
    return node.attrs?.raw || ''
  },
  renderText({ node }) {
    return node.attrs.raw
  },
  extendNodeSchema(extension) {
    return extension.name === 'markdownLiteral' ? { leafText: (node) => node.attrs.raw } : {}
  },
  parseHTML() {
    return [{ tag: 'span[data-markdown-literal]' }]
  },
  renderHTML({ node }) {
    return ['span', { 'data-markdown-literal': node.attrs.raw }, node.attrs.raw]
  }
})
