import { createContext, use } from 'react'

export const MarkdownStreamingContext = createContext(false)

export function useMarkdownStreaming() {
  return use(MarkdownStreamingContext)
}
