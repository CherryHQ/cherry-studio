import MarkdownIt from 'markdown-it'

const md = new MarkdownIt({
  linkify: true,
  typographer: true
})

/**
 * Convert markdown text to HTML.
 * Used by the HTML export feature to render message bodies.
 */
export const markdownToHtml = (markdown: string): string => {
  return md.render(markdown)
}
