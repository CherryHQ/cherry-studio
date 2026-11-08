import * as React from 'react'

export interface KeyboardLayerProps {
  active: boolean
  children: React.ReactNode
  element: HTMLElement | null
  releaseAfterFocusRestore?: (cleanup: () => void) => void
}

const KeyboardLayerAdapterContext = React.createContext<React.ComponentType<KeyboardLayerProps> | null>(null)

export function KeyboardLayerProvider({
  adapter,
  children
}: {
  adapter: React.ComponentType<KeyboardLayerProps>
  children: React.ReactNode
}) {
  return <KeyboardLayerAdapterContext value={adapter}>{children}</KeyboardLayerAdapterContext>
}

export const KeyboardLayerOpenContext = React.createContext(false)

const releaseImmediately = (cleanup: () => void) => cleanup()
const KeyboardLayerLifetimeContext = React.createContext({
  releaseAfterFocusRestore: releaseImmediately,
  completeRestore: () => {}
})

export function KeyboardLayerRoot({ open, children }: { open: boolean; children: React.ReactNode }) {
  const lifetime = React.useRef({ alive: true, closing: !open, restored: !open, pending: new Set<() => void>() })
  lifetime.current.closing = !open
  if (open) lifetime.current.restored = false
  const flush = React.useCallback(() => {
    const pending = [...lifetime.current.pending]
    lifetime.current.pending.clear()
    for (const cleanup of pending) cleanup()
  }, [])
  const value = React.useMemo(
    () => ({
      releaseAfterFocusRestore: (cleanup: () => void) => {
        if (lifetime.current.alive && lifetime.current.closing && !lifetime.current.restored)
          lifetime.current.pending.add(cleanup)
        else cleanup()
      },
      completeRestore: () =>
        queueMicrotask(() => {
          lifetime.current.restored = true
          flush()
        })
    }),
    [flush]
  )
  React.useLayoutEffect(() => {
    const current = lifetime.current
    current.alive = true
    return () => {
      current.alive = false
      flush()
    }
  }, [flush])
  return (
    <KeyboardLayerLifetimeContext value={value}>
      <KeyboardLayerOpenContext value={open}>{children}</KeyboardLayerOpenContext>
    </KeyboardLayerLifetimeContext>
  )
}

export function KeyboardLayer({ children, element, active, releaseAfterFocusRestore }: KeyboardLayerProps) {
  const Adapter = React.use(KeyboardLayerAdapterContext)
  const lifetime = React.use(KeyboardLayerLifetimeContext)
  return Adapter ? (
    <Adapter
      active={active}
      element={element}
      releaseAfterFocusRestore={releaseAfterFocusRestore ?? lifetime.releaseAfterFocusRestore}>
      {children}
    </Adapter>
  ) : (
    children
  )
}

export function useKeyboardLayerRef<T extends HTMLElement>(forwardedRef: React.Ref<T> | undefined) {
  const [element, setElement] = React.useState<T | null>(null)
  const ref = React.useCallback(
    (node: T | null) => {
      setElement(node)
      if (typeof forwardedRef === 'function') return forwardedRef(node)
      if (forwardedRef) forwardedRef.current = node
    },
    [forwardedRef]
  )
  return { element, ref }
}

export function useKeyboardLayerState(forceMount?: true) {
  const open = React.use(KeyboardLayerOpenContext)
  const lifetime = React.use(KeyboardLayerLifetimeContext)
  const [released, setReleased] = React.useState(!open)
  if (open && released) setReleased(false)
  return {
    active: open || (!forceMount && !released),
    releaseAfterFocusRestore: forceMount ? releaseImmediately : lifetime.releaseAfterFocusRestore,
    onCloseAutoFocus: React.useCallback(() => {
      queueMicrotask(() => setReleased(true))
      lifetime.completeRestore()
    }, [lifetime])
  }
}
