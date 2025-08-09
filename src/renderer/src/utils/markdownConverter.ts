import { loggerService } from '@logger'
import { tables, TurndownPlugin } from '@truto/turndown-plugin-gfm'
import DOMPurify from 'dompurify'
import he from 'he'
import MarkdownIt from 'markdown-it'
import striptags from 'striptags'
import TurndownService from 'turndown'

const logger = loggerService.withContext('markdownConverter')

export interface TaskListOptions {
  label?: boolean
}

// Create markdown-it instance with task list plugin
const md = new MarkdownIt({
  html: true, // Enable HTML tags in source
  xhtmlOut: true, // Use '/' to close single tags (<br />)
  breaks: true, // Convert '\n' in paragraphs into <br>
  linkify: true, // Autoconvert URL-like text to links
  typographer: true // Enable smartypants and other sweet transforms
})

// Custom task list plugin for markdown-it
function taskListPlugin(md: MarkdownIt, options: TaskListOptions = {}) {
  const { label = false } = options
  md.core.ruler.after('inline', 'task_list', (state) => {
    const tokens = state.tokens
    let inside_task_list = false

    for (let i = 0; i < tokens.length; i++) {
      const token = tokens[i]

      if (token.type === 'bullet_list_open') {
        // Check if this list contains task items
        let hasTaskItems = false
        for (let j = i + 1; j < tokens.length && tokens[j].type !== 'bullet_list_close'; j++) {
          if (tokens[j].type === 'inline' && /^\s*\[[ x]\]\s/.test(tokens[j].content)) {
            hasTaskItems = true
            break
          }
        }

        if (hasTaskItems) {
          inside_task_list = true
          token.attrSet('data-type', 'taskList')
          token.attrSet('class', 'task-list')
        }
      } else if (token.type === 'bullet_list_close' && inside_task_list) {
        inside_task_list = false
      } else if (token.type === 'list_item_open' && inside_task_list) {
        token.attrSet('data-type', 'taskItem')
        token.attrSet('class', 'task-list-item')
      } else if (token.type === 'inline' && inside_task_list) {
        const match = token.content.match(/^(\s*)\[([x ])\]\s+(.*)/)
        if (match) {
          const [, , check, content] = match
          const isChecked = check.toLowerCase() === 'x'

          // Find the parent list item token
          for (let j = i - 1; j >= 0; j--) {
            if (tokens[j].type === 'list_item_open') {
              tokens[j].attrSet('data-checked', isChecked.toString())
              break
            }
          }

          // Replace content with checkbox HTML and text
          token.content = content

          // Create checkbox token
          const checkboxToken = new state.Token('html_inline', '', 0)

          if (label) {
            checkboxToken.content = `<label><input type="checkbox"${isChecked ? ' checked' : ''} disabled> ${content}</label>`
            token.children = [checkboxToken]
          } else {
            checkboxToken.content = `<input type="checkbox"${isChecked ? ' checked' : ''} disabled>`

            // Insert checkbox at the beginning of inline content
            const textToken = new state.Token('text', '', 0)
            textToken.content = ' ' + content

            token.children = [checkboxToken, textToken]
          }
        }
      }
    }
  })
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

function tipTapKatexPlugin(md: MarkdownIt) {
  // 1) Parser: recognize $$$ ... $$$ as a block math token
  md.block.ruler.before(
    'fence',
    'math_block',
    (stateLike: unknown, startLine: number, endLine: number, silent: boolean): boolean => {
      const state = stateLike as BlockStateLike

      const startPos = state.bMarks[startLine] + state.tShift[startLine]
      const maxPos = state.eMarks[startLine]

      // Must begin with $$$ at line start (after indentation)
      if (startPos + 3 > maxPos) return false
      if (
        state.src.charCodeAt(startPos) !== 0x24 /* $ */ ||
        state.src.charCodeAt(startPos + 1) !== 0x24 /* $ */ ||
        state.src.charCodeAt(startPos + 2) !== 0x24 /* $ */
      ) {
        return false
      }

      // If requested only to validate existence
      if (silent) return true

      // Search for closing $$
      let nextLine = startLine
      let content = ''

      // Same-line closing? $$$ ... $$$
      const sameLineClose = state.src.indexOf('$$$', startPos + 3)
      if (sameLineClose !== -1 && sameLineClose <= maxPos - 3) {
        content = state.src.slice(startPos + 3, sameLineClose).trim()
        nextLine = startLine
      } else {
        // Multiline: look for closing $$$ anywhere
        for (nextLine = startLine + 1; nextLine < endLine; nextLine++) {
          const lineStart = state.bMarks[nextLine] + state.tShift[nextLine]
          const lineEnd = state.eMarks[nextLine]
          const line = state.src.slice(lineStart, lineEnd)

          // Check if this line contains closing $$
          const closingPos = line.indexOf('$$$')
          if (closingPos !== -1) {
            // Found closing $$; extract content between opening and closing
            const allLines: string[] = []

            // First line: content after opening $$
            const firstLineStart = state.bMarks[startLine] + state.tShift[startLine] + 3
            const firstLineEnd = state.eMarks[startLine]
            const firstLineContent = state.src.slice(firstLineStart, firstLineEnd)
            if (firstLineContent.trim()) {
              allLines.push(firstLineContent)
            }

            // Middle lines: full content
            for (let lineIdx = startLine + 1; lineIdx < nextLine; lineIdx++) {
              const midLineStart = state.bMarks[lineIdx] + state.tShift[lineIdx]
              const midLineEnd = state.eMarks[lineIdx]
              allLines.push(state.src.slice(midLineStart, midLineEnd))
            }

            // Last line: content before closing $$
            const lastLineContent = line.slice(0, closingPos)
            if (lastLineContent.trim()) {
              allLines.push(lastLineContent)
            }

            content = allLines.join('\n').trim()
            break
          }

          // Check if line starts with $$ (alternative closing pattern)
          if (
            lineStart + 3 <= lineEnd &&
            state.src.charCodeAt(lineStart) === 0x24 &&
            state.src.charCodeAt(lineStart + 1) === 0x24 &&
            state.src.charCodeAt(lineStart + 2) === 0x24
          ) {
            // Extract content between start and this line
            const firstContentLineStart = state.bMarks[startLine] + state.tShift[startLine] + 3
            const lastContentLineEnd = state.bMarks[nextLine]
            content = state.src.slice(firstContentLineStart, lastContentLineEnd).trim()
            break
          }
        }
        if (nextLine >= endLine) {
          // No closing fence -> not a valid block
          return false
        }
      }

      const token = state.push('math_block', 'div', 0)
      token.block = true
      token.map = [startLine, nextLine]
      token.content = content

      state.line = nextLine + 1
      return true
    }
  )

  // 2) Renderer: output TipTap-friendly container
  md.renderer.rules.math_block = (tokens: Array<{ content?: string }>, idx: number): string => {
    const content = tokens[idx]?.content ?? ''
    const latexEscaped = he.encode(content, { useNamedReferences: true })
    return `<div data-latex="${latexEscaped}" data-type="block-math"></div>`
  }

  // 3) Inline parser: recognize $$...$$ on a single line as inline math
  md.inline.ruler.before('emphasis', 'math_inline', (stateLike: unknown, silent: boolean): boolean => {
    const state = stateLike as InlineStateLike
    const start = state.pos

    // Need starting $$
    if (
      start + 1 >= state.posMax ||
      state.src.charCodeAt(start) !== 0x24 /* $ */ ||
      state.src.charCodeAt(start + 1) !== 0x24 /* $ */
    ) {
      return false
    }

    // Find the next $$ after start+2
    const close = state.src.indexOf('$$', start + 2)
    if (close === -1 || close > state.posMax) {
      return false
    }

    const content = state.src.slice(start + 2, close)
    // Inline variant must not contain a newline
    if (content.indexOf('\n') !== -1) {
      return false
    }

    if (!silent) {
      const token = state.push('math_inline', 'span', 0)
      token.content = content.trim()
    }

    state.pos = close + 2
    return true
  })

  // 4) Inline renderer: output TipTap-friendly inline container
  md.renderer.rules.math_inline = (tokens: Array<{ content?: string }>, idx: number): string => {
    const content = tokens[idx]?.content ?? ''
    const latexEscaped = he.encode(content, { useNamedReferences: true })
    return `<span data-latex="${latexEscaped}" data-type="inline-math"></span>`
  }
}

md.use(taskListPlugin, {
  label: true
})

md.use(tipTapKatexPlugin)

// Initialize turndown service
const turndownService = new TurndownService({
  headingStyle: 'atx', // Use # for headings
  hr: '---', // Use --- for horizontal rules
  bulletListMarker: '-', // Use - for bullet lists
  codeBlockStyle: 'fenced', // Use ``` for code blocks
  fence: '```', // Use ``` for code blocks
  emDelimiter: '*', // Use * for emphasis
  strongDelimiter: '**', // Use ** for strong
  blankReplacement: (_content, node) => {
    const el = node as any as HTMLElement
    if (el.nodeName === 'DIV' && el.getAttribute?.('data-type') === 'block-math') {
      const latex = el.getAttribute?.('data-latex') || ''
      return `$$$${latex}$$$`
    }
    if (el.nodeName === 'SPAN' && el.getAttribute?.('data-type') === 'inline-math') {
      const latex = el.getAttribute?.('data-latex') || ''
      return `$$${latex}$$`
    }
    if (el.nodeName === 'P' && el.querySelector?.('[data-type="inline-math"]')) {
      // Handle paragraphs containing math spans
      const mathSpans = el.querySelectorAll('[data-type="inline-math"]')
      const mathContent = Array.from(mathSpans)
        .map((span) => {
          const latex = span.getAttribute('data-latex') || ''
          return `$$${latex}$$`
        })
        .join(' ')
      return '\n\n' + mathContent
    }
    return (node as any).isBlock ? '\n\n' : ''
  }
})

// Configure turndown rules for better conversion
turndownService.addRule('strikethrough', {
  filter: ['del', 's'],
  replacement: (content) => `~~${content}~~`
})

turndownService.addRule('underline', {
  filter: ['u'],
  replacement: (content) => `<u>${content}</u>`
})

const taskListItemsPlugin: TurndownPlugin = (turndownService) => {
  turndownService.addRule('taskListItems', {
    filter: (node: Element) => {
      return node.nodeName === 'LI' && node.getAttribute && node.getAttribute('data-type') === 'taskItem'
    },
    replacement: (_content: string, node: Element) => {
      const checkbox = node.querySelector('input[type="checkbox"]') as HTMLInputElement | null
      const isChecked = checkbox?.checked || node.getAttribute('data-checked') === 'true'
      const textContent = node.textContent?.trim() || ''

      return '\n\n- ' + (isChecked ? '[x]' : '[ ]') + ' ' + textContent
    }
  })
  turndownService.addRule('taskList', {
    filter: (node: Element) => {
      return node.nodeName === 'UL' && node.getAttribute && node.getAttribute('data-type') === 'taskList'
    },
    replacement: (content: string) => {
      return content.trim()
    }
  })
}

turndownService.use([tables, taskListItemsPlugin])

/**
 * Converts HTML content to Markdown
 * @param html - HTML string to convert
 * @returns Markdown string
 */
export const htmlToMarkdown = (html: string | null | undefined): string => {
  if (!html || typeof html !== 'string') {
    return ''
  }

  try {
    return turndownService.turndown(html).trim()
  } catch (error) {
    logger.error('Error converting HTML to Markdown:', error as Error)
    return ''
  }
}

/**
 * Converts Markdown content to HTML
 * @param markdown - Markdown string to convert
 * @param options - Task list options
 * @returns HTML string
 */
export const markdownToHtml = (markdown: string | null | undefined): string => {
  if (!markdown || typeof markdown !== 'string') {
    return ''
  }

  try {
    return md.render(markdown)
  } catch (error) {
    logger.error('Error converting Markdown to HTML:', error as Error)
    return ''
  }
}

/**
 * Sanitizes HTML content using DOMPurify
 * @param html - HTML string to sanitize
 * @returns Sanitized HTML string
 */
export const sanitizeHtml = (html: string): string => {
  if (!html || typeof html !== 'string') {
    return ''
  }

  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS: [
      'h1',
      'h2',
      'h3',
      'h4',
      'h5',
      'h6',
      'div',
      'span',
      'p',
      'br',
      'hr',
      'strong',
      'b',
      'em',
      'i',
      'u',
      's',
      'del',
      'ul',
      'ol',
      'li',
      'blockquote',
      'code',
      'pre',
      'a',
      'img',
      'table',
      'thead',
      'tbody',
      'tfoot',
      'tr',
      'td',
      'th',
      'input',
      'label'
    ],
    ALLOWED_ATTR: ['href', 'title', 'alt', 'src', 'class', 'id', 'colspan', 'rowspan', 'type', 'checked', 'disabled'],
    ALLOW_DATA_ATTR: true,
    ALLOWED_URI_REGEXP: /^(?:(?:(?:f|ht)tps?|mailto|tel|callto|cid|xmpp):|[^a-z]|[a-z+.\\-]+(?:[^a-z+.\-:]|$))/i
  })
}

/**
 * Converts Markdown to safe HTML (combines conversion and sanitization)
 * @param markdown - Markdown string to convert
 * @returns Safe HTML string
 */
export const markdownToSafeHtml = (markdown: string): string => {
  const html = markdownToHtml(markdown)
  return sanitizeHtml(html)
}

/**
 * Gets plain text preview from Markdown content
 * @param markdown - Markdown string
 * @param maxLength - Maximum length for preview
 * @returns Plain text preview
 */
export const markdownToPreviewText = (markdown: string, maxLength: number = 50): string => {
  if (!markdown) return ''

  // Convert to HTML first, then strip tags
  const html = markdownToHtml(markdown)
  const textContent = he.decode(striptags(html)).replace(/\s+/g, ' ').trim()

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
