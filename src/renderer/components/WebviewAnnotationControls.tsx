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
  WebviewAnnotationGuestEventSchema,
  type WebviewAnnotationHostCommand,
  type WebviewAnnotationState,
  type WebviewAnnotationTarget,
  type WebviewPendingSelection
} from '@shared/types/webview'
import { EditorContent } from '@tiptap/react'
import type { WebviewTag } from 'electron'
import { Copy, Loader2, MousePointer2, Trash2 } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'

const logger = loggerService.withContext('WebviewAnnotationControls')
const EMPTY_STATE: WebviewAnnotationState = { enabled: false, annotations: [] }
const WEBVIEW_ATTACH_MAX_ATTEMPTS = 300
const EDITOR_WIDTH_PX = 320
const EDITOR_ESTIMATED_HEIGHT_PX = 168
const EDITOR_MARGIN_PX = 8

type AnnotationEditorSession =
  | { mode: 'create'; selection: WebviewPendingSelection }
  | { mode: 'edit'; annotationId: string; anchor: WebviewAnchorRect }

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

  const locale = useMemo(() => ({ edit: t('webview.annotation.edit') }), [t])

  const sendCommand = useCallback(
    (command: WebviewAnnotationHostCommand, webview = webviewRef.current): boolean => {
      if (!webview || !isWebviewReady) return false
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

  useEffect(() => {
    setState(EMPTY_STATE)
    setEditorSession(null)
  }, [target.id])

  useEffect(() => {
    let attachedWebview: WebviewTag | null = null
    let retryTimer: ReturnType<typeof setTimeout> | null = null
    let disposed = false
    let attachAttempts = 0

    const handleGuestMessage = (event: Electron.IpcMessageEvent) => {
      if (event.channel !== WEBVIEW_ANNOTATION_BRIDGE_CHANNEL) return
      const parsed = WebviewAnnotationGuestEventSchema.safeParse(event.args[0])
      if (!parsed.success) return
      const guestEvent = parsed.data
      switch (guestEvent.type) {
        case 'state_changed': {
          const nextState = isHostActive ? guestEvent.state : { ...guestEvent.state, enabled: false }
          setState(nextState)
          void replaceMainSnapshot(nextState.annotations, attachedWebview)
          if (!isHostActive && guestEvent.state.enabled) {
            sendCommand({ type: 'set_enabled', enabled: false }, attachedWebview)
          }
          break
        }
        case 'selection_pending':
          if (isHostActive) setEditorSession({ mode: 'create', selection: guestEvent.selection })
          break
        case 'selection_cleared':
          setEditorSession((current) => (current?.mode === 'create' ? null : current))
          break
        case 'annotation_activated':
          if (isHostActive) {
            setEditorSession({ mode: 'edit', annotationId: guestEvent.id, anchor: guestEvent.anchor })
          }
          break
      }
    }

    const resetForNavigation = () => {
      setState(EMPTY_STATE)
      setEditorSession(null)
      sendCommand({ type: 'reset' }, attachedWebview)
      void replaceMainSnapshot([], attachedWebview)
    }

    const configureGuest = () => {
      sendCommand(
        {
          type: 'configure',
          locale,
          theme: theme === ThemeMode.dark ? 'dark' : 'light'
        },
        attachedWebview
      )
      sendCommand({ type: 'request_state' }, attachedWebview)
    }

    const detach = () => {
      if (!attachedWebview) return
      attachedWebview.removeEventListener('ipc-message', handleGuestMessage)
      attachedWebview.removeEventListener('did-start-loading', resetForNavigation)
      attachedWebview.removeEventListener('did-navigate', resetForNavigation)
      attachedWebview.removeEventListener('did-navigate-in-page', resetForNavigation)
      attachedWebview.removeEventListener('dom-ready', configureGuest)
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
      webview.addEventListener('did-start-loading', resetForNavigation)
      webview.addEventListener('did-navigate', resetForNavigation)
      webview.addEventListener('did-navigate-in-page', resetForNavigation)
      webview.addEventListener('dom-ready', configureGuest)
      configureGuest()
    }

    attach()
    return () => {
      disposed = true
      if (retryTimer) clearTimeout(retryTimer)
      if (attachedWebview) sendCommand({ type: 'set_enabled', enabled: false }, attachedWebview)
      detach()
    }
  }, [isHostActive, locale, replaceMainSnapshot, sendCommand, theme, webviewRef])

  useEffect(() => {
    if (!isWebviewReady) return
    sendCommand({
      type: 'configure',
      locale,
      theme: theme === ThemeMode.dark ? 'dark' : 'light'
    })
    sendCommand({ type: 'request_state' })
  }, [isWebviewReady, locale, sendCommand, theme])

  useEffect(() => {
    if (isHostActive || !state.enabled) return
    setState((current) => ({ ...current, enabled: false }))
    setEditorSession(null)
    sendCommand({ type: 'set_enabled', enabled: false })
  }, [isHostActive, sendCommand, state.enabled])

  const handleToggle = () => {
    const enabled = !state.enabled
    if (!sendCommand({ type: 'set_enabled', enabled })) return
    setState((current) => ({ ...current, enabled }))
    if (!enabled) setEditorSession(null)
  }

  const closeEditor = useCallback(
    (cancelPendingSelection: boolean) => {
      setEditorSession((current) => {
        if (cancelPendingSelection && current?.mode === 'create') sendCommand({ type: 'cancel_pending' })
        return null
      })
    },
    [sendCommand]
  )

  const handleEditorSave = useCallback(
    (comment: string) => {
      const session = editorSession
      if (!session) return
      if (session.mode === 'create') {
        const id = crypto.randomUUID()
        if (!sendCommand({ type: 'commit_pending', id, comment })) return
        const webview = webviewRef.current
        let url = ''
        let title = ''
        try {
          url = webview?.getURL() ?? ''
          title = webview?.getTitle() ?? ''
        } catch (error) {
          logger.debug('Webview page metadata is unavailable for the saved annotation', { targetId: target.id, error })
        }
        onAnnotationSaved?.({
          annotation: {
            id,
            comment,
            createdAt: Date.now(),
            element: session.selection.element,
            ...(session.selection.region ? { region: session.selection.region } : {})
          },
          page: { url, title }
        })
      } else {
        sendCommand({ type: 'update_annotation', id: session.annotationId, comment })
      }
      setEditorSession(null)
    },
    [editorSession, onAnnotationSaved, sendCommand, target.id, webviewRef]
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
          if (text) onSave(text)
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
        <Button type="button" size="sm" disabled={!trimmedComment} onClick={() => onSave(trimmedComment)}>
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
