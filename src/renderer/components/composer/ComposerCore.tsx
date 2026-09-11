import type { ReactNode } from 'react'
import { useLayoutEffect, useRef } from 'react'

import { useActiveComposerOverride } from './ComposerContext'

type ComposerCoreProps = {
  fallback: ReactNode
  className?: string
}

export default function ComposerCore({ fallback, className }: ComposerCoreProps) {
  const activeOverride = useActiveComposerOverride()
  const primaryLayerRef = useRef<HTMLDivElement>(null)
  const previousOverrideIdRef = useRef<string | null>(null)
  const primaryFocusTargetRef = useRef<HTMLElement | null>(null)
  const primaryHadFocusRef = useRef(false)
  const activeOverrideId = activeOverride?.id ?? null

  useLayoutEffect(() => {
    const previousOverrideId = previousOverrideIdRef.current

    if (!previousOverrideId && activeOverrideId) {
      const activeElement = document.activeElement
      const focusedPrimaryElement =
        activeElement instanceof HTMLElement && primaryLayerRef.current?.contains(activeElement) ? activeElement : null

      if (focusedPrimaryElement || primaryHadFocusRef.current) {
        primaryFocusTargetRef.current = focusedPrimaryElement ?? primaryFocusTargetRef.current
        focusedPrimaryElement?.blur()
      } else {
        primaryFocusTargetRef.current = null
      }
      primaryHadFocusRef.current = false
    } else if (previousOverrideId && !activeOverrideId) {
      const focusTarget = primaryFocusTargetRef.current
      const activeElement = document.activeElement
      const canRestoreFocus = !activeElement || activeElement === document.body || !activeElement.isConnected

      if (focusTarget?.isConnected && canRestoreFocus) {
        focusTarget.focus({ preventScroll: true })
      }
      primaryFocusTargetRef.current = null
    }

    previousOverrideIdRef.current = activeOverrideId
  }, [activeOverrideId])

  return (
    <div
      data-composer-core=""
      data-composer-active-override={activeOverrideId ?? undefined}
      className="relative w-full">
      <div
        ref={primaryLayerRef}
        data-composer-primary-layer=""
        data-composer-active-layer={activeOverride ? undefined : ''}
        inert={Boolean(activeOverride)}
        aria-hidden={activeOverride ? true : undefined}
        className={
          activeOverride ? 'pointer-events-none invisible absolute inset-x-0 bottom-0 w-full' : 'relative w-full'
        }
        onFocusCapture={(event) => {
          if (activeOverride) return
          primaryFocusTargetRef.current = event.target
          primaryHadFocusRef.current = true
        }}
        onBlurCapture={(event) => {
          if (activeOverride) return
          if (!event.currentTarget.contains(event.relatedTarget)) {
            primaryHadFocusRef.current = false
          }
        }}>
        {fallback}
      </div>

      {activeOverride ? (
        <div
          key={activeOverride.id}
          data-composer-override-layer=""
          data-composer-active-layer=""
          className="relative w-full">
          {activeOverride.render({ className })}
        </div>
      ) : null}
    </div>
  )
}
