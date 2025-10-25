import { loggerService } from '@logger'
import { MARKDOWN_SOURCE_LINE_ATTR } from '@renderer/components/RichEditor/constants'
import he from 'he'
import MarkdownIt from 'markdown-it'
import TurndownService from 'turndown'

const logger = loggerService.withContext('markdownConverter')

// Create markdown-it instance with task list plugin
const md = new MarkdownIt({
  html: true, // Enable HTML tags in source
  xhtmlOut: true, // Use '>' for single tags (<br> instead of <br />)
  breaks: false,
  linkify: false, // Autoconvert URL-like text to links
  typographer: false // Enable smartypants and other sweet transforms
})

// Helper function to inject line number data attribute
function injectLineNumber(token: any, openTag: string): string {
  if (token.map && token.map.length >= 2) {
    const startLine = token.map[0] + 1 // Convert to 1-based line number
    // Insert data attribute before the first closing >
    // Handle both self-closing tags (e.g., <hr />) and opening tags (e.g., <p>)
    const result = openTag.replace(/(\s*\/?>)/, ` ${MARKDOWN_SOURCE_LINE_ATTR}="${startLine}"$1`)
    logger.debug('injectLineNumber', { openTag, result, startLine, hasMap: !!token.map })
    return result
  }
  return openTag
}

// Store the original renderer
const defaultRender = md.renderer.render.bind(md.renderer)

// Override the main render method to inject line numbers
md.renderer.render = function (tokens, options, env) {
  return defaultRender(tokens, options, env)
}

// Override default rendering rules to add line numbers
const defaultBlockRules = [
  'paragraph_open',
  'heading_open',
  'blockquote_open',
  'bullet_list_open',
  'ordered_list_open',
  'list_item_open',
  'table_open',
  'hr'
]

defaultBlockRules.forEach((ruleName) => {
  const original = md.renderer.rules[ruleName]
  md.renderer.rules[ruleName] = function (tokens, idx, options, env, self) {
    const token = tokens[idx]
    let result = original ? original(tokens, idx, options, env, self) : self.renderToken(tokens, idx, options)
    result = injectLineNumber(token, result)
    return result
  }
})

// Override the code_block and code_inline renderers to properly escape HTML entities
md.renderer.rules.code_block = function (tokens, idx) {
  const token = tokens[idx]
  const langName = token.info ? ` class="language-${token.info.trim()}"` : ''
  const escapedContent = he.encode(token.content, { useNamedReferences: false })
  let html = `<pre><code${langName}>${escapedContent}</code></pre>`
  html = injectLineNumber(token, html)
  return html
}

md.renderer.rules.code_inline = function (tokens, idx) {
  const token = tokens[idx]
  const escapedContent = he.encode(token.content, { useNamedReferences: false })
  return `<code>${escapedContent}</code>`
}

md.renderer.rules.fence = function (tokens, idx) {
  const token = tokens[idx]
  const langName = token.info ? ` class="language-${token.info.trim()}"` : ''
  const escapedContent = he.encode(token.content, { useNamedReferences: false })
  let html = `<pre><code${langName}>${escapedContent}</code></pre>`
  html = injectLineNumber(token, html)
  return html
}

interface TokenLike {
  content: string
  block?: boolean
  map?: [number, number]
}

interface BlockStateLike {
  src: string
  bMarks: number[]
  eMarks: number[]
  tShift: number[]
  line: number
  parentType: string
  blkIndent: number
  push: (type: string, tag: string, nesting: number) => TokenLike
}

interface InlineStateLike {
  src: string
  pos: number
  posMax: number
  push: (type: string, tag: string, nesting: number) => TokenLike & { content?: string }
}

function yamlFrontMatterPlugin(md: MarkdownIt) {
  // Parser: recognize YAML front matter
  md.block.ruler.before(
    'table',
    'yaml_front_matter',
    (stateLike: unknown, startLine: number, endLine: number, silent: boolean): boolean => {
      const state = stateLike as BlockStateLike

      // Only check at the very beginning of the document
      if (startLine !== 0) {
        return false
      }

      const startPos = state.bMarks[startLine] + state.tShift[startLine]
      const maxPos = state.eMarks[startLine]

      // Must begin with --- at document start
      if (startPos + 3 > maxPos) return false
      if (
        state.src.charCodeAt(startPos) !== 0x2d /* - */ ||
        state.src.charCodeAt(startPos + 1) !== 0x2d /* - */ ||
        state.src.charCodeAt(startPos + 2) !== 0x2d /* - */
      ) {
        return false
      }

      // If requested only to validate existence
      if (silent) return true

      // Search for closing ---
      let nextLine = startLine + 1
      let found = false

      for (nextLine = startLine + 1; nextLine < endLine; nextLine++) {
        const lineStart = state.bMarks[nextLine] + state.tShift[nextLine]
        const lineEnd = state.eMarks[nextLine]
        const line = state.src.slice(lineStart, lineEnd).trim()

        if (line === '---') {
          found = true
          break
        }
      }

      if (!found) {
        return false
      }

      // Extract YAML content between the --- delimiters, preserving original indentation
      const yamlLines: string[] = []
      for (let lineIdx = startLine + 1; lineIdx < nextLine; lineIdx++) {
        // Use the original line markers without shift to preserve indentation
        const lineStart = state.bMarks[lineIdx]
        const lineEnd = state.eMarks[lineIdx]
        yamlLines.push(state.src.slice(lineStart, lineEnd))
      }

      // Also capture the closing --- line with its indentation
      const closingLineStart = state.bMarks[nextLine]
      const closingLineEnd = state.eMarks[nextLine]
      const closingLine = state.src.slice(closingLineStart, closingLineEnd)

      const yamlContent = yamlLines.join('\n') + '\n' + closingLine

      const token = state.push('yaml_front_matter', 'div', 0)
      token.block = true
      token.map = [startLine, nextLine + 1]
      token.content = yamlContent

      state.line = nextLine + 1
      return true
    }
  )

  // Renderer: output YAML front matter as special HTML element
  md.renderer.rules.yaml_front_matter = (tokens: Array<{ content?: string }>, idx: number): string => {
    const token = tokens[idx]
    const content = token?.content ?? ''
    let html = `<div data-type="yaml-front-matter" data-content="${he.encode(content)}">${content}</div>`
    html = injectLineNumber(token, html)
    return html
  }
}

md.use(yamlFrontMatterPlugin)

// Initialize turndown service
const turndownService = new TurndownService({
  headingStyle: 'atx', // Use # for headings
  hr: '---', // Use --- for horizontal rules
  bulletListMarker: '-', // Use - for bullet lists
  codeBlockStyle: 'fenced', // Use ``` for code blocks
  fence: '```', // Use ``` for code blocks
  emDelimiter: '*', // Use * for emphasis
  strongDelimiter: '**' // Use ** for strong
})

// Custom rule to preserve YAML front matter
turndownService.addRule('yamlFrontMatter', {
  filter: (node: Element) => {
    return node.nodeName === 'DIV' && node.getAttribute?.('data-type') === 'yaml-front-matter'
  },
  replacement: (_content: string, node: Node) => {
    const element = node as Element
    const yamlContent = element.getAttribute?.('data-content') || ''
    const decodedContent = he.decode(yamlContent, {
      isAttributeValue: false,
      strict: false
    })
    // The decodedContent already includes the complete YAML with closing ---
    // We just need to add the opening --- if it's not there
    if (decodedContent.startsWith('---')) {
      return decodedContent
    } else {
      return `---\n${decodedContent}`
    }
  }
})

/**
 * Gets plain text preview from Markdown content
 * @param markdown - Markdown string
 * @param maxLength - Maximum length for preview
 * @returns Plain text preview
 */
export const markdownToPreviewText = (markdown: string, maxLength: number = 50): string => {
  if (!markdown) return ''
  const textContent = turndownService.turndown(markdown).replace(/\s+/g, ' ').trim()
  return textContent.length > maxLength ? `${textContent.slice(0, maxLength)}...` : textContent
}

/**
 * Checks if content is Markdown (contains Markdown syntax)
 * @param content - Content to check
 * @returns True if content appears to be Markdown
 */
export const isMarkdownContent = (content: string): boolean => {
  if (!content) return false

  // Check for common Markdown syntax
  const markdownPatterns = [
    /^#{1,6}\s/, // Headers
    /^\*\s|^-\s|^\+\s/, // Unordered lists
    /^\d+\.\s/, // Ordered lists
    /\*\*.*\*\*/, // Bold
    /\*.*\*/, // Italic
    /`.*`/, // Inline code
    /```/, // Code blocks
    /^>/, // Blockquotes
    /\[.*\]\(.*\)/, // Links
    /!\[.*\]\(.*\)/ // Images
  ]

  return markdownPatterns.some((pattern) => pattern.test(content))
}
