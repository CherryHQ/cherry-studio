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
  type WebviewAnnotationState,
  type WebviewAnnotationTarget
} from '@shared/types/webviewAnnotation'
import type { DidNavigateInPageEvent, WebviewTag } from 'electron'
import { Copy, Loader2, MousePointer2, Trash2 } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

const logger = loggerService.withContext('WebviewAnnotationControls')
const EMPTY_STATE: WebviewAnnotationState = { enabled: false, annotations: [] }
const WEBVIEW_ATTACH_MAX_ATTEMPTS = 300

interface Props {
  webviewRef: React.RefObject<WebviewTag | null>
  isWebviewReady: boolean
  isHostActive: boolean
  target: WebviewAnnotationTarget
}

export function WebviewAnnotationControls({ webviewRef, isWebviewReady, isHostActive, target }: Props) {
  const { t } = useTranslation()
  const { theme } = useTheme()
  const [state, setState] = useState<WebviewAnnotationState>(EMPTY_STATE)
  const [clearConfirmOpen, setClearConfirmOpen] = useState(false)
  const [isCopying, setIsCopying] = useState(false)

  const locale = useMemo(
    () => ({
      placeholder: t('webview.annotation.placeholder'),
      save: t('webview.annotation.save'),
      cancel: t('webview.annotation.cancel'),
      delete: t('webview.annotation.delete'),
      edit: t('webview.annotation.edit')
    }),
    [t]
  )
  const guestConfigurationRef = useRef({
    locale,
    theme: theme === ThemeMode.dark ? ('dark' as const) : ('light' as const)
  })
  guestConfigurationRef.current = {
    locale,
    theme: theme === ThemeMode.dark ? 'dark' : 'light'
  }

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
      const nextState = isHostActive ? parsed.data.state : { ...parsed.data.state, enabled: false }
      setState(nextState)
      void replaceMainSnapshot(nextState.annotations, attachedWebview)
      if (!isHostActive && parsed.data.state.enabled) {
        sendCommand({ type: 'set_enabled', enabled: false }, attachedWebview)
      }
    }

    const resetForNavigation = () => {
      setState(EMPTY_STATE)
      sendCommand({ type: 'reset' }, attachedWebview)
      void replaceMainSnapshot([], attachedWebview)
    }

    const handleInPageNavigation = (event: DidNavigateInPageEvent) => {
      if (event.isMainFrame) resetForNavigation()
    }

    const configureGuest = () => {
      sendCommand(
        {
          type: 'configure',
          ...guestConfigurationRef.current
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
      attachedWebview.removeEventListener('did-navigate-in-page', handleInPageNavigation)
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
      webview.addEventListener('did-navigate-in-page', handleInPageNavigation)
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
  }, [isHostActive, replaceMainSnapshot, sendCommand, webviewRef])

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
    sendCommand({ type: 'set_enabled', enabled: false })
  }, [isHostActive, sendCommand, state.enabled])

  const handleToggle = () => {
    const enabled = !state.enabled
    if (!sendCommand({ type: 'set_enabled', enabled })) return
    setState((current) => ({ ...current, enabled }))
  }

  const handleCopy = async () => {
    const webview = webviewRef.current
    if (!webview || state.annotations.length === 0) return
    setIsCopying(true)
    try {
      const webviewId = webview.getWebContentsId()
      if (!webviewId) throw new Error('Current webview is detached')
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
              className="h-4 min-w-4 border-0 px-1 text-[10px] text-muted-foreground tabular-nums"
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
