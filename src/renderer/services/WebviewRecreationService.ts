import { loggerService } from '@logger'
import { setWebviewLoaded } from '@renderer/services/MiniAppWebviewService'

const logger = loggerService.withContext('WebviewRecreationService')

type WebviewRecreateListener = (appId: string) => void

class WebviewRecreationService {
  private readonly listeners = new Set<WebviewRecreateListener>()

  /** Request a replacement from the global pool, even when the pane has no WebView ref. */
  request(appId: string): void {
    setWebviewLoaded(appId, false)
    this.listeners.forEach((listener) => {
      try {
        listener(appId)
      } catch (e) {
        logger.debug('Recreate listener error', { appId, error: e })
      }
    })
  }

  subscribe(listener: WebviewRecreateListener): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }
}

export const webviewRecreationService = new WebviewRecreationService()
