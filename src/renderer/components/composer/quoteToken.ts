import { formatQuotedText } from '@renderer/utils/formats'

export const QUOTE_TOOLTIP_CONTENT_CLASS_NAME = 'max-w-[min(32rem,calc(100vw-2rem))]'
export const QUOTE_TOOLTIP_BODY_CLASS_NAME =
  'whitespace-pre-wrap text-start overflow-hidden [display:-webkit-box] [-webkit-box-orient:vertical] [-webkit-line-clamp:4]'

const BLOCKQUOTE_TRAILING_NEWLINE_PATTERN = /(<\/blockquote>)\n$/
const BLOCKQUOTE_PROMPT_PATTERN = /^<blockquote>\n\n([\s\S]*)\n<\/blockquote>$/

export function formatQuoteTooltipContent(content: string | null | undefined): string | undefined {
  return content || undefined
}

export function getQuoteTooltipContent(description: string | null | undefined, promptText: string | null | undefined) {
  const content = description || promptText
  if (!content) return undefined

  return formatQuoteTooltipContent(content.replace(BLOCKQUOTE_PROMPT_PATTERN, '$1'))
}

export function normalizeQuoteTokenPromptText(content: string): string {
  return content.replace(BLOCKQUOTE_TRAILING_NEWLINE_PATTERN, '$1')
}

export function formatQuoteTokenPromptText(content: string): string {
  return normalizeQuoteTokenPromptText(formatQuotedText(content))
}
