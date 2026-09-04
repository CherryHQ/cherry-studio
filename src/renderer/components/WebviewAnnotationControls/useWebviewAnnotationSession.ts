import { loggerService } from '@logger'
import { ipcApi } from '@renderer/ipc'
import {
  WEBVIEW_ANNOTATION_BRIDGE_CHANNEL,
  type WebviewAnnotation,
  type WebviewAnnotationAnchorRect,
  WebviewAnnotationGuestEventSchema,
  type WebviewAnnotationHostCommand,
  type WebviewAnnotationLocale,
  type WebviewAnnotationTarget
} from '@shared/types/webviewAnnotation'
import type { WebviewTag } from 'electron'
import type { RefObject } from 'react'
import { useCallback, useEffect, useLayoutEffect, useRef, useSyncExternalStore } from 'react'

const logger = loggerService.withContext('useWebviewAnnotationSession')
const SNAPSHOT_TIMEOUT_MS = 2_000

interface SessionState {
  enabled: boolean
  count: number
  copying: boolean
  documentSessionId: string | null
  editor: EditorState | null
}

interface EditorState {
  requestId: string
  draft: string
  canDelete: boolean
  error: 'element_unavailable' | null
  anchor: WebviewAnnotationAnchorRect
}

type SessionStateUpdate = SessionState | ((current: SessionState) => SessionState)

const EMPTY_STATE: SessionState = { enabled: false, count: 0, copying: false, documentSessionId: null, editor: null }

function createSessionStore() {
  let snapshot = EMPTY_STATE
  const listeners = new Set<() => void>()

  const getSnapshot = () => snapshot
  const subscribe = (listener: () => void) => {
    listeners.add(listener)
    return () => listeners.delete(listener)
  }
  const setState = (update: SessionStateUpdate) => {
    const next = typeof update === 'function' ? update(snapshot) : update
    if (
      Object.is(snapshot, next) ||
      (snapshot.enabled === next.enabled &&
        snapshot.count === next.count &&
        snapshot.copying === next.copying &&
        snapshot.documentSessionId === next.documentSessionId &&
        snapshot.editor === next.editor)
    ) {
      return
    }
    snapshot = next
    listeners.forEach((listener) => listener())
  }

  return { getSnapshot, subscribe, setState }
}

interface Options {
  webviewRef: RefObject<WebviewTag | null>
  webviewRevision: number
  isHostActive: boolean
  target: WebviewAnnotationTarget
  locale: WebviewAnnotationLocale
  theme: 'light' | 'dark'
}

interface Binding {
  webview: WebviewTag
  webviewId: number
}

interface PendingSnapshot {
  sessionId: string
  requestId: string
  resolve: (annotations: WebviewAnnotation[]) => void
  reject: (error: Error) => void
  timeout: ReturnType<typeof setTimeout>
}

interface CopyOperation extends Binding {
  sessionId: string
  target: WebviewAnnotationTarget
  generation: number
}

export function useWebviewAnnotationSession({
  webviewRef,
  webviewRevision,
  isHostActive,
  target,
  locale,
  theme
}: Options) {
  const webview = webviewRef.current
  const storeRef = useRef<ReturnType<typeof createSessionStore> | null>(null)
  if (!storeRef.current) storeRef.current = createSessionStore()
  const store = storeRef.current
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot)
  const bindingRef = useRef<Binding | null>(null)
  const sessionRef = useRef<string | null>(null)
  const retiredSessionsRef = useRef(new Set<string>())
  const pendingSnapshotRef = useRef<PendingSnapshot | null>(null)
  const operationRef = useRef<CopyOperation | null>(null)
  const copyInFlightRef = useRef(false)
  const generationRef = useRef(0)
  const targetRef = useRef(target)
  const hostActiveRef = useRef(isHostActive)
  const configurationRef = useRef({ locale, theme })
  targetRef.current = target
  hostActiveRef.current = isHostActive
  configurationRef.current = { locale, theme }

  const sendCommand = useCallback((attachedWebview: WebviewTag, command: WebviewAnnotationHostCommand): boolean => {
    try {
      void Promise.resolve(attachedWebview.send(WEBVIEW_ANNOTATION_BRIDGE_CHANNEL, command)).catch((error) => {
        logger.debug('Failed to send webview annotation command', { error })
      })
      return true
    } catch (error) {
      logger.debug('Webview annotation guest is not ready', { error })
      return false
    }
  }, [])

  const rejectPendingSnapshot = useCallback((message: string) => {
    const pending = pendingSnapshotRef.current
    if (!pending) return
    pendingSnapshotRef.current = null
    clearTimeout(pending.timeout)
    pending.reject(new Error(message))
  }, [])

  const invalidateOperation = useCallback(
    (message: string) => {
      generationRef.current++
      rejectPendingSnapshot(message)
    },
    [rejectPendingSnapshot]
  )

  useLayoutEffect(() => {
    if (!webview) return
    const attachedWebview = webview
    let webviewId = 0
    try {
      webviewId = attachedWebview.getWebContentsId()
    } catch {
      // A concrete but not-yet-attached webview has no usable id yet.
    }
    invalidateOperation('Webview binding changed')
    bindingRef.current = { webview: attachedWebview, webviewId }
    sessionRef.current = null
    retiredSessionsRef.current = new Set()
    store.setState(EMPTY_STATE)

    const retireSession = (clear: boolean, message: string) => {
      const sessionId = sessionRef.current
      invalidateOperation(message)
      if (sessionId) {
        sendCommand(attachedWebview, { type: 'deactivate', sessionId })
        if (clear) sendCommand(attachedWebview, { type: 'clear', sessionId })
        retiredSessionsRef.current.add(sessionId)
      }
      sessionRef.current = null
      store.setState(EMPTY_STATE)
    }

    const configureSession = (sessionId: string) =>
      sendCommand(attachedWebview, { type: 'configure', sessionId, ...configurationRef.current })

    const handleGuestMessage = (event: Electron.IpcMessageEvent) => {
      if (event.currentTarget !== attachedWebview) return
      if (event.channel !== WEBVIEW_ANNOTATION_BRIDGE_CHANNEL) return
      const parsed = WebviewAnnotationGuestEventSchema.safeParse(event.args[0])
      if (!parsed.success) return
      const guestEvent = parsed.data

      if (guestEvent.type === 'snapshot_ready') {
        const pending = pendingSnapshotRef.current
        if (
          !pending ||
          sessionRef.current !== guestEvent.sessionId ||
          pending.sessionId !== guestEvent.sessionId ||
          pending.requestId !== guestEvent.requestId
        ) {
          return
        }
        pendingSnapshotRef.current = null
        clearTimeout(pending.timeout)
        pending.resolve(guestEvent.annotations)
        return
      }

      if (guestEvent.type === 'editor_requested') {
        if (sessionRef.current !== guestEvent.sessionId || !hostActiveRef.current) return
        store.setState((current) => ({
          ...current,
          editor: {
            requestId: guestEvent.requestId,
            draft: guestEvent.comment,
            canDelete: guestEvent.canDelete,
            error: null,
            anchor: guestEvent.anchor
          }
        }))
        return
      }

      if (guestEvent.type === 'editor_anchor_changed') {
        if (sessionRef.current !== guestEvent.sessionId) return
        store.setState((current) =>
          current.editor?.requestId === guestEvent.requestId
            ? { ...current, editor: { ...current.editor, anchor: guestEvent.anchor } }
            : current
        )
        return
      }

      if (guestEvent.type === 'editor_closed') {
        if (sessionRef.current !== guestEvent.sessionId) return
        store.setState((current) =>
          current.editor?.requestId === guestEvent.requestId ? { ...current, editor: null } : current
        )
        return
      }

      if (guestEvent.type === 'editor_error') {
        if (sessionRef.current !== guestEvent.sessionId) return
        store.setState((current) =>
          current.editor?.requestId === guestEvent.requestId
            ? { ...current, editor: { ...current.editor, error: guestEvent.reason } }
            : current
        )
        return
      }

      if (retiredSessionsRef.current.has(guestEvent.sessionId)) return
      const currentSessionId = sessionRef.current
      if (currentSessionId !== guestEvent.sessionId) {
        if (currentSessionId) retiredSessionsRef.current.add(currentSessionId)
        invalidateOperation('Annotation session changed')
        sessionRef.current = guestEvent.sessionId
        try {
          bindingRef.current = { webview: attachedWebview, webviewId: attachedWebview.getWebContentsId() }
        } catch {
          bindingRef.current = { webview: attachedWebview, webviewId: 0 }
        }
        configureSession(guestEvent.sessionId)
      }

      const enabled = hostActiveRef.current && guestEvent.enabled
      store.setState((current) => ({
        ...current,
        enabled,
        count: guestEvent.count,
        documentSessionId: guestEvent.sessionId,
        editor: enabled ? current.editor : null
      }))
      if (!hostActiveRef.current && guestEvent.enabled) {
        sendCommand(attachedWebview, { type: 'deactivate', sessionId: guestEvent.sessionId })
      }
    }

    const handleNavigation = (event: Event & { isMainFrame: boolean; isInPlace?: boolean }) => {
      if (event.isMainFrame && !event.isInPlace) retireSession(true, 'Webview document changed')
    }
    const handleRenderProcessGone = () => retireSession(false, 'Webview render process exited')
    const requestState = () => sendCommand(attachedWebview, { type: 'request_state' })

    attachedWebview.addEventListener('ipc-message', handleGuestMessage)
    attachedWebview.addEventListener('did-start-navigation', handleNavigation as EventListener)
    attachedWebview.addEventListener('render-process-gone', handleRenderProcessGone)
    attachedWebview.addEventListener('dom-ready', requestState)
    requestState()

    return () => {
      invalidateOperation('Webview annotation controls detached')
      const sessionId = sessionRef.current
      if (bindingRef.current?.webview === attachedWebview) {
        if (sessionId) sendCommand(attachedWebview, { type: 'deactivate', sessionId })
        bindingRef.current = null
        sessionRef.current = null
      }
      attachedWebview.removeEventListener('ipc-message', handleGuestMessage)
      attachedWebview.removeEventListener('did-start-navigation', handleNavigation as EventListener)
      attachedWebview.removeEventListener('render-process-gone', handleRenderProcessGone)
      attachedWebview.removeEventListener('dom-ready', requestState)
    }
  }, [invalidateOperation, sendCommand, store, webview, webviewRef, webviewRevision])

  const previousTargetIdRef = useRef(target.id)
  useEffect(() => {
    const previousTargetId = previousTargetIdRef.current
    previousTargetIdRef.current = target.id
    if (previousTargetId === target.id) return
    invalidateOperation('Annotation target changed')
    const binding = bindingRef.current
    const sessionId = sessionRef.current
    if (binding && sessionId) sendCommand(binding.webview, { type: 'clear', sessionId })
    store.setState((current) => ({ ...current, enabled: false, count: 0, editor: null }))
  }, [invalidateOperation, sendCommand, store, target.id])

  useEffect(() => {
    const binding = bindingRef.current
    const sessionId = sessionRef.current
    if (!binding || !sessionId) return
    sendCommand(binding.webview, { type: 'configure', sessionId, ...configurationRef.current })
  }, [locale, sendCommand, target.label, theme])

  useEffect(() => {
    const binding = bindingRef.current
    const sessionId = sessionRef.current
    if (!binding || !sessionId) return
    if (!isHostActive) {
      sendCommand(binding.webview, { type: 'deactivate', sessionId })
      store.setState((current) => ({ ...current, enabled: false, editor: null }))
    } else {
      sendCommand(binding.webview, { type: 'request_state' })
    }
  }, [isHostActive, sendCommand, store])

  const toggle = useCallback(() => {
    const binding = bindingRef.current
    const sessionId = sessionRef.current
    if (!binding || !sessionId) return
    const enabled = !state.enabled
    if (!sendCommand(binding.webview, { type: 'set_enabled', sessionId, enabled })) return
    store.setState((current) => ({ ...current, enabled, editor: enabled ? current.editor : null }))
  }, [sendCommand, state.enabled, store])

  const setEditorDraft = useCallback(
    (draft: string) =>
      store.setState((current) =>
        current.editor ? { ...current, editor: { ...current.editor, draft, error: null } } : current
      ),
    [store]
  )

  const saveEditor = useCallback(() => {
    const binding = bindingRef.current
    const sessionId = sessionRef.current
    const editor = store.getSnapshot().editor
    const comment = editor?.draft.trim()
    if (!binding || !sessionId || !editor || !comment) return false
    return sendCommand(binding.webview, {
      type: 'save_editor',
      sessionId,
      requestId: editor.requestId,
      comment
    })
  }, [sendCommand, store])

  const cancelEditor = useCallback(() => {
    const binding = bindingRef.current
    const sessionId = sessionRef.current
    const editor = store.getSnapshot().editor
    if (!editor) return
    store.setState((current) => ({ ...current, editor: null }))
    if (binding && sessionId) {
      sendCommand(binding.webview, { type: 'cancel_editor', sessionId, requestId: editor.requestId })
    }
  }, [sendCommand, store])

  const deleteEditor = useCallback(() => {
    const binding = bindingRef.current
    const sessionId = sessionRef.current
    const editor = store.getSnapshot().editor
    if (!binding || !sessionId || !editor?.canDelete) return false
    return sendCommand(binding.webview, { type: 'delete_editor', sessionId, requestId: editor.requestId })
  }, [sendCommand, store])

  const requestSnapshot = useCallback(
    (operation: CopyOperation) =>
      new Promise<WebviewAnnotation[]>((resolve, reject) => {
        const requestId = crypto.randomUUID()
        const timeout = setTimeout(() => {
          const pending = pendingSnapshotRef.current
          if (!pending || pending.sessionId !== operation.sessionId || pending.requestId !== requestId) return
          pendingSnapshotRef.current = null
          reject(new Error('Timed out waiting for webview annotation snapshot'))
        }, SNAPSHOT_TIMEOUT_MS)
        pendingSnapshotRef.current = { sessionId: operation.sessionId, requestId, resolve, reject, timeout }
        if (!sendCommand(operation.webview, { type: 'request_snapshot', sessionId: operation.sessionId, requestId })) {
          pendingSnapshotRef.current = null
          clearTimeout(timeout)
          reject(new Error('Failed to request webview annotation snapshot'))
        }
      }),
    [sendCommand]
  )

  const isOperationCurrent = useCallback((operation: CopyOperation) => {
    const binding = bindingRef.current
    if (
      operationRef.current !== operation ||
      !binding ||
      binding.webview !== operation.webview ||
      binding.webviewId !== operation.webviewId ||
      sessionRef.current !== operation.sessionId ||
      generationRef.current !== operation.generation ||
      targetRef.current.id !== operation.target.id
    ) {
      return false
    }
    try {
      return operation.webview.getWebContentsId() === operation.webviewId
    } catch {
      return false
    }
  }, [])

  const copy = useCallback(async () => {
    if (copyInFlightRef.current || state.count === 0) return
    const binding = bindingRef.current
    const sessionId = sessionRef.current
    if (!binding || !binding.webviewId || !sessionId) return
    const operation: CopyOperation = {
      ...binding,
      sessionId,
      target: { ...targetRef.current },
      generation: generationRef.current
    }
    operationRef.current = operation
    copyInFlightRef.current = true
    store.setState((current) => ({ ...current, copying: true }))
    try {
      const annotations = await requestSnapshot(operation)
      if (annotations.length === 0 || !isOperationCurrent(operation)) throw new Error('Annotation snapshot is stale')
      const markdown = await ipcApi.request('webview.export_annotations', {
        webviewId: operation.webviewId,
        documentSessionId: operation.sessionId,
        target: operation.target,
        annotations
      })
      if (!markdown || !isOperationCurrent(operation)) throw new Error('Annotation export is stale')
      await navigator.clipboard.writeText(markdown)
    } finally {
      if (operationRef.current === operation) operationRef.current = null
      copyInFlightRef.current = false
      store.setState((current) => ({ ...current, copying: false }))
    }
  }, [isOperationCurrent, requestSnapshot, state.count, store])

  const clear = useCallback(() => {
    const binding = bindingRef.current
    const sessionId = sessionRef.current
    if (!binding || !sessionId || !sendCommand(binding.webview, { type: 'clear', sessionId })) return false
    invalidateOperation('Annotations cleared')
    store.setState((current) => ({ ...current, count: 0, editor: null }))
    return true
  }, [invalidateOperation, sendCommand, store])

  return {
    enabled: state.enabled,
    count: state.count,
    ready: Boolean(webview && state.documentSessionId),
    copying: state.copying,
    editor: state.editor,
    toggle,
    setEditorDraft,
    saveEditor,
    cancelEditor,
    deleteEditor,
    clear,
    copy
  }
}
