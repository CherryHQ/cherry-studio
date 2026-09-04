import { Badge, Button, ConfirmDialog, Tooltip } from '@cherrystudio/ui'
import { cn } from '@cherrystudio/ui/lib/utils'
import { loggerService } from '@logger'
import { useTheme } from '@renderer/hooks/useTheme'
import { ipcApi } from '@renderer/ipc'
import { toast } from '@renderer/services/toast'
import { ThemeMode } from '@shared/data/preference/preferenceTypes'
import {
  WEBVIEW_ANNOTATION_BRIDGE_CHANNEL,
  type WebviewAnnotation,
  WebviewAnnotationGuestEventSchema,
  type WebviewAnnotationHostCommand,
  type WebviewAnnotationLocale,
  type WebviewAnnotationTarget
} from '@shared/types/webviewAnnotation'
import type { WebviewTag } from 'electron'
import { Copy, Loader2, MousePointer2, Trash2 } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

const logger = loggerService.withContext('WebviewAnnotationControls')
const SNAPSHOT_TIMEOUT_MS = 2_000
const EMPTY_STATE = { enabled: false, count: 0 }

interface Props {
  webview: WebviewTag | null
  isWebviewReady: boolean
  isHostActive: boolean
  target: WebviewAnnotationTarget
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

export function WebviewAnnotationControls({ webview, isWebviewReady, isHostActive, target }: Props) {
  const { t } = useTranslation()
  const { theme } = useTheme()
  const [state, setState] = useState(EMPTY_STATE)
  const [clearConfirmOpen, setClearConfirmOpen] = useState(false)
  const [isCopying, setIsCopying] = useState(false)
  const bindingRef = useRef<Binding | null>(null)
  const sessionRef = useRef<string | null>(null)
  const retiredSessionsRef = useRef(new Set<string>())
  const pendingSnapshotRef = useRef<PendingSnapshot | null>(null)
  const operationRef = useRef<CopyOperation | null>(null)
  const copyInFlightRef = useRef(false)
  const generationRef = useRef(0)
  const targetRef = useRef(target)
  const hostActiveRef = useRef(isHostActive)
  targetRef.current = target
  hostActiveRef.current = isHostActive

  const locale = useMemo<WebviewAnnotationLocale>(
    () => ({
      placeholder: t('webview.annotation.placeholder'),
      save: t('webview.annotation.save'),
      cancel: t('webview.annotation.cancel'),
      delete: t('webview.annotation.delete'),
      edit: t('webview.annotation.edit'),
      elementUnavailable: t('webview.annotation.element_unavailable')
    }),
    [t]
  )
  const configurationRef = useRef({ locale, theme: 'light' as 'light' | 'dark' })
  configurationRef.current = { locale, theme: theme === ThemeMode.dark ? 'dark' : 'light' }

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
      if (!event.isTrusted || event.currentTarget !== attachedWebview) return
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
    if (!isWebviewReady) return
    const binding = bindingRef.current
    const sessionId = sessionRef.current
    if (!binding || !sessionId) return
    sendCommand(binding.webview, { type: 'configure', sessionId, ...configurationRef.current })
  }, [isWebviewReady, locale, sendCommand, target.label, theme])

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

  const handleToggle = () => {
    const binding = bindingRef.current
    const sessionId = sessionRef.current
    if (!binding || !sessionId) return
    const enabled = !state.enabled
    if (!sendCommand(binding.webview, { type: 'set_enabled', sessionId, enabled })) return
    setState((current) => ({ ...current, enabled }))
  }

  const requestSnapshot = (operation: CopyOperation) =>
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
    })

  const isOperationCurrent = (operation: CopyOperation) => {
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
  }

  const handleCopy = async () => {
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
    setIsCopying(true)
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
      toast.success(t('webview.annotation.copied'))
    } catch (error) {
      logger.error('Failed to copy webview annotations', error as Error, { targetId: operation.target.id })
      toast.error(t('webview.annotation.copy_failed'))
    } finally {
      if (operationRef.current === operation) operationRef.current = null
      copyInFlightRef.current = false
      setIsCopying(false)
    }
  }

  const handleClear = () => {
    const binding = bindingRef.current
    const sessionId = sessionRef.current
    if (!binding || !sessionId || !sendCommand(binding.webview, { type: 'clear', sessionId })) return
    invalidateOperation('Annotations cleared')
    setClearConfirmOpen(false)
    setState((current) => ({ ...current, count: 0 }))
  }

  const disabled = !isWebviewReady || !isHostActive || !sessionRef.current
  const annotationLabel = state.enabled ? t('webview.annotation.disable_mode') : t('webview.annotation.enable_mode')

  return (
    <>
      <div className="flex items-center gap-0.5">
        <Tooltip content={annotationLabel} placement="bottom">
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            disabled={disabled}
            onClick={handleToggle}
            className={controlButtonClassName(state.enabled)}
            aria-label={annotationLabel}
            aria-pressed={state.enabled}>
            <MousePointer2 size={14} />
          </Button>
        </Tooltip>

        {state.count > 0 && (
          <>
            <Badge
              variant="secondary"
              className="h-4 min-w-4 border-0 px-1 text-[10px] text-muted-foreground tabular-nums"
              aria-label={t('webview.annotation.count', { count: state.count })}>
              {state.count}
            </Badge>
            <Tooltip content={t('webview.annotation.copy')} placement="bottom">
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                disabled={disabled || isCopying}
                onClick={() => void handleCopy()}
                className={controlButtonClassName()}
                aria-label={t('webview.annotation.copy')}>
                {isCopying ? <Loader2 size={14} className="animate-spin" /> : <Copy size={14} />}
              </Button>
            </Tooltip>
            <Tooltip content={t('webview.annotation.clear')} placement="bottom">
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                disabled={disabled}
                onClick={() => setClearConfirmOpen(true)}
                className={controlButtonClassName()}
                aria-label={t('webview.annotation.clear')}>
                <Trash2 size={14} />
              </Button>
            </Tooltip>
          </>
        )}
      </div>

      <ConfirmDialog
        open={clearConfirmOpen}
        onOpenChange={setClearConfirmOpen}
        title={t('webview.annotation.clear_title')}
        description={t('webview.annotation.clear_description')}
        confirmText={t('webview.annotation.clear')}
        cancelText={t('webview.annotation.cancel')}
        destructive
        onConfirm={handleClear}
      />
    </>
  )
}

const controlButtonClassName = (active = false) =>
  cn(
    'rounded shadow-none active:scale-95',
    active
      ? 'bg-primary/10 text-primary hover:bg-primary/15 hover:text-primary'
      : 'text-muted-foreground hover:text-foreground'
  )
