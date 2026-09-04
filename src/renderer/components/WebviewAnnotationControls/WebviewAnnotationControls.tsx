import {
  Badge,
  Button,
  ConfirmDialog,
  Popover,
  PopoverAnchor,
  PopoverContent,
  Textarea,
  Tooltip
} from '@cherrystudio/ui'
import { cn } from '@cherrystudio/ui/lib/utils'
import { loggerService } from '@logger'
import { useTheme } from '@renderer/hooks/useTheme'
import { toast } from '@renderer/services/toast'
import { ThemeMode } from '@shared/data/preference/preferenceTypes'
import {
  WEBVIEW_ANNOTATION_LIMITS,
  type WebviewAnnotationLocale,
  type WebviewAnnotationTarget
} from '@shared/types/webviewAnnotation'
import type { WebviewTag } from 'electron'
import { Copy, Loader2, MousePointer2, Trash2 } from 'lucide-react'
import type { RefObject } from 'react'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { useWebviewAnnotationSession } from './useWebviewAnnotationSession'

const logger = loggerService.withContext('WebviewAnnotationControls')

interface Props {
  webviewRef: RefObject<WebviewTag | null>
  webviewRevision: number
  isWebviewReady: boolean
  isHostActive: boolean
  target: WebviewAnnotationTarget
}

export function WebviewAnnotationControls({
  webviewRef,
  webviewRevision,
  isWebviewReady,
  isHostActive,
  target
}: Props) {
  const { t } = useTranslation()
  const { theme } = useTheme()
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
    theme: theme === ThemeMode.dark ? 'dark' : 'light'
  })

  const handleCopy = async () => {
    try {
      await copy()
      toast.success(t('webview.annotation.copied'))
    } catch (error) {
      logger.error('Failed to copy webview annotations', error as Error, { targetId: target.id })
      toast.error(t('webview.annotation.copy_failed'))
    }
  }

  const handleClear = () => {
    if (clearConfirmTargetId !== target.id) return
    if (!clear()) return
    setClearConfirmTargetId(null)
  }

  const disabled = !isWebviewReady || !isHostActive || !ready
  const annotationLabel = enabled ? t('webview.annotation.disable_mode') : t('webview.annotation.enable_mode')

  return (
    <>
      <Popover open={Boolean(editor)} onOpenChange={(open) => !open && cancelEditor()}>
        <PopoverAnchor asChild>
          <div className="flex items-center gap-0.5">
            <Tooltip content={annotationLabel} placement="bottom">
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                disabled={disabled}
                onClick={toggle}
                className={controlButtonClassName(enabled)}
                aria-label={annotationLabel}
                aria-pressed={enabled}>
                <MousePointer2 size={14} />
              </Button>
            </Tooltip>

            {count > 0 && (
              <>
                <Badge
                  variant="secondary"
                  className="h-4 min-w-4 border-0 px-1 text-[10px] text-muted-foreground tabular-nums"
                  aria-label={t('webview.annotation.count', { count })}>
                  {count}
                </Badge>
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
        </PopoverAnchor>

        {editor && (
          <PopoverContent align="end" className="w-80 space-y-3 p-3">
            <Textarea.Input
              autoFocus
              value={editor.draft}
              onValueChange={setEditorDraft}
              maxLength={WEBVIEW_ANNOTATION_LIMITS.comment}
              aria-label={t('webview.annotation.placeholder')}
              placeholder={t('webview.annotation.placeholder')}
              className="min-h-24 px-3 py-2 text-sm"
              onKeyDown={(event) => {
                if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
                  event.preventDefault()
                  saveEditor()
                }
              }}
            />
            {editor.error === 'element_unavailable' && (
              <p role="alert" className="text-error text-xs">
                {t('webview.annotation.element_unavailable')}
              </p>
            )}
            <div className="flex justify-end gap-2">
              {editor.canDelete && (
                <Button type="button" variant="destructive" size="sm" className="mr-auto" onClick={deleteEditor}>
                  {t('webview.annotation.delete')}
                </Button>
              )}
              <Button type="button" variant="outline" size="sm" onClick={cancelEditor}>
                {t('webview.annotation.cancel')}
              </Button>
              <Button type="button" size="sm" disabled={!editor.draft.trim()} onClick={saveEditor}>
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

const controlButtonClassName = (active = false) =>
  cn(
    'rounded shadow-none active:scale-95',
    active
      ? 'bg-primary/10 text-primary hover:bg-primary/15 hover:text-primary'
      : 'text-muted-foreground hover:text-foreground'
  )
