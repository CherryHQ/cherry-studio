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

      const handleNewWindow = (event: any) => {
        event.preventDefault()
        if (webviewRef.current?.loadURL) {
          webviewRef.current.loadURL(event.url)
        }
      }

      const handleLoaded = () => {
        onLoadedCallback(appid)
      }

      const handleNavigate = (event: any) => {
        onNavigateCallback(appid, event.url)
      }

      webviewRef.current.addEventListener('new-window', handleNewWindow)
      webviewRef.current.addEventListener('did-finish-load', handleLoaded)
      webviewRef.current.addEventListener('did-navigate-in-page', handleNavigate)

      // we set the url when the webview is ready
      webviewRef.current.src = url

      return () => {
        webviewRef.current?.removeEventListener('new-window', handleNewWindow)
        webviewRef.current?.removeEventListener('did-finish-load', handleLoaded)
        webviewRef.current?.removeEventListener('did-navigate-in-page', handleNavigate)
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
        nodeintegration={'true' as any}
      />
    )
  }
)

const WebviewStyle: React.CSSProperties = {
  width: 'calc(100vw - var(--sidebar-width))',
  height: 'calc(100vh - var(--navbar-height))',
  backgroundColor: 'white',
  display: 'inline-flex'
}

export default WebviewContainer
