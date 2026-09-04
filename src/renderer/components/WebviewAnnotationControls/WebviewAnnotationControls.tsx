import { Badge, Button, ConfirmDialog, Tooltip } from '@cherrystudio/ui'
import { cn } from '@cherrystudio/ui/lib/utils'
import { loggerService } from '@logger'
import { useTheme } from '@renderer/hooks/useTheme'
import { toast } from '@renderer/services/toast'
import { ThemeMode } from '@shared/data/preference/preferenceTypes'
import type { WebviewAnnotationLocale, WebviewAnnotationTarget } from '@shared/types/webviewAnnotation'
import type { WebviewTag } from 'electron'
import { Copy, Loader2, MousePointer2, Trash2 } from 'lucide-react'
import type { RefObject } from 'react'
import { useMemo, useState } from 'react'
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
  const [clearConfirmOpen, setClearConfirmOpen] = useState(false)
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
  const { enabled, count, ready, copying, toggle, clear, copy } = useWebviewAnnotationSession({
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
    if (!clear()) return
    setClearConfirmOpen(false)
  }

  const disabled = !isWebviewReady || !isHostActive || !ready
  const annotationLabel = enabled ? t('webview.annotation.disable_mode') : t('webview.annotation.enable_mode')

  return (
    <>
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
