import { EditorContent } from '@tiptap/react'
import type { WebviewTag } from 'electron'
import { Copy, Loader2, MousePointer2, Trash2 } from 'lucide-react'
import type { RefObject } from 'react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Badge, Button, ConfirmDialog, Popover, PopoverAnchor, PopoverContent, Tooltip } from '@cherrystudio/ui'
import { cn } from '@cherrystudio/ui/lib/utils'
import { loggerService } from '@logger'
import { createComposerDraftContent, serializeComposerDocument } from '@renderer/components/composer/composerDraft'
import { createComposerEditorPreset } from '@renderer/components/composer/composerPreset'
import { useRichTextEditorKernel } from '@renderer/components/RichEditor/useRichTextEditorKernel'
import { useTheme } from '@renderer/hooks/useTheme'
import { toast } from '@renderer/services/toast'
import { ThemeMode } from '@shared/data/preference/preferenceTypes'
import {
  WEBVIEW_ANNOTATION_LIMITS,
  type WebviewAnnotationLocale,
  type WebviewAnnotationTarget
} from '@shared/types/webviewAnnotation'

import { useWebviewAnnotationSession, type WebviewAnnotationSavedPayload } from './useWebviewAnnotationSession'

const logger = loggerService.withContext('WebviewAnnotationControls')

interface Props {
  webviewRef: RefObject<WebviewTag | null>
  webviewRevision: number
  isWebviewReady: boolean
  isHostActive: boolean
  target: WebviewAnnotationTarget
  onAnnotationSaved?: (payload: WebviewAnnotationSavedPayload) => void
}

export function WebviewAnnotationControls({
  webviewRef,
  webviewRevision,
  isWebviewReady,
  isHostActive,
  target,
  onAnnotationSaved
}: Props) {
  const { t } = useTranslation()
  const { theme } = useTheme()
  const editorFallbackAnchorRef = useRef<HTMLDivElement>(null)
  const [clearConfirmTargetId, setClearConfirmTargetId] = useState<string | null>(null)
  const locale = useMemo<WebviewAnnotationLocale>(
    () => ({
      edit: t('webview.annotation.edit')
    }),
    [t]
  )
  useEffect(() => setClearConfirmTargetId(null), [target.id])
  const {
    enabled,
    count,
    ready,
    copying,
    editor,
    toggle,
    setEditorDraft,
    saveEditor,
    cancelEditor,
    deleteEditor,
    clear,
    copy
  } = useWebviewAnnotationSession({
    webviewRef,
    webviewRevision,
    isHostActive,
    target,
    locale,
    theme: theme === ThemeMode.dark ? 'dark' : 'light',
    onAnnotationSaved
  })

  const handleCopy = async () => {
    try {
      if (await copy()) toast.success(t('webview.annotation.copied'))
    } catch (error) {
      logger.error('Failed to copy webview annotations', error as Error, { targetId: target.id })
      toast.error(t('webview.annotation.copy_failed'))
    }
  }

  const handleClear = () => {
    if (clearConfirmTargetId !== target.id) return false
    return clear()
  }

  const disabled = !isWebviewReady || !isHostActive || !ready
  const annotationLabel = enabled ? t('webview.annotation.disable_mode') : t('webview.annotation.enable_mode')
  const annotationToggleLabel =
    count > 0 ? `${annotationLabel}, ${t('webview.annotation.count', { count })}` : annotationLabel
  const editorAnchorRect = editor?.anchor
  const editorUnavailable = editor?.error === 'element_unavailable'
  const editorAnchor = useMemo<RefObject<{ getBoundingClientRect: () => DOMRect }> | null>(() => {
    if (!editorAnchorRect) return null
    return {
      current: {
        getBoundingClientRect: () => {
          if (editorUnavailable) return editorFallbackAnchorRef.current?.getBoundingClientRect() ?? DOMRect.fromRect()
          const webviewRect = webviewRef.current?.getBoundingClientRect()
          if (!webviewRect) return DOMRect.fromRect()
          return DOMRect.fromRect({
            x: webviewRect.left + editorAnchorRect.x,
            y: webviewRect.top + editorAnchorRect.y,
            width: editorAnchorRect.width,
            height: editorAnchorRect.height
          })
        }
      }
    }
  }, [editorAnchorRect, editorUnavailable, webviewRef])

  return (
    <>
      <Popover
        open={Boolean(editor)}
        onOpenChange={(open) => {
          if (!open) void cancelEditor()
        }}>
        <div ref={editorFallbackAnchorRef} className="flex items-center gap-0.5">
          <Tooltip content={annotationLabel} placement="bottom">
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              disabled={disabled}
              onClick={() => void toggle()}
              className={cn(controlButtonClassName(enabled), count > 0 && 'h-7 w-auto gap-1 px-1.5')}
              aria-label={annotationToggleLabel}
              aria-pressed={enabled}>
              <MousePointer2 size={14} />
              {count > 0 && (
                <Badge
                  variant="secondary"
                  className="pointer-events-none h-4 min-w-4 border-0 px-1 text-[10px] text-muted-foreground tabular-nums"
                  aria-hidden>
                  {count}
                </Badge>
              )}
            </Button>
          </Tooltip>

          {count > 0 && (
            <>
              <Tooltip content={t('webview.annotation.copy')} placement="bottom">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  disabled={disabled || copying}
                  onClick={() => void handleCopy()}
                  className={controlButtonClassName()}
                  aria-label={t('webview.annotation.copy')}>
                  {copying ? <Loader2 size={14} className="animate-spin" /> : <Copy size={14} />}
                </Button>
              </Tooltip>
              <Tooltip content={t('webview.annotation.clear')} placement="bottom">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  disabled={disabled}
                  onClick={() => setClearConfirmTargetId(target.id)}
                  className={controlButtonClassName()}
                  aria-label={t('webview.annotation.clear')}>
                  <Trash2 size={14} />
                </Button>
              </Tooltip>
            </>
          )}
        </div>

        {editorAnchor && <PopoverAnchor virtualRef={editorAnchor} />}

        {editor && (
          <PopoverContent
            key={editor.requestId}
            side="bottom"
            align="center"
            sideOffset={8}
            collisionPadding={8}
            className="flex max-h-(--radix-popover-content-available-height) w-80 max-w-[calc(100vw-1rem)] flex-col gap-3 overflow-y-auto rounded-xl border-border-strong p-3 shadow-lg">
            <div className="min-h-0 min-w-0 overflow-y-auto">
              <AnnotationCommentEditor
                initialComment={editor.draft}
                placeholder={t('webview.annotation.placeholder')}
                onChange={setEditorDraft}
                onSubmit={() => {
                  if (!editorUnavailable) void saveEditor()
                }}
                onCancel={() => void cancelEditor()}
              />
            </div>
            {editorUnavailable && (
              <p role="alert" className="text-error text-xs">
                {t('webview.annotation.element_unavailable')}
              </p>
            )}
            <div className="flex shrink-0 items-center justify-end gap-2">
              {editor.canDelete && (
                <Tooltip content={t('webview.annotation.delete')} placement="bottom">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => void deleteEditor()}
                    aria-label={t('webview.annotation.delete')}
                    className="me-auto shrink-0 text-destructive shadow-none hover:bg-destructive/10 hover:text-destructive">
                    <Trash2 size={14} />
                  </Button>
                </Tooltip>
              )}
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => void cancelEditor()}
                className="shrink-0 text-muted-foreground shadow-none hover:text-foreground">
                {t('webview.annotation.cancel')}
              </Button>
              <Button
                type="button"
                size="sm"
                disabled={editorUnavailable || !editor.draft.trim()}
                onClick={() => void saveEditor()}
                aria-label={t('webview.annotation.save')}
                className="shrink-0">
                {t('webview.annotation.save')}
              </Button>
            </div>
          </PopoverContent>
        )}
      </Popover>

      <ConfirmDialog
        open={clearConfirmTargetId === target.id}
        onOpenChange={(open) => setClearConfirmTargetId(open ? target.id : null)}
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

interface AnnotationCommentEditorProps {
  initialComment: string
  placeholder: string
  onChange: (draft: string) => void
  onSubmit: () => void
  onCancel: () => void
}

/**
 * Comment input built on the composer's editor kernel and schema preset, so the
 * annotation editor types, wraps, and serializes exactly like the chat composer.
 */
function AnnotationCommentEditor({
  initialComment,
  placeholder,
  onChange,
  onSubmit,
  onCancel
}: AnnotationCommentEditorProps) {
  // Captured once: the parent remounts this component per editor request.
  const [initialContent] = useState(() => createComposerDraftContent({ text: initialComment, tokens: [] }))
  const extensions = useMemo(() => createComposerEditorPreset({ placeholder }), [placeholder])
  const editor = useRichTextEditorKernel({
    extensions,
    content: initialContent,
    immediatelyRender: false,
    editorProps: {
      attributes: {
        'aria-label': placeholder,
        class: 'max-h-40 overflow-y-auto text-sm text-foreground outline-none [--editor-min-height:3rem]'
      },
      handleKeyDown: (_view, event) => {
        if (event.key === 'Escape') {
          onCancel()
          return true
        }
        if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
          onSubmit()
          return true
        }
        return false
      }
    },
    onCreate: ({ editor: created }) => created.commands.focus('end'),
    onUpdate: ({ editor: updated }) =>
      onChange(serializeComposerDocument(updated).text.slice(0, WEBVIEW_ANNOTATION_LIMITS.comment))
  })

  return <EditorContent editor={editor} />
}

const controlButtonClassName = (active = false) =>
  cn(
    'rounded shadow-none active:scale-95',
    active
      ? 'bg-primary/10 text-primary hover:bg-primary/15 hover:text-primary'
      : 'text-muted-foreground hover:text-foreground'
  )
