import { createContext, use } from 'react'

import type { MessageQuote } from '@shared/data/types/message'

export const MessageQuoteContext = createContext<readonly MessageQuote[] | undefined>(undefined)
export const useMessageQuotes = () => use(MessageQuoteContext)
