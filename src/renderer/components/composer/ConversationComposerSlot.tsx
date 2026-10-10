import type { ReactNode } from 'react'

import { ComposerContextProvider, type ComposerContextValue } from './ComposerContext'
import ComposerCore from './ComposerCore'

export interface ConversationComposerSlotProps {
  composerContext?: ComposerContextValue
  fallback?: ReactNode
}

const emptyComposerContext: ComposerContextValue = {}

export default function ConversationComposerSlot({
  composerContext = emptyComposerContext,
  fallback
}: ConversationComposerSlotProps) {
  if (!fallback) return null

  return (
    <ComposerContextProvider value={composerContext}>
      <ComposerCore fallback={fallback} />
    </ComposerContextProvider>
  )
}
