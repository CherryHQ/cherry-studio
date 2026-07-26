import hljs from 'highlight.js/lib/common'
import MarkdownIt from 'markdown-it'

import { isInlineFilePath, normalizeInlineFilePath } from './workspaceFiles'

export type RenderMarkdownOptions = {
  readonly copyCodeLabel?: string
  readonly downloadCodeLabel?: string
  readonly wrapLinesLabel?: string
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

/** Compact line icons for the code-block hover toolbar (matches WebUI action icons). */
const toolbarIcon = (name: 'copy' | 'download' | 'wrap') => {
  if (name === 'copy') {
    return '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="9" width="11" height="11" rx="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>'
  }
  if (name === 'download') {
    return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v12"></path><path d="m7 10 5 5 5-5"></path><path d="M5 21h14"></path></svg>'
  }
  return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 7h14a4 4 0 0 1 0 8H7"></path><path d="m10 12-3 3 3 3"></path><path d="M3 19h8"></path></svg>'
}

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
  const opts = options as RenderMarkdownOptions
  const copyLabel = escapeAttribute(opts.copyCodeLabel ?? 'Copy code')
  const downloadLabel = escapeAttribute(opts.downloadCodeLabel ?? 'Download')
  const wrapLabel = escapeAttribute(opts.wrapLinesLabel ?? 'Wrap lines')
  // Always show a left-side type label (aligns with desktop CodeBlockView header).
  // Bare / text / plaintext fences use TEXT so the left edge is never empty.
  const languageDisplay = !language || language === 'text' || language === 'plaintext' ? 'TEXT' : language.toUpperCase()
  const languageLabel = `<span class="markdown-code-language">${markdown.utils.escapeHtml(languageDisplay)}</span>`
  const langAttr = language ? ` data-webui-code-lang="${escapeAttribute(language)}"` : ''
  const toolbar = `<div class="markdown-code-toolbar" role="toolbar" aria-label="code">
<button type="button" class="markdown-code-tool" data-webui-copy-code title="${copyLabel}" aria-label="${copyLabel}">${toolbarIcon('copy')}</button>
<button type="button" class="markdown-code-tool" data-webui-download-code${langAttr} title="${downloadLabel}" aria-label="${downloadLabel}">${toolbarIcon('download')}</button>
<button type="button" class="markdown-code-tool" data-webui-wrap-code title="${wrapLabel}" aria-label="${wrapLabel}" aria-pressed="false">${toolbarIcon('wrap')}</button>
</div>`
  return `<div class="markdown-code-block">${languageLabel}${toolbar}<pre class="hljs"><code${languageClass}>${highlighted}</code></pre></div>`
}

markdown.set({
  highlight(code: string, language: string): string {
    return renderHighlightedCode(code, language)
  }
})

type MutableMarkdownLabels = {
  copyCodeLabel?: string
  downloadCodeLabel?: string
  wrapLinesLabel?: string
}

/**
 * Preprocess incomplete GFM table syntax so markdown-it can render it during streaming.
 * markdown-it requires a complete table: header row + separator row (|---|) + optional body rows.
 * This function:
 *  1. Finds the last consecutive `|`-prefixed block at the end of source.
 *  2. Counts columns from the header row.
 *  3. If the separator row is missing or incomplete, inserts/replaces it with a complete one.
 *  4. Pads the last data row with trailing `|` and empty cells so it parses as a table row.
 * Does NOT modify the original source — only the display copy passed to markdown-it.
 */
const preprocessTable = (source: string): string => {
  const lines = source.split('\n')

  // Find the last consecutive `|`-prefixed block at the end of source.
  // Walk backwards: trailing empty lines are OK, first non-empty non-| line breaks the block.
  let lastTableRow = -1
  for (let i = lines.length - 1; i >= 0; i--) {
    const trimmed = lines[i]?.trim() ?? ''
    if (trimmed.startsWith('|')) {
      lastTableRow = i
      break
    }
    if (trimmed !== '') break
  }
  if (lastTableRow < 0) return source

  // Walk up to find the first row of this table block.
  let firstTableRow = lastTableRow
  while (firstTableRow > 0) {
    const trimmed = lines[firstTableRow - 1]?.trim() ?? ''
    if (trimmed.startsWith('|')) {
      firstTableRow--
    } else {
      break
    }
  }
  if (firstTableRow === lastTableRow) return source // Only one row — not enough for a table.

  // Count columns from the header row.
  const header = lines[firstTableRow]
  if (!header) return source
  const headerCells = header.split('|').filter((cell) => cell.trim() !== '').length
  if (headerCells < 2) return source

  // Work on a clone (display only, never mutates the original source).
  const result = [...lines]

  // Determine which rows are separator (---), header, and data.
  // Separator row is usually the second row (firstTableRow + 1) if it contains dashes.
  let separatorRow = -1
  for (let i = firstTableRow + 1; i <= lastTableRow; i++) {
    const trimmed = lines[i]?.trim() ?? ''
    // GFM separator: | --- | --- | ... or |:---:| --- | etc.
    if (/^\|[\s\-:]+\|?$/.test(trimmed) && /-/.test(trimmed)) {
      separatorRow = i
      break
    }
  }

  // Build a complete separator line with N columns.
  const makeSeparator = (columns: number): string => `| ${Array.from({ length: columns }, () => '---').join(' | ')} |`

  // Fix the separator row.
  if (separatorRow >= 0) {
    // Replace the existing separator with a complete one (correct column count).
    result[separatorRow] = makeSeparator(headerCells)
  } else {
    // No separator found — insert one right after the header.
    result.splice(firstTableRow + 1, 0, makeSeparator(headerCells))
    // Adjust lastTableRow index since we inserted a line.
    lastTableRow++
  }

  // Fix the last data row (lastTableRow now points to the last line, after insert).
  const lastLine = result[lastTableRow]
  if (!lastLine) return result.join('\n')

  // Ensure trailing | and correct column count (for content rows, not separator).
  const trimmed = lastLine.trim()
  if (!trimmed.startsWith('|')) return result.join('\n')

  // Check if last line is itself a separator (shouldn't happen after fix, but guard).
  if (/^\|[\s\-:]+\|?$/.test(trimmed) && /-/.test(trimmed)) {
    // It's a separator-only block with no data rows; nothing more to fix.
    return result.join('\n')
  }

  let fixedLine = trimmed
  if (!fixedLine.endsWith('|')) {
    fixedLine = `${fixedLine} |`
  }

  // Count non-empty cells in the fixed last line; pad if fewer than header.
  const cells = fixedLine.split('|').filter((cell) => cell.trim() !== '')
  while (cells.length < headerCells) {
    cells.push('')
    fixedLine = `${fixedLine}  |`
  }

  const indent = lastLine.match(/^\s*/)?.[0] ?? ''
  result[lastTableRow] = `${indent}${fixedLine}`
  return result.join('\n')
}

export const renderMarkdown = (source: string, options: RenderMarkdownOptions = {}) => {
  // Preprocess incomplete table syntax for streaming; markdown-it requires complete tables.
  // This is a display-only transformation — the original source is never modified.
  const displaySource = preprocessTable(source)
  // Labels are stashed on the shared markdown-it options object for the fence renderer.
  const markdownOptions = markdown.options as typeof markdown.options & MutableMarkdownLabels
  const previousCopyCodeLabel = markdownOptions.copyCodeLabel
  const previousDownloadCodeLabel = markdownOptions.downloadCodeLabel
  const previousWrapLinesLabel = markdownOptions.wrapLinesLabel
  markdownOptions.copyCodeLabel = options.copyCodeLabel
  markdownOptions.downloadCodeLabel = options.downloadCodeLabel
  markdownOptions.wrapLinesLabel = options.wrapLinesLabel
  try {
    return markdown.render(displaySource)
  } finally {
    markdownOptions.copyCodeLabel = previousCopyCodeLabel
    markdownOptions.downloadCodeLabel = previousDownloadCodeLabel
    markdownOptions.wrapLinesLabel = previousWrapLinesLabel
  }
}

export const renderCode = (source: string, language?: string) => renderHighlightedCode(source, language ?? '')
