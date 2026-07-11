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
