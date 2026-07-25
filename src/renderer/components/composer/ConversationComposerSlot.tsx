import type { ReactNode } from 'react'
import { startTransition, Suspense, useLayoutEffect, useState } from 'react'

import { ComposerContextProvider, type ComposerContextValue } from './ComposerContext'
import ComposerCore from './ComposerCore'
import ConversationComposerLoading from './ConversationComposerLoading'

export interface ConversationComposerSlotProps {
  scopeKey: string
  composerContext?: ComposerContextValue
  fallback?: ReactNode
}

const emptyComposerContext: ComposerContextValue = {}

function useComposerActivationAfterPaint(scopeKey: string | null) {
  const [activeScopeKey, setActiveScopeKey] = useState<string | null>(null)

  useLayoutEffect(() => {
    if (!scopeKey) return

    let activationFrame = 0
    // The first callback reaches the next paint; the second starts the heavy tree only after
    // the placeholder has had a frame on screen.
    const paintFrame = window.requestAnimationFrame(() => {
      activationFrame = window.requestAnimationFrame(() => {
        startTransition(() => setActiveScopeKey(scopeKey))
      })
    })

    return () => {
      window.cancelAnimationFrame(paintFrame)
      if (activationFrame) window.cancelAnimationFrame(activationFrame)
    }
  }, [scopeKey])

  return scopeKey !== null && activeScopeKey === scopeKey
}

export default function ConversationComposerSlot({
  scopeKey,
  composerContext = emptyComposerContext,
  fallback
}: ConversationComposerSlotProps) {
  const activated = useComposerActivationAfterPaint(fallback ? scopeKey : null)

  if (!fallback) return null

  return (
    <ComposerContextProvider value={composerContext}>
      {activated ? (
        <Suspense key={scopeKey} fallback={<ConversationComposerLoading />}>
          <ComposerCore fallback={fallback} />
        </Suspense>
      ) : (
        <ConversationComposerLoading />
      )}
    </ComposerContextProvider>
  )
}
