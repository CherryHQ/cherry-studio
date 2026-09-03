import { Badge, Button, ConfirmDialog, Tooltip } from '@cherrystudio/ui'
import { cn } from '@cherrystudio/ui/lib/utils'
import { loggerService } from '@logger'
import { createComposerDraftContent, serializeComposerDocument } from '@renderer/components/composer/composerDraft'
import { createComposerEditorPreset } from '@renderer/components/composer/composerPreset'
import { useRichTextEditorKernel } from '@renderer/components/RichEditor/useRichTextEditorKernel'
import { useTheme } from '@renderer/hooks/useTheme'
import { ipcApi } from '@renderer/ipc'
import { toast } from '@renderer/services/toast'
import { ThemeMode } from '@shared/data/preference/preferenceTypes'
import {
  WEBVIEW_ANNOTATION_BRIDGE_CHANNEL,
  WEBVIEW_ANNOTATION_LIMITS,
  type WebviewAnchorRect,
  type WebviewAnnotation,
  type WebviewAnnotationGuestEvent,
  WebviewAnnotationGuestEventSchema,
  type WebviewAnnotationHostCommand,
  type WebviewAnnotationState,
  type WebviewAnnotationTarget,
  type WebviewPendingSelection
} from '@shared/types/webview'
import { EditorContent } from '@tiptap/react'
import type { WebviewTag } from 'electron'
import { Copy, Loader2, MousePointer2, Trash2 } from 'lucide-react'
import { useCallback, useEffect, useEffectEvent, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'

const logger = loggerService.withContext('WebviewAnnotationControls')
const EMPTY_STATE: WebviewAnnotationState = { enabled: false, annotations: [] }
const WEBVIEW_ATTACH_MAX_ATTEMPTS = 300
const EDITOR_WIDTH_PX = 320
const EDITOR_ESTIMATED_HEIGHT_PX = 168
const EDITOR_MARGIN_PX = 8
const WEBVIEW_ANNOTATION_COMMIT_TIMEOUT_MS = 5_000

type AnnotationEditorSession =
  | { mode: 'create'; selection: WebviewPendingSelection }
  | { mode: 'edit'; annotationId: string; anchor: WebviewAnchorRect }

interface AnnotationDocumentOwner {
  documentId: string
  targetId: string
  webview: WebviewTag
}

type AnnotationDocumentConfiguration = Pick<
  Extract<WebviewAnnotationHostCommand, { type: 'configure' }>,
  'locale' | 'theme'
>

interface CurrentAnnotationDocument extends AnnotationDocumentOwner {
  confirmedConfiguration: AnnotationDocumentConfiguration | null
  configurationAttempt: number
  pendingConfiguration: AnnotationDocumentConfiguration | null
}

interface CreateSaveAttempt extends AnnotationDocumentOwner {
  attempt: number
  id: string
}

interface PendingCreateSave extends CreateSaveAttempt {
  page: WebviewAnnotationSavedPayload['page']
  status: 'awaiting' | 'retryable'
  timeout: ReturnType<typeof setTimeout> | null
}

function isSameCreateSaveAttempt(pending: PendingCreateSave, attempt: CreateSaveAttempt) {
  return (
    pending.id === attempt.id &&
    pending.attempt === attempt.attempt &&
    pending.documentId === attempt.documentId &&
    pending.targetId === attempt.targetId &&
    pending.webview === attempt.webview
  )
}

export interface WebviewAnnotationSavedPayload {
  annotation: WebviewAnnotation
  page: { url: string; title: string }
}

interface Props {
  webviewRef: React.RefObject<WebviewTag | null>
  isWebviewReady: boolean
  isHostActive: boolean
  target: WebviewAnnotationTarget
  onAnnotationSaved?: (payload: WebviewAnnotationSavedPayload) => void
}

export function WebviewAnnotationControls({
  webviewRef,
  isWebviewReady,
  isHostActive,
  target,
  onAnnotationSaved
}: Props) {
  const { t } = useTranslation()
  const { theme } = useTheme()
  const [state, setState] = useState<WebviewAnnotationState>(EMPTY_STATE)
  const [clearConfirmOpen, setClearConfirmOpen] = useState(false)
  const [isCopying, setIsCopying] = useState(false)
  const [editorSession, setEditorSession] = useState<AnnotationEditorSession | null>(null)
  const [isCreateSaving, setIsCreateSaving] = useState(false)
  const pendingCreateSaveRef = useRef<PendingCreateSave | null>(null)
  const currentDocumentRef = useRef<CurrentAnnotationDocument | null>(null)
  const awaitingDocumentReadyRef = useRef(false)
  const isMountedRef = useRef(false)
  const currentWebview = webviewRef.current
  const committedOwnerRef = useRef({ isHostActive, targetId: target.id, webview: currentWebview })

  useLayoutEffect(() => {
    isMountedRef.current = true
    return () => {
      isMountedRef.current = false
      const pending = pendingCreateSaveRef.current
      if (pending?.timeout) clearTimeout(pending.timeout)
      pendingCreateSaveRef.current = null
      currentDocumentRef.current = null
      awaitingDocumentReadyRef.current = false
    }
  }, [])

  useLayoutEffect(() => {
    committedOwnerRef.current = { isHostActive, targetId: target.id, webview: currentWebview }
  }, [currentWebview, isHostActive, target.id])

  const locale = useMemo(() => ({ edit: t('webview.annotation.edit') }), [t])

  const sendCommand = useCallback(
    (command: WebviewAnnotationHostCommand, webview = webviewRef.current): boolean => {
      if (!webview || !isWebviewReady) return false
      const document = currentDocumentRef.current
      if (!document || document.targetId !== target.id || document.webview !== webview) return false
      try {
        void webview.send(WEBVIEW_ANNOTATION_BRIDGE_CHANNEL, command).catch((error) => {
          logger.debug('Failed to send webview annotation command', { targetId: target.id, error })
        })
        return true
      } catch (error) {
        logger.debug('Webview annotation guest is not ready', { targetId: target.id, error })
        return false
      }
    },
    [isWebviewReady, target.id, webviewRef]
  )

  const replaceMainSnapshot = useCallback(
    async (annotations: WebviewAnnotation[], webview = webviewRef.current) => {
      if (!webview) return false
      try {
        const webviewId = webview.getWebContentsId()
        if (!webviewId) return false
        await ipcApi.request('webview.replace_annotations', { webviewId, target, annotations })
        return true
      } catch (error) {
        logger.debug('Failed to synchronize webview annotations', { targetId: target.id, error })
        return false
      }
    },
    [target, webviewRef]
  )

  const setPendingCreateSave = useCallback((next: PendingCreateSave | null) => {
    const current = pendingCreateSaveRef.current
    if (current?.timeout && current.timeout !== next?.timeout) clearTimeout(current.timeout)
    pendingCreateSaveRef.current = next
    setIsCreateSaving(next?.status === 'awaiting')
  }, [])

  const clearPendingCreateSave = useCallback(
    (id?: string) => {
      const pending = pendingCreateSaveRef.current
      if (!pending || (id && pending.id !== id)) return false
      setPendingCreateSave(null)
      return true
    },
    [setPendingCreateSave]
  )

  const isCurrentDocument = useCallback((document: AnnotationDocumentOwner) => {
    if (!isMountedRef.current) return false
    const current = currentDocumentRef.current
    const owner = committedOwnerRef.current
    return (
      !!current &&
      current.documentId === document.documentId &&
      current.targetId === document.targetId &&
      current.webview === document.webview &&
      owner.targetId === document.targetId &&
      owner.webview === document.webview
    )
  }, [])

  const isCurrentDocumentConfigurationAttempt = useCallback(
    (attempt: CurrentAnnotationDocument) =>
      isCurrentDocument(attempt) && currentDocumentRef.current?.configurationAttempt === attempt.configurationAttempt,
    [isCurrentDocument]
  )

  const isCurrentCreateSaveAttempt = useCallback(
    (attempt: CreateSaveAttempt) => {
      const pending = pendingCreateSaveRef.current
      return (
        !!pending &&
        isSameCreateSaveAttempt(pending, attempt) &&
        committedOwnerRef.current.isHostActive &&
        isCurrentDocument(attempt)
      )
    },
    [isCurrentDocument]
  )

  const markCreateSaveRetryable = useCallback(
    (attempt: CreateSaveAttempt) => {
      const pending = pendingCreateSaveRef.current
      if (!pending || pending.status !== 'awaiting' || !isCurrentCreateSaveAttempt(attempt)) return false
      setPendingCreateSave({ ...pending, status: 'retryable', timeout: null })
      return true
    },
    [isCurrentCreateSaveAttempt, setPendingCreateSave]
  )

  const requestDocumentState = useCallback(
    (document: AnnotationDocumentOwner) => {
      if (!isCurrentDocument(document)) return
      try {
        void document.webview.send(WEBVIEW_ANNOTATION_BRIDGE_CHANNEL, { type: 'request_state' }).catch((error) => {
          if (!isCurrentDocument(document)) return
          logger.debug('Failed to request webview annotation state', { targetId: document.targetId, error })
        })
      } catch (error) {
        if (!isCurrentDocument(document)) return
        logger.debug('Webview annotation guest is not ready to report state', {
          targetId: document.targetId,
          error
        })
      }
    },
    [isCurrentDocument]
  )

  const configureDocument = useCallback(
    (document: AnnotationDocumentOwner) => {
      const current = currentDocumentRef.current
      if (!current || !isCurrentDocument(document)) return false
      const nextConfiguration: AnnotationDocumentConfiguration = {
        locale,
        theme: theme === ThemeMode.dark ? 'dark' : 'light'
      }
      if (
        (current.pendingConfiguration?.locale.edit === nextConfiguration.locale.edit &&
          current.pendingConfiguration.theme === nextConfiguration.theme) ||
        (!current.pendingConfiguration &&
          current.confirmedConfiguration?.locale.edit === nextConfiguration.locale.edit &&
          current.confirmedConfiguration.theme === nextConfiguration.theme)
      ) {
        return false
      }

      const attempt: CurrentAnnotationDocument = {
        ...current,
        configurationAttempt: current.configurationAttempt + 1,
        pendingConfiguration: nextConfiguration
      }
      currentDocumentRef.current = attempt

      const handleFailure = (error: unknown) => {
        if (!isCurrentDocumentConfigurationAttempt(attempt)) return
        if (attempt.confirmedConfiguration) {
          currentDocumentRef.current = { ...attempt, pendingConfiguration: null }
        } else {
          currentDocumentRef.current = null
          clearPendingCreateSave()
          setState(EMPTY_STATE)
          setEditorSession(null)
        }
        logger.debug('Failed to configure webview annotations', { targetId: attempt.targetId, error })
      }

      try {
        void attempt.webview
          .send(WEBVIEW_ANNOTATION_BRIDGE_CHANNEL, {
            type: 'configure',
            documentId: attempt.documentId,
            ...nextConfiguration
          })
          .then(() => {
            if (!isCurrentDocumentConfigurationAttempt(attempt)) return
            const configured = {
              ...attempt,
              confirmedConfiguration: nextConfiguration,
              pendingConfiguration: null
            }
            currentDocumentRef.current = configured
            requestDocumentState(configured)
          }, handleFailure)
      } catch (error) {
        handleFailure(error)
      }
      return true
    },
    [
      clearPendingCreateSave,
      isCurrentDocument,
      isCurrentDocumentConfigurationAttempt,
      locale,
      requestDocumentState,
      theme
    ]
  )

  const handleGuestEvent = useEffectEvent(
    (guestEvent: WebviewAnnotationGuestEvent, eventWebview: WebviewTag | null, listenerTargetId: string) => {
      if (
        !isMountedRef.current ||
        !eventWebview ||
        eventWebview !== webviewRef.current ||
        listenerTargetId !== target.id
      ) {
        return
      }

      const document = currentDocumentRef.current
      if (!document || guestEvent.documentId !== document.documentId || !isCurrentDocument(document)) return

      switch (guestEvent.type) {
        case 'state_changed': {
          const nextState = isHostActive ? guestEvent.state : { ...guestEvent.state, enabled: false }
          setState(nextState)
          setEditorSession((current) =>
            current?.mode === 'edit' && !guestEvent.state.annotations.some(({ id }) => id === current.annotationId)
              ? null
              : current
          )
          void replaceMainSnapshot(nextState.annotations, eventWebview)
          const pending = pendingCreateSaveRef.current
          const savedAnnotation = pending
            ? guestEvent.state.annotations.find((annotation) => annotation.id === pending.id)
            : undefined
          if (
            isHostActive &&
            pending &&
            pending.documentId === guestEvent.documentId &&
            pending.targetId === target.id &&
            pending.webview === eventWebview &&
            savedAnnotation &&
            clearPendingCreateSave(pending.id)
          ) {
            setEditorSession(null)
            onAnnotationSaved?.({ annotation: savedAnnotation, page: pending.page })
          }
          if (!isHostActive && guestEvent.state.enabled) {
            sendCommand({ type: 'set_enabled', enabled: false }, eventWebview)
          }
          break
        }
        case 'selection_pending':
          if (isHostActive) setEditorSession({ mode: 'create', selection: guestEvent.selection })
          break
        case 'selection_cleared':
          clearPendingCreateSave()
          setEditorSession((current) => (current?.mode === 'create' ? null : current))
          break
        case 'annotation_activated':
          if (isHostActive) {
            setEditorSession({ mode: 'edit', annotationId: guestEvent.id, anchor: guestEvent.anchor })
          }
          break
      }
    }
  )

  const disableGuest = useEffectEvent((webview: WebviewTag) => {
    if (!isWebviewReady) return
    try {
      void webview.send(WEBVIEW_ANNOTATION_BRIDGE_CHANNEL, { type: 'set_enabled', enabled: false }).catch((error) => {
        logger.debug('Failed to disable webview annotations', { targetId: target.id, error })
      })
    } catch (error) {
      logger.debug('Webview annotation guest is not ready to disable', { targetId: target.id, error })
    }
  })

  const startDocument = useEffectEvent((webview: WebviewTag | null, listenerTargetId: string) => {
    if (!isMountedRef.current || !webview || webview !== webviewRef.current || listenerTargetId !== target.id) return
    awaitingDocumentReadyRef.current = false
    currentDocumentRef.current = null
    clearPendingCreateSave()
    setState(EMPTY_STATE)
    setEditorSession(null)
    const document: CurrentAnnotationDocument = {
      confirmedConfiguration: null,
      configurationAttempt: 0,
      documentId: crypto.randomUUID(),
      pendingConfiguration: null,
      targetId: listenerTargetId,
      webview
    }
    currentDocumentRef.current = document
    configureDocument(document)
    void replaceMainSnapshot([], webview)
  })

  const startFullNavigation = useEffectEvent((webview: WebviewTag | null, listenerTargetId: string) => {
    if (!isMountedRef.current || !webview || webview !== webviewRef.current || listenerTargetId !== target.id) return
    awaitingDocumentReadyRef.current = true
    currentDocumentRef.current = null
    clearPendingCreateSave()
    setState(EMPTY_STATE)
    setEditorSession(null)
    void replaceMainSnapshot([], webview)
  })

  const initializeAttachedWebview = useEffectEvent((webview: WebviewTag, listenerTargetId: string) => {
    if (!isMountedRef.current || webview !== webviewRef.current || listenerTargetId !== target.id) return
    const document = currentDocumentRef.current
    if (document && isCurrentDocument(document)) {
      const configurationSent = configureDocument(document)
      if (!configurationSent && !currentDocumentRef.current?.pendingConfiguration) {
        requestDocumentState(document)
      }
      return
    }
    if (isWebviewReady && !awaitingDocumentReadyRef.current) startDocument(webview, listenerTargetId)
  })

  useEffect(() => {
    currentDocumentRef.current = null
    awaitingDocumentReadyRef.current = false
    clearPendingCreateSave()
    setState(EMPTY_STATE)
    setEditorSession(null)
  }, [clearPendingCreateSave, target.id])

  useEffect(() => {
    const pending = pendingCreateSaveRef.current
    if (pending && pending.webview !== currentWebview) clearPendingCreateSave(pending.id)
    const document = currentDocumentRef.current
    if (document && document.webview !== currentWebview) {
      currentDocumentRef.current = null
      awaitingDocumentReadyRef.current = false
    }
  }, [clearPendingCreateSave, currentWebview])

  useEffect(() => {
    if (!isWebviewReady) return
    const document = currentDocumentRef.current
    if (document && isCurrentDocument(document)) {
      const configurationSent = configureDocument(document)
      if (!configurationSent && !document.pendingConfiguration) requestDocumentState(document)
      return
    }
    if (!awaitingDocumentReadyRef.current) startDocument(webviewRef.current, target.id)
    // startDocument is an Effect Event: it reads current owner state without making this effect reactive.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [configureDocument, isCurrentDocument, isWebviewReady, locale, requestDocumentState, target.id, theme, webviewRef])

  useEffect(() => {
    let attachedWebview: WebviewTag | null = null
    let retryTimer: ReturnType<typeof setTimeout> | null = null
    let disposed = false
    let attachAttempts = 0

    const handleGuestMessage = (event: Electron.IpcMessageEvent) => {
      if (event.channel !== WEBVIEW_ANNOTATION_BRIDGE_CHANNEL) return
      const parsed = WebviewAnnotationGuestEventSchema.safeParse(event.args[0])
      if (!parsed.success) return
      handleGuestEvent(parsed.data, attachedWebview, target.id)
    }

    const handleDomReady = () => startDocument(attachedWebview, target.id)
    const handleDocumentNavigation = () => startFullNavigation(attachedWebview, target.id)
    const handleInPageNavigation = () => {
      if (awaitingDocumentReadyRef.current) return
      startDocument(attachedWebview, target.id)
    }

    const detach = () => {
      if (!attachedWebview) return
      attachedWebview.removeEventListener('ipc-message', handleGuestMessage)
      attachedWebview.removeEventListener('did-start-loading', handleDocumentNavigation)
      attachedWebview.removeEventListener('did-navigate-in-page', handleInPageNavigation)
      attachedWebview.removeEventListener('dom-ready', handleDomReady)
      attachedWebview = null
    }

    const attach = () => {
      if (disposed) return
      const webview = webviewRef.current
      if (!webview) {
        attachAttempts++
        if (!isHostActive || attachAttempts >= WEBVIEW_ATTACH_MAX_ATTEMPTS) return
        retryTimer = setTimeout(attach, 100)
        return
      }
      if (attachedWebview === webview) return

      detach()
      attachedWebview = webview
      webview.addEventListener('ipc-message', handleGuestMessage)
      webview.addEventListener('did-start-loading', handleDocumentNavigation)
      webview.addEventListener('did-navigate-in-page', handleInPageNavigation)
      webview.addEventListener('dom-ready', handleDomReady)
      initializeAttachedWebview(webview, target.id)
    }

    attach()
    return () => {
      disposed = true
      if (retryTimer) clearTimeout(retryTimer)
      if (attachedWebview) disableGuest(attachedWebview)
      detach()
    }
    // Effect Events read current configuration and owner state without reconnecting guest listeners.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentWebview, isHostActive, target.id])

  useEffect(() => {
    if (isHostActive) return
    clearPendingCreateSave()
    setEditorSession(null)
    if (state.enabled) {
      setState((current) => ({ ...current, enabled: false }))
      sendCommand({ type: 'set_enabled', enabled: false })
    }
  }, [clearPendingCreateSave, isHostActive, sendCommand, state.enabled])

  const handleToggle = () => {
    const enabled = !state.enabled
    if (!sendCommand({ type: 'set_enabled', enabled })) return
    setState((current) => ({ ...current, enabled }))
    if (!enabled) setEditorSession(null)
  }

  const closeEditor = useCallback(
    (cancelPendingSelection: boolean) => {
      clearPendingCreateSave()
      setEditorSession((current) => {
        if (cancelPendingSelection && current?.mode === 'create') sendCommand({ type: 'cancel_pending' })
        return null
      })
    },
    [clearPendingCreateSave, sendCommand]
  )

  const requestCreateSaveState = useCallback(
    (attempt: CreateSaveAttempt) => {
      if (!isCurrentCreateSaveAttempt(attempt)) return
      try {
        void attempt.webview.send(WEBVIEW_ANNOTATION_BRIDGE_CHANNEL, { type: 'request_state' }).catch((error) => {
          if (!markCreateSaveRetryable(attempt)) return
          logger.debug('Failed to request committed webview annotation state', {
            targetId: attempt.targetId,
            error
          })
        })
      } catch (error) {
        if (!markCreateSaveRetryable(attempt)) return
        logger.debug('Webview annotation guest is not ready to report committed state', {
          targetId: attempt.targetId,
          error
        })
      }
    },
    [isCurrentCreateSaveAttempt, markCreateSaveRetryable]
  )

  const handleEditorSave = useCallback(
    (comment: string) => {
      const session = editorSession
      if (!session) return
      if (session.mode === 'create') {
        const pending = pendingCreateSaveRef.current
        if (pending?.status === 'awaiting') return
        const webview = webviewRef.current
        const document = currentDocumentRef.current
        if (!webview || !isWebviewReady || !document || !isCurrentDocument(document)) return
        if (
          pending &&
          (pending.documentId !== document.documentId || pending.targetId !== target.id || pending.webview !== webview)
        ) {
          return
        }

        let page = pending?.page
        if (!page) {
          let url = ''
          let title = ''
          try {
            url = webview.getURL()
            title = webview.getTitle()
          } catch (error) {
            logger.debug('Webview page metadata is unavailable for the saved annotation', {
              targetId: target.id,
              error
            })
          }
          page = { url, title }
        }

        const attempt: CreateSaveAttempt = {
          attempt: (pending?.attempt ?? 0) + 1,
          documentId: document.documentId,
          id: pending?.id ?? crypto.randomUUID(),
          targetId: target.id,
          webview
        }
        const timeout = setTimeout(() => {
          if (!markCreateSaveRetryable(attempt)) return
          logger.debug('Timed out waiting for the webview annotation commit', {
            targetId: attempt.targetId,
            id: attempt.id
          })
        }, WEBVIEW_ANNOTATION_COMMIT_TIMEOUT_MS)
        setPendingCreateSave({ ...attempt, page, status: 'awaiting', timeout })
        try {
          void webview
            .send(WEBVIEW_ANNOTATION_BRIDGE_CHANNEL, { type: 'commit_pending', id: attempt.id, comment })
            .then(
              () => requestCreateSaveState(attempt),
              (error) => {
                if (!markCreateSaveRetryable(attempt)) return
                logger.debug('Failed to send webview annotation command', { targetId: attempt.targetId, error })
              }
            )
        } catch (error) {
          if (markCreateSaveRetryable(attempt)) {
            logger.debug('Webview annotation guest is not ready', { targetId: attempt.targetId, error })
          }
        }
      } else {
        sendCommand({ type: 'update_annotation', id: session.annotationId, comment })
        setEditorSession(null)
      }
    },
    [
      editorSession,
      isCurrentDocument,
      isWebviewReady,
      markCreateSaveRetryable,
      requestCreateSaveState,
      sendCommand,
      setPendingCreateSave,
      target.id,
      webviewRef
    ]
  )

  const handleEditorDelete = useCallback(() => {
    if (editorSession?.mode !== 'edit') return
    sendCommand({ type: 'delete_annotation', id: editorSession.annotationId })
    setEditorSession(null)
  }, [editorSession, sendCommand])

  const handleCopy = async () => {
    const webview = webviewRef.current
    if (!webview || state.annotations.length === 0) return
    const webviewId = webview.getWebContentsId()
    if (!webviewId) return
    setIsCopying(true)
    try {
      const synchronized = await replaceMainSnapshot(state.annotations, webview)
      if (!synchronized) throw new Error('Failed to synchronize current webview annotations')
      const markdown = await ipcApi.request('webview.get_annotations_markdown', { webviewId })
      if (!markdown) throw new Error('No current webview annotations were found')
      await navigator.clipboard.writeText(markdown)
      toast.success(t('webview.annotation.copied'))
    } catch (error) {
      logger.error('Failed to copy webview annotations', error as Error, { targetId: target.id })
      toast.error(t('webview.annotation.copy_failed'))
    } finally {
      setIsCopying(false)
    }
  }

  const handleClear = () => {
    if (!sendCommand({ type: 'clear' })) return
    clearPendingCreateSave()
    setEditorSession(null)
    setClearConfirmOpen(false)
    setState((current) => ({ ...current, annotations: [] }))
    void replaceMainSnapshot([])
  }

  const count = state.annotations.length
  const disabled = !isWebviewReady || !isHostActive
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

        {count > 0 && (
          <>
            <Badge
              variant="secondary"
              className="h-4 min-w-4 border-0 px-1 text-[10px] text-foreground-secondary tabular-nums"
              aria-label={t('webview.annotation.count', { count })}>
              {count}
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

      {editorSession ? (
        <WebviewAnnotationEditor
          key={editorSession.mode === 'edit' ? editorSession.annotationId : 'create'}
          webviewRef={webviewRef}
          anchor={editorSession.mode === 'create' ? editorSession.selection.anchor : editorSession.anchor}
          initialComment={
            editorSession.mode === 'edit'
              ? (state.annotations.find((annotation) => annotation.id === editorSession.annotationId)?.comment ?? '')
              : ''
          }
          canDelete={editorSession.mode === 'edit'}
          isSaving={editorSession.mode === 'create' && isCreateSaving}
          onSave={handleEditorSave}
          onCancel={() => closeEditor(true)}
          onDelete={handleEditorDelete}
        />
      ) : null}
    </>
  )
}

interface WebviewAnnotationEditorProps {
  webviewRef: React.RefObject<WebviewTag | null>
  anchor: WebviewAnchorRect
  initialComment: string
  canDelete: boolean
  isSaving: boolean
  onSave: (comment: string) => void
  onCancel: () => void
  onDelete: () => void
}

/**
 * Host-rendered comment editor anchored over the WebView at the guest-reported
 * selection rect. Reuses the composer's editor kernel and schema preset so the
 * input behaves and evolves with the chat composer, minus its chrome.
 */
function WebviewAnnotationEditor({
  webviewRef,
  anchor,
  initialComment,
  canDelete,
  isSaving,
  onSave,
  onCancel,
  onDelete
}: WebviewAnnotationEditorProps) {
  const { t } = useTranslation()
  const [comment, setComment] = useState(initialComment)
  const trimmedComment = comment.trim().slice(0, WEBVIEW_ANNOTATION_LIMITS.comment)

  // Captured once per anchor; the popover stays put if the guest page scrolls underneath.
  const position = useMemo(() => {
    const bounds =
      webviewRef.current?.getBoundingClientRect() ?? new DOMRect(0, 0, window.innerWidth, window.innerHeight)
    const maxLeft = Math.max(bounds.left + EDITOR_MARGIN_PX, bounds.right - EDITOR_WIDTH_PX - EDITOR_MARGIN_PX)
    const left = Math.min(Math.max(bounds.left + anchor.x, bounds.left + EDITOR_MARGIN_PX), maxLeft)
    const viewportBottom = Math.min(bounds.bottom, window.innerHeight)
    let top = bounds.top + anchor.y + anchor.height + EDITOR_MARGIN_PX
    if (top + EDITOR_ESTIMATED_HEIGHT_PX > viewportBottom - EDITOR_MARGIN_PX) {
      top = Math.max(
        bounds.top + EDITOR_MARGIN_PX,
        bounds.top + anchor.y - EDITOR_ESTIMATED_HEIGHT_PX - EDITOR_MARGIN_PX
      )
    }
    return { left, top }
  }, [anchor, webviewRef])

  const extensions = useMemo(
    () => createComposerEditorPreset({ placeholder: t('webview.annotation.placeholder') }),
    [t]
  )
  const initialContent = useMemo(
    () => createComposerDraftContent({ text: initialComment, tokens: [] }),
    [initialComment]
  )
  const editor = useRichTextEditorKernel({
    extensions,
    content: initialContent,
    immediatelyRender: false,
    editorProps: {
      attributes: {
        'aria-label': t('webview.annotation.placeholder'),
        class:
          'max-h-40 min-h-20 overflow-y-auto rounded-md border border-input bg-transparent px-2.5 py-2 text-sm outline-none focus-visible:border-primary'
      },
      handleKeyDown: (view, event) => {
        if (event.key === 'Escape') {
          onCancel()
          return true
        }
        if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
          const text = serializeComposerDocument(view.state.doc.toJSON())
            .text.trim()
            .slice(0, WEBVIEW_ANNOTATION_LIMITS.comment)
          if (text && !isSaving) onSave(text)
          return true
        }
        return false
      }
    },
    onCreate: ({ editor: created }) => created.commands.focus('end'),
    onUpdate: ({ editor: updated }) => setComment(serializeComposerDocument(updated).text)
  })

  return createPortal(
    <div
      role="dialog"
      aria-label={t('webview.annotation.placeholder')}
      className="fixed z-50 flex flex-col gap-2 rounded-lg border border-border bg-popover p-3 shadow-lg"
      style={{ left: position.left, top: position.top, width: EDITOR_WIDTH_PX }}>
      <EditorContent editor={editor} />
      <div className="flex items-center gap-2">
        {canDelete ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="text-destructive hover:text-destructive"
            onClick={onDelete}>
            {t('webview.annotation.delete')}
          </Button>
        ) : null}
        <div className="flex-1" />
        <Button type="button" variant="outline" size="sm" onClick={onCancel}>
          {t('webview.annotation.cancel')}
        </Button>
        <Button
          type="button"
          size="sm"
          loading={isSaving}
          disabled={!trimmedComment || isSaving}
          onClick={() => onSave(trimmedComment)}>
          {t('webview.annotation.save')}
        </Button>
      </div>
    </div>,
    document.body
  )
}

const controlButtonClassName = (active = false) =>
  cn(
    'rounded shadow-none active:scale-95',
    active
      ? 'bg-primary/10 text-primary hover:bg-primary/15 hover:text-primary'
      : 'text-foreground-secondary hover:text-foreground'
  )
