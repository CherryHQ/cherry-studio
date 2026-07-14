import hljs from 'highlight.js/lib/common'
import MarkdownIt from 'markdown-it'

const markdown: MarkdownIt = new MarkdownIt({
  breaks: true,
  highlight(code: string, language: string): string {
    const escaped: string = markdown.utils.escapeHtml(code)
    if (!language || !hljs.getLanguage(language)) {
      return `<pre class="hljs"><code>${escaped}</code></pre>`
    }

    try {
      const highlighted = hljs.highlight(code, { language, ignoreIllegals: true }).value
      return `<pre class="hljs"><code>${highlighted}</code></pre>`
    } catch {
      return `<pre class="hljs"><code>${escaped}</code></pre>`
    }
  },
  html: false,
  linkify: true,
  typographer: false
})

export const renderMarkdown = (source: string) => markdown.render(source)

export const renderCode = (source: string, language?: string) => {
  const escaped = markdown.utils.escapeHtml(source)
  if (!language || !hljs.getLanguage(language)) return escaped
  try {
    return hljs.highlight(source, { language, ignoreIllegals: true }).value
  } catch {
    return escaped
  }
}
