import { loggerService } from '@logger'
import { ipcApi } from '@renderer/ipc'
import {
  WEBVIEW_ANNOTATION_BRIDGE_CHANNEL,
  type WebviewAnnotation,
  WebviewAnnotationGuestEventSchema,
  type WebviewAnnotationHostCommand,
  type WebviewAnnotationLocale,
  type WebviewAnnotationTarget
} from '@shared/types/webviewAnnotation'
import type { WebviewTag } from 'electron'
import { useCallback, useEffect, useRef, useState } from 'react'

const logger = loggerService.withContext('useWebviewAnnotationSession')
const SNAPSHOT_TIMEOUT_MS = 2_000
const EMPTY_STATE = { enabled: false, count: 0 }

interface Options {
  webview: WebviewTag | null
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

export function useWebviewAnnotationSession({ webview, isHostActive, target, locale, theme }: Options) {
  const [state, setState] = useState(EMPTY_STATE)
  const [copying, setCopying] = useState(false)
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

  useEffect(() => {
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
    setState(EMPTY_STATE)

    const retireSession = (clear: boolean, message: string) => {
      const sessionId = sessionRef.current
      invalidateOperation(message)
      if (sessionId) {
        sendCommand(attachedWebview, { type: 'deactivate', sessionId })
        if (clear) sendCommand(attachedWebview, { type: 'clear', sessionId })
        retiredSessionsRef.current.add(sessionId)
      }
      sessionRef.current = null
      setState(EMPTY_STATE)
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
      setState({ enabled, count: guestEvent.count })
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
  }, [invalidateOperation, sendCommand, webview])

  const previousTargetIdRef = useRef(target.id)
  useEffect(() => {
    const previousTargetId = previousTargetIdRef.current
    previousTargetIdRef.current = target.id
    if (previousTargetId === target.id) return
    invalidateOperation('Annotation target changed')
    const binding = bindingRef.current
    const sessionId = sessionRef.current
    if (binding && sessionId) sendCommand(binding.webview, { type: 'clear', sessionId })
    setState(EMPTY_STATE)
  }, [invalidateOperation, sendCommand, target.id])

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
      setState((current) => ({ ...current, enabled: false }))
    } else {
      sendCommand(binding.webview, { type: 'request_state' })
    }
  }, [isHostActive, sendCommand])

  const toggle = useCallback(() => {
    const binding = bindingRef.current
    const sessionId = sessionRef.current
    if (!binding || !sessionId) return
    const enabled = !state.enabled
    if (!sendCommand(binding.webview, { type: 'set_enabled', sessionId, enabled })) return
    setState((current) => ({ ...current, enabled }))
  }, [sendCommand, state.enabled])

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
    setCopying(true)
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
      setCopying(false)
    }
  }, [isOperationCurrent, requestSnapshot, state.count])

  const clear = useCallback(() => {
    const binding = bindingRef.current
    const sessionId = sessionRef.current
    if (!binding || !sessionId || !sendCommand(binding.webview, { type: 'clear', sessionId })) return false
    invalidateOperation('Annotations cleared')
    setState((current) => ({ ...current, count: 0 }))
    return true
  }, [invalidateOperation, sendCommand])

  return {
    ...state,
    ready: Boolean(webview && sessionRef.current),
    copying,
    toggle,
    clear,
    copy
  }
}
