import { Button, Tooltip } from '@cherrystudio/ui'
import { cn } from '@cherrystudio/ui/lib/utils'
import { usePreference } from '@data/hooks/usePreference'
import { loggerService } from '@logger'
import { WebviewNavigation } from '@renderer/components/WebviewNavigation'
import { useMiniApps } from '@renderer/hooks/useMiniApps'
import { toast } from '@renderer/services/toast'
import { isDev } from '@renderer/utils/platform'
import { isDataApiError, toDataApiError } from '@shared/data/api/errors'
import type { MiniApp } from '@shared/data/types/miniApp'
import { WEBVIEW_ANNOTATION_LIMITS } from '@shared/types/webview'
import type { WebviewTag } from 'electron'
import { Code, LayoutGrid, Link } from 'lucide-react'
import type { FC } from 'react'
import { useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'

const logger = loggerService.withContext('MinimalToolbar')

interface Props {
  app: MiniApp
  webviewRef: React.RefObject<WebviewTag | null>
  currentUrl: string | null
  isWebviewReady: boolean
  isHostActive: boolean
  onReload: () => void
  onOpenDevTools: () => void
}

/** MiniApp-only actions composed onto the shared WebView navigation toolbar. */
const MinimalToolbar: FC<Props> = ({
  app,
  webviewRef,
  currentUrl,
  isWebviewReady,
  isHostActive,
  onReload,
  onOpenDevTools
}) => {
  const { t } = useTranslation()
  const { pinned, updateAppStatus, allApps } = useMiniApps()
  const [openLinkExternal, setOpenLinkExternal] = usePreference('feature.mini_app.open_link_external')
  const canPinned = allApps.some((item) => item.appId === app.appId)
  const isPinned = pinned.some((item) => item.appId === app.appId)
  const annotationTarget = useMemo(
    () => ({
      id: `mini-app:${app.appId}`,
      label: (app.nameKey ? t(app.nameKey) : app.name).trim().slice(0, WEBVIEW_ANNOTATION_LIMITS.targetLabel)
    }),
    [app.appId, app.name, app.nameKey, t]
  )

  const handleTogglePin = useCallback(() => {
    const fallbackKey = isPinned ? 'miniApp.unpin_failed' : 'miniApp.pin_failed'
    updateAppStatus(app.appId, isPinned ? 'enabled' : 'pinned').catch((err) => {
      const error = toDataApiError(err)
      if (isDataApiError(error)) {
        logger.error('togglePin failed', { code: error.code, message: error.message })
        toast.error(error.message || t(fallbackKey))
      } else {
        logger.error('togglePin failed', err as Error)
        toast.error(t(fallbackKey))
      }
    })
  }, [app.appId, isPinned, t, updateAppStatus])

  const handleToggleOpenExternal = useCallback(() => {
    void setOpenLinkExternal(!openLinkExternal)
  }, [openLinkExternal, setOpenLinkExternal])

  const toolbarActions = (
    <>
      {canPinned ? (
        <Tooltip
          content={isPinned ? t('miniApp.remove_from_launchpad') : t('miniApp.add_to_launchpad')}
          placement="bottom">
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            onClick={handleTogglePin}
            className={toolbarButtonClassName(isPinned)}
            aria-label={isPinned ? t('miniApp.remove_from_launchpad') : t('miniApp.add_to_launchpad')}
            aria-pressed={isPinned}>
            <LayoutGrid size={14} />
          </Button>
        </Tooltip>
      ) : null}

      <Tooltip
        content={
          openLinkExternal ? t('miniApp.popup.open_link_external_on') : t('miniApp.popup.open_link_external_off')
        }
        placement="bottom">
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          onClick={handleToggleOpenExternal}
          className={toolbarButtonClassName(openLinkExternal)}
          aria-label={
            openLinkExternal ? t('miniApp.popup.open_link_external_on') : t('miniApp.popup.open_link_external_off')
          }
          aria-pressed={openLinkExternal}>
          <Link size={14} />
        </Button>
      </Tooltip>

      {isDev ? (
        <Tooltip content={t('miniApp.popup.devtools')} placement="bottom">
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            onClick={onOpenDevTools}
            className={toolbarButtonClassName()}
            aria-label={t('miniApp.popup.devtools')}>
            <Code size={14} />
          </Button>
        </Tooltip>
      ) : null}
    </>
  )

  return (
    <WebviewNavigation
      webviewRef={webviewRef}
      initialUrl={app.url}
      currentUrl={currentUrl}
      isWebviewReady={isWebviewReady}
      isHostActive={isHostActive}
      target={annotationTarget}
      onReload={onReload}
      toolbarActions={toolbarActions}
    />
  )
}

const toolbarButtonClassName = (active = false) =>
  cn(
    'rounded text-foreground-secondary shadow-none hover:text-foreground active:scale-95',
    active && 'text-primary hover:text-primary'
  )

export default MinimalToolbar
