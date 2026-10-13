import type { CherryMessagePart, MessageQuote } from '@shared/data/types/message'
import { readCherryMeta } from '@shared/data/types/uiParts'

export function getMessageQuotes(parts: readonly CherryMessagePart[]): MessageQuote[] | undefined {
  for (const part of parts) {
    if (part.type !== 'text') continue
    const quotes = readCherryMeta(part)?.quotes
    if (quotes?.length) return quotes
  }
  return undefined
}

export function formatMessageQuotes(text: string, quotes?: readonly MessageQuote[]): string {
  if (!quotes?.length) return text
  const references = quotes.map((quote, index) => ({ index: index + 1, text: quote.text }))
  return [
    '# Referenced messages',
    'Use these quoted messages as context for the user request. When addressing a quote, link to it using [Reference N](#cherry-quote-N), where N is its index in this request.',
    JSON.stringify(references),
    '# User request',
    text
  ].join('\n\n')
}

export function getQuotedMessageText(part: Extract<CherryMessagePart, { type: 'text' }>): string {
  return formatMessageQuotes(part.text, readCherryMeta(part)?.quotes)
}
