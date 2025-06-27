import { useSettings } from '@renderer/hooks/useSettings'
import { WebviewTag } from 'electron'
import { memo, useEffect, useRef } from 'react'

/**
 * WebviewContainer is a component that renders a webview element.
 * It is used in the MinAppPopupContainer component.
 * The webcontent can be remain in memory
 */
const WebviewContainer = memo(
  ({
    appid,
    url,
    onSetRefCallback,
    onLoadedCallback,
    onNavigateCallback
  }: {
    appid: string
    url: string
    onSetRefCallback: (appid: string, element: WebviewTag | null) => void
    onLoadedCallback: (appid: string) => void
    onNavigateCallback: (appid: string, url: string) => void
  }) => {
    const webviewRef = useRef<WebviewTag | null>(null)
    const { enableSpellCheck } = useSettings()

    const setRef = (appid: string) => {
      onSetRefCallback(appid, null)

      return (element: WebviewTag | null) => {
        onSetRefCallback(appid, element)
        if (element) {
          webviewRef.current = element
        } else {
          webviewRef.current = null
        }
      }
    }

    useEffect(() => {
      if (!webviewRef.current) return

      const handleLoaded = () => {
        onLoadedCallback(appid)
      }

      const handleNavigate = (event: any) => {
        onNavigateCallback(appid, event.url)
      }

      const handleDomReady = () => {
        const webviewId = webviewRef.current?.getWebContentsId()
        if (webviewId) {
          window.api?.webview?.setSpellCheckEnabled?.(webviewId, enableSpellCheck)
        }
      }

      webviewRef.current.addEventListener('dom-ready', handleDomReady)
      webviewRef.current.addEventListener('did-finish-load', handleLoaded)
      webviewRef.current.addEventListener('did-navigate-in-page', handleNavigate)

      // we set the url when the webview is ready
      webviewRef.current.src = url

      return () => {
        webviewRef.current?.removeEventListener('did-finish-load', handleLoaded)
        webviewRef.current?.removeEventListener('did-navigate-in-page', handleNavigate)
        webviewRef.current?.removeEventListener('dom-ready', handleDomReady)
      }
      // because the appid and url are enough, no need to add onLoadedCallback
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [appid, url])

    return (
      <webview
        key={appid}
        ref={setRef(appid)}
        style={WebviewStyle}
        allowpopups={'true' as any}
        partition="persist:webview"
        useragent={
          appid === 'google'
            ? 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko)  Safari/537.36'
            : undefined
        }
      />
    )
  }
)

const WebviewStyle: React.CSSProperties = {
  width: 'calc(100vw - var(--sidebar-width))',
  height: 'calc(100vh - var(--navbar-height))',
  backgroundColor: 'var(--color-background)',
  display: 'inline-flex'
}

export default WebviewContainer
