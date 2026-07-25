import type { ReactNode } from 'react'
import { Suspense } from 'react'

import { ComposerContextProvider, type ComposerContextValue } from './ComposerContext'
import ComposerCore from './ComposerCore'
import ConversationComposerLoading from './ConversationComposerLoading'

export interface ConversationComposerSlotProps {
  scopeKey: string
  composerContext?: ComposerContextValue
  fallback?: ReactNode
}

const emptyComposerContext: ComposerContextValue = {}

export default function ConversationComposerSlot({
  scopeKey,
  composerContext = emptyComposerContext,
  fallback
}: ConversationComposerSlotProps) {
  if (!fallback) return null

  return (
    <ComposerContextProvider value={composerContext}>
      <Suspense key={scopeKey} fallback={<ConversationComposerLoading />}>
        <ComposerCore fallback={fallback} />
      </Suspense>
    </ComposerContextProvider>
  )
}
