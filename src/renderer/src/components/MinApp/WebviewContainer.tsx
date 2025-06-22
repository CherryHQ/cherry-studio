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

      const handleNewWindow = (event: any) => {
        // Prevent new windows and navigate in the same webview
        event.preventDefault()
        if (webviewRef.current && event.url) {
          webviewRef.current.loadURL(event.url)
        }
      }

      const handleWillNavigate = (event: any) => {
        // Allow navigation within the same webview
        onNavigateCallback(appid, event.url)
      }

      webviewRef.current.addEventListener('did-finish-load', handleLoaded)
      webviewRef.current.addEventListener('did-navigate-in-page', handleNavigate)
      webviewRef.current.addEventListener('new-window', handleNewWindow)
      webviewRef.current.addEventListener('will-navigate', handleWillNavigate)

      // we set the url when the webview is ready
      webviewRef.current.src = url

      return () => {
        webviewRef.current?.removeEventListener('did-finish-load', handleLoaded)
        webviewRef.current?.removeEventListener('did-navigate-in-page', handleNavigate)
        webviewRef.current?.removeEventListener('new-window', handleNewWindow)
        webviewRef.current?.removeEventListener('will-navigate', handleWillNavigate)
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
  width: '100%',
  height: '100%',
  backgroundColor: 'var(--color-background)',
  display: 'inline-flex'
}

export default WebviewContainer
