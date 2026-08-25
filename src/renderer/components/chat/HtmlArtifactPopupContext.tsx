import type { HtmlArtifactKind } from '@renderer/components/chat/messages/markdown/plugins/remarkHtmlArtifact'
import { createContext, lazy, type ReactNode, Suspense, use, useCallback, useState, useSyncExternalStore } from 'react'

export interface HtmlArtifactPopupSession {
  artifactId: string
  html: string
  title: string
  onSave?: (html: string) => void
  editable: boolean
  kind: HtmlArtifactKind
  zoom: number
}

type HtmlArtifactPopupUpdate = Omit<HtmlArtifactPopupSession, 'zoom'>

export interface HtmlArtifactPopupActions {
  approveInteractiveHtml: (artifactId: string, html: string) => void
  openPopup: (session: HtmlArtifactPopupSession) => void
  syncPopup: (update: HtmlArtifactPopupUpdate) => void
  closePopup: () => void
}

interface HtmlArtifactPopupSnapshot {
  approvedInteractiveHtmlById: Readonly<Record<string, string>>
  popupSession: HtmlArtifactPopupSession | null
}

interface HtmlArtifactPopupRuntime {
  actions: HtmlArtifactPopupActions
  subscribe: (listener: () => void) => () => void
  getPopupSession: () => HtmlArtifactPopupSession | null
  getApprovedInteractiveHtml: (artifactId: string) => string | undefined
  getIsPopupOpen: (artifactId: string) => boolean
  getHasPopupSession: () => boolean
}

const HtmlArtifactPopupRuntimeContext = createContext<HtmlArtifactPopupRuntime | null>(null)

const HtmlArtifactPopupOutlet = lazy(() =>
  import('./HtmlArtifactView').then((module) => ({ default: module.HtmlArtifactPopupOutlet }))
)

/**
 * State intentionally lives outside React context. The runtime identity never
 * changes, and each useSyncExternalStore selector returns a primitive or the
 * full session it actually needs, so unrelated artifacts bail out by identity.
 */
function createHtmlArtifactPopupRuntime(): HtmlArtifactPopupRuntime {
  let snapshot: HtmlArtifactPopupSnapshot = {
    approvedInteractiveHtmlById: {},
    popupSession: null
  }
  const listeners = new Set<() => void>()

  const publish = (next: HtmlArtifactPopupSnapshot) => {
    if (next === snapshot) return
    snapshot = next
    for (const listener of listeners) listener()
  }

  const actions: HtmlArtifactPopupActions = {
    approveInteractiveHtml: (artifactId, html) => {
      if (snapshot.approvedInteractiveHtmlById[artifactId] === html) return
      publish({
        ...snapshot,
        approvedInteractiveHtmlById: { ...snapshot.approvedInteractiveHtmlById, [artifactId]: html }
      })
    },
    openPopup: (popupSession) => {
      if (snapshot.popupSession === popupSession) return
      publish({ ...snapshot, popupSession })
    },
    syncPopup: (update) => {
      const current = snapshot.popupSession
      if (!current || current.artifactId !== update.artifactId) return
      if (
        current.html === update.html &&
        current.title === update.title &&
        current.onSave === update.onSave &&
        current.editable === update.editable &&
        current.kind === update.kind
      ) {
        return
      }
      publish({ ...snapshot, popupSession: { ...current, ...update } })
    },
    closePopup: () => {
      if (!snapshot.popupSession) return
      publish({ ...snapshot, popupSession: null })
    }
  }

  return {
    actions,
    subscribe: (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    getPopupSession: () => snapshot.popupSession,
    getApprovedInteractiveHtml: (artifactId) => snapshot.approvedInteractiveHtmlById[artifactId],
    getIsPopupOpen: (artifactId) => snapshot.popupSession?.artifactId === artifactId,
    getHasPopupSession: () => snapshot.popupSession !== null
  }
}

function useHtmlArtifactPopupRuntime(): HtmlArtifactPopupRuntime {
  const runtime = use(HtmlArtifactPopupRuntimeContext)
  if (!runtime) {
    throw new Error('HTML artifact popup components must be rendered within HtmlArtifactPopupHost')
  }
  return runtime
}

export function useOptionalHtmlArtifactPopupActions(): HtmlArtifactPopupActions | null {
  return use(HtmlArtifactPopupRuntimeContext)?.actions ?? null
}

export function useHtmlArtifactPopupActions(): HtmlArtifactPopupActions {
  return useHtmlArtifactPopupRuntime().actions
}

export function useHtmlArtifactPopupSession(): HtmlArtifactPopupSession | null {
  const runtime = useHtmlArtifactPopupRuntime()
  return useSyncExternalStore(runtime.subscribe, runtime.getPopupSession, runtime.getPopupSession)
}

export function useApprovedInteractiveHtml(artifactId: string): string | undefined {
  const runtime = useHtmlArtifactPopupRuntime()
  const getSnapshot = useCallback(() => runtime.getApprovedInteractiveHtml(artifactId), [artifactId, runtime])
  return useSyncExternalStore(runtime.subscribe, getSnapshot, getSnapshot)
}

export function useIsHtmlArtifactPopupOpen(artifactId: string): boolean {
  const runtime = useHtmlArtifactPopupRuntime()
  const getSnapshot = useCallback(() => runtime.getIsPopupOpen(artifactId), [artifactId, runtime])
  return useSyncExternalStore(runtime.subscribe, getSnapshot, getSnapshot)
}

function HtmlArtifactPopupMount() {
  const runtime = useHtmlArtifactPopupRuntime()
  // Subscribe only to presence here. Session edits update the already-mounted
  // outlet without re-running this lazy-load boundary.
  const hasPopupSession = useSyncExternalStore(
    runtime.subscribe,
    runtime.getHasPopupSession,
    runtime.getHasPopupSession
  )

  return hasPopupSession ? (
    <Suspense fallback={null}>
      <HtmlArtifactPopupOutlet />
    </Suspense>
  ) : null
}

export function HtmlArtifactPopupHost({ children }: { children: ReactNode }) {
  const [runtime] = useState(createHtmlArtifactPopupRuntime)

  return (
    <HtmlArtifactPopupRuntimeContext value={runtime}>
      {children}
      <HtmlArtifactPopupMount />
    </HtmlArtifactPopupRuntimeContext>
  )
}
