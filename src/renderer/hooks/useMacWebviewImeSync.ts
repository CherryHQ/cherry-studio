import type { IpcMessageEvent, WebviewTag } from 'electron'
import { useEffect } from 'react'

import { isMac } from '@renderer/utils/platform'
import { CLAIM_DOCUMENT_FOCUS_SCRIPT, releaseDocumentFocus } from '@renderer/utils/webviewDocumentFocus'
import { WEBVIEW_COMPOSITION_CHANNEL, type WebviewCompositionPayload } from '@shared/utils/webviewKey'

const SETTLE_MS = 300

/** Re-emit the guest caret rect to macOS IME after launch geometry and window resize. */
export function syncMacWebviewIme(webview: WebviewTag): void {
  // Clearing the host selection would steal IME from composer/other chrome when
  // this webview is not the focused surface (ready/settle/resize can fire then).
  if (document.activeElement !== webview) return
  releaseDocumentFocus()
  requestAnimationFrame(() => {
    try {
      // Guest may detach before the deferred claim runs; next focus/ready retries.
      void webview.executeJavaScript(CLAIM_DOCUMENT_FOCUS_SCRIPT).catch(() => {})
    } catch {
      // Guest may not be attached yet; the next focus/ready pass retries.
    }
  })
}

/**
 * Keeps the macOS IME candidate window anchored to the caret inside an embedded
 * `<webview>` after cold start and window resize.
 *
 * Bug this prevents: Chromium caches caret screen coordinates from the first
 * layout. Within a few seconds of launch those coords are often still the
 * pre-settle frame (sidebar-sized offset), so candidates appear far from the
 * field and flicker as geometry keeps updating. Releasing host document focus
 * and reclaiming it in the guest forces a fresh caret rect without waiting for
 * an incidental re-focus minutes later.
 */
export function useMacWebviewImeSync(webview: WebviewTag | null, ready: boolean): void {
  useEffect(() => {
    if (!isMac || !webview || !ready) return

    let debounce: ReturnType<typeof setTimeout> | undefined
    let settle: ReturnType<typeof setTimeout> | undefined
    let composing = false

    const syncNow = () => {
      if (composing) return
      syncMacWebviewIme(webview)
    }
    const syncDebounced = () => {
      if (debounce !== undefined) clearTimeout(debounce)
      debounce = setTimeout(() => {
        debounce = undefined
        syncNow()
      }, 50)
    }

    const onFocus = () => syncNow()
    const onGuestMessage = (event: Event) => {
      const message = event as IpcMessageEvent
      if (message.channel !== WEBVIEW_COMPOSITION_CHANNEL) return
      const payload = message.args[0] as WebviewCompositionPayload | undefined
      composing = payload?.composing === true
    }

    const raf = requestAnimationFrame(() => {
      syncNow()
      settle = setTimeout(syncNow, SETTLE_MS)
    })
    webview.addEventListener('focus', onFocus)
    webview.addEventListener('ipc-message', onGuestMessage)
    window.addEventListener('resize', syncDebounced)

    return () => {
      cancelAnimationFrame(raf)
      if (debounce !== undefined) clearTimeout(debounce)
      if (settle !== undefined) clearTimeout(settle)
      webview.removeEventListener('focus', onFocus)
      webview.removeEventListener('ipc-message', onGuestMessage)
      window.removeEventListener('resize', syncDebounced)
    }
  }, [webview, ready])
}
