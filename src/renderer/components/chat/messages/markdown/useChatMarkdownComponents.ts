import type { Components } from 'streamdown'

import { CHAT_MARKDOWN_COMPONENTS, CHAT_MARKDOWN_COMPONENTS_WITH_STYLE } from './ChatMarkdownRenderers'

/**
 * Returns the markdown renderer components for a chat message block. The set
 * switches to the `with-style` variant when the content carries a `<style>`
 * element so that Shadow-DOM styles are applied correctly.
 */
export function useChatMarkdownComponents(_params: {
  blockId: string
  hasStyleElement: boolean
  isStreaming: boolean
}): Partial<Components> {
  return _params.hasStyleElement ? CHAT_MARKDOWN_COMPONENTS_WITH_STYLE : CHAT_MARKDOWN_COMPONENTS
}
