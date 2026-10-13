import type { MessageData, MessageQuote } from '@shared/data/types/message'
import { readCherryMeta, withCherryMeta } from '@shared/data/types/uiParts'
import { getMessageQuotes } from '@shared/utils/messageQuotes'

export function remapMessageQuoteSources<T extends MessageData>(data: T, ids: ReadonlyMap<string, string>): T {
  if (!data.quotes?.length && !getMessageQuotes(data.parts ?? [])) return data
  const remap = (quotes: readonly MessageQuote[]) =>
    quotes.map((quote) => ({ ...quote, sourceMessageId: ids.get(quote.sourceMessageId) ?? quote.sourceMessageId }))
  return {
    ...data,
    ...(data.quotes ? { quotes: remap(data.quotes) } : {}),
    parts: data.parts?.map((part) => {
      if (part.type !== 'text') return part
      const quotes = readCherryMeta(part)?.quotes
      return quotes?.length ? withCherryMeta(part, { quotes: remap(quotes) }) : part
    })
  }
}
