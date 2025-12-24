import { loggerService } from '@logger'
import { MARKDOWN_SOURCE_LINE_ATTR } from '@renderer/components/RichEditor/constants'
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
