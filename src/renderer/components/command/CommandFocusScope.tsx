import { isEqual } from 'es-toolkit'
import { type ReactNode, type RefObject, use, useLayoutEffect, useMemo, useRef } from 'react'

import {
  CommandFocusHostContext,
  CommandFocusScopeContext,
  CommandFocusScopeState,
  type FocusScopeOptions
} from '@renderer/hooks/command'
import { CommandRuntimeContext, type CommandRuntime } from '@renderer/hooks/command'
import type { ContextValue } from '@shared/types/command'

function ScopeProvider({
  children,
  options,
  boundary = false,
  releaseAfterFocusRestore
}: {
  children: ReactNode
  options: FocusScopeOptions
  boundary?: boolean
  releaseAfterFocusRestore?: (cleanup: () => void) => void
}) {
  const host = use(CommandFocusHostContext)
  const registry = host?.registry
  const parent = use(CommandFocusScopeContext)
  const optionsRef = useRef(options)
  optionsRef.current = options
  const scopeRef = useRef<CommandFocusScopeState | null>(null)
  if (!scopeRef.current) {
    scopeRef.current = new CommandFocusScopeState(
      boundary ? (host?.rootScope ?? null) : parent,
      {
        element: () => optionsRef.current.element(),
        active: () => optionsRef.current.active(),
        context: () => optionsRef.current.context(),
        boundary
      },
      parent
    )
  }
  const scope = scopeRef.current
  const publishedOptionsRef = useRef<{
    element: HTMLElement | null
    active: boolean
    context: Readonly<Record<string, ContextValue>>
  } | null>(null)
  const attachmentRef = useRef<{ element: HTMLElement | null; dispose: () => void } | null>(null)

  useLayoutEffect(() => {
    const element = options.element()
    if (attachmentRef.current?.element === element) return
    attachmentRef.current?.dispose()
    attachmentRef.current = registry ? { element, dispose: registry.attach(scope) } : null
  })
  useLayoutEffect(
    () => () => {
      attachmentRef.current?.dispose()
      attachmentRef.current = null
    },
    [registry, scope]
  )
  useLayoutEffect(() => {
    const next = { element: options.element(), active: options.active(), context: { ...options.context() } }
    const previous = publishedOptionsRef.current
    if (
      previous?.element === next.element &&
      previous.active === next.active &&
      isEqual(previous.context, next.context)
    ) {
      return
    }
    publishedOptionsRef.current = next
    scope.publish()
  })
  const active = options.active()
  if (boundary) registry?.updateBoundaryActivation(scope, active)
  useLayoutEffect(() => {
    if (boundary && active && registry) {
      const dispose = registry.openBoundary(scope)
      return () => (releaseAfterFocusRestore ? releaseAfterFocusRestore(dispose) : dispose())
    }
    return undefined
  }, [active, boundary, registry, releaseAfterFocusRestore, scope])

  const value = useMemo<CommandRuntime | null>(() => host?.forScope(scope) ?? null, [host, scope])
  return (
    <CommandFocusScopeContext value={scope}>
      <CommandRuntimeContext value={value}>{children}</CommandRuntimeContext>
    </CommandFocusScopeContext>
  )
}

export function CommandFocusScope({
  children,
  rootRef,
  active = true,
  context = {}
}: {
  children: ReactNode
  rootRef: RefObject<HTMLElement | null>
  active?: boolean
  context?: Readonly<Record<string, ContextValue>>
}) {
  return (
    <ScopeProvider
      options={{
        element: () => rootRef.current,
        active: () => active && Boolean(rootRef.current?.isConnected),
        context: () => context
      }}>
      {children}
    </ScopeProvider>
  )
}

export function CommandKeyboardLayer({
  children,
  element,
  active,
  releaseAfterFocusRestore
}: {
  children: ReactNode
  element: HTMLElement | null
  active: boolean
  releaseAfterFocusRestore?: (cleanup: () => void) => void
}) {
  return (
    <ScopeProvider
      boundary
      releaseAfterFocusRestore={releaseAfterFocusRestore}
      options={{
        element: () => element,
        active: () => active,
        context: () => ({ 'resource.focused': false }),
        boundary: true
      }}>
      {children}
    </ScopeProvider>
  )
}
