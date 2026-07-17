import hljs from 'highlight.js/lib/common'
import MarkdownIt from 'markdown-it'

import { isInlineFilePath, normalizeInlineFilePath } from './workspaceFiles'

export type RenderMarkdownOptions = {
  readonly copyCodeLabel?: string
}

const markdown: MarkdownIt = new MarkdownIt({
  breaks: true,
  html: false,
  linkify: true,
  typographer: false
})

const renderHighlightedCode = (code: string, language: string) => {
  const escaped = markdown.utils.escapeHtml(code)
  if (!language || !hljs.getLanguage(language)) return escaped

  try {
    return hljs.highlight(code, { language, ignoreIllegals: true }).value
  } catch {
    return escaped
  }
}

const escapeAttribute = (value: string) => markdown.utils.escapeHtml(value).replaceAll('"', '&quot;')

markdown.renderer.rules.code_inline = (tokens, index) => {
  const content = tokens[index]?.content ?? ''
  if (isInlineFilePath(content)) {
    const normalizedPath = normalizeInlineFilePath(content)
    const escapedPath = escapeAttribute(normalizedPath)
    return `<code class="webui-inline-file-path"><button type="button" class="webui-file-link" data-webui-file-path="${escapedPath}">${markdown.utils.escapeHtml(normalizedPath)}</button></code>`
  }
  return `<code>${markdown.utils.escapeHtml(content)}</code>`
}

markdown.renderer.rules.fence = (tokens, index, options) => {
  const token = tokens[index]
  if (!token) return ''

  const language = token.info.trim().split(/\s+/)[0] ?? ''
  const content = token.content
  if ((!language || language === 'text') && isInlineFilePath(content)) {
    const normalizedPath = normalizeInlineFilePath(content)
    const escapedPath = escapeAttribute(normalizedPath)
    return `<pre class="hljs webui-file-path-block"><code class="webui-inline-file-path"><button type="button" class="webui-file-link" data-webui-file-path="${escapedPath}">${markdown.utils.escapeHtml(normalizedPath)}</button></code></pre>`
  }

  const highlighted = options.highlight?.(content, language, '') ?? markdown.utils.escapeHtml(content)
  const languageClass = language ? ` class="language-${escapeAttribute(language)}"` : ''
  const copyLabel = escapeAttribute((options as RenderMarkdownOptions).copyCodeLabel ?? 'Copy code')
  const languageLabel = language
    ? `<span class="markdown-code-language">${markdown.utils.escapeHtml(language)}</span>`
    : ''
  return `<div class="markdown-code-block">${languageLabel}<button type="button" class="markdown-code-copy" data-webui-copy-code title="${copyLabel}" aria-label="${copyLabel}">${copyLabel}</button><pre class="hljs"><code${languageClass}>${highlighted}</code></pre></div>`
}

markdown.set({
  highlight(code: string, language: string): string {
    return renderHighlightedCode(code, language)
  }
})

export const renderMarkdown = (source: string, options: RenderMarkdownOptions = {}) => {
  const markdownOptions = markdown.options as { copyCodeLabel?: string }
  const previousCopyCodeLabel = markdownOptions.copyCodeLabel
  markdownOptions.copyCodeLabel = options.copyCodeLabel
  try {
    return markdown.render(source)
  } finally {
    markdownOptions.copyCodeLabel = previousCopyCodeLabel
  }
}

export const renderCode = (source: string, language?: string) => renderHighlightedCode(source, language ?? '')
