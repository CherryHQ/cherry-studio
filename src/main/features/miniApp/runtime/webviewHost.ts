import { application } from '@application'

import { installNavigationPolicy } from './navigation'
import { installWebRtcPolicy } from './network'

const MINI_APP_PARTITION_PREFIX = 'persist:miniapp:'

/**
 * The host renderer runs with `webSecurity: false`, so anything achieving script
 * execution there could synthesise a `<webview nodeintegration preload="...">`.
 * This is the only main-side point that can veto such an attachment.
 */
export function applyMiniAppWebviewPolicy(
  event: Electron.Event,
  webPreferences: Electron.WebPreferences,
  params: Record<string, string>,
  bridgePreloadPath: string
): void {
  if (!params.partition.startsWith(MINI_APP_PARTITION_PREFIX)) return

  const appId = params.partition.slice(MINI_APP_PARTITION_PREFIX.length)
  if (!params.src.startsWith(`cherry-miniapp://${appId}/`)) {
    event.preventDefault()
    return
  }
  // A renderer-supplied preload is REFUSED, not compared. The renderer has no
  // legitimate reason to name one, so any value here is a bug or an attempt.
  if (params.preload) {
    event.preventDefault()
    return
  }

  // `webPreferences.preload` resolves as a PATH (unlike the element attribute,
  // which wants a file: URL) — one more reason to set it only on this side.
  webPreferences.preload = bridgePreloadPath
  webPreferences.nodeIntegration = false
  webPreferences.nodeIntegrationInSubFrames = false
  webPreferences.contextIsolation = true
  webPreferences.sandbox = true
  webPreferences.webSecurity = true
  webPreferences.allowRunningInsecureContent = false
}

/**
 * Installs the mini app webview gate on ONE host window.
 *
 * Must be called for every window that can render `MiniAppTabsPool` — today the
 * main window and detached sub-windows. A gate that exists on only one of them is
 * not a weaker gate, it is an absent one: the unguarded host attaches the guest
 * with default webPreferences and never registers it.
 */
export function installMiniAppWebviewHost(hostContents: Electron.WebContents): void {
  hostContents.on('will-attach-webview', (event, webPreferences, params) => {
    if (!params.partition.startsWith(MINI_APP_PARTITION_PREFIX)) return
    const appId = params.partition.slice(MINI_APP_PARTITION_PREFIX.length)

    // The partition must ALREADY be prepared: `ensurePartition` is async and this
    // handler is not, so it can only veto. The renderer awaits `mini_app.runtime.prepare`.
    const runtime = application.get('MiniAppRuntimeService')
    if (!runtime.isPartitionReady(appId)) {
      event.preventDefault()
      return
    }
    // Attaching mid-publish would put the old code back on top of files and grants
    // that are changing — the hole `withAppQuiesced` closes, re-entered from the side.
    if (runtime.isQuiescing(appId)) {
      event.preventDefault()
      return
    }
    // Imposed here, never accepted from the renderer.
    applyMiniAppWebviewPolicy(event, webPreferences, params, runtime.bridgePreloadPath)
  })

  hostContents.on('did-attach-webview', (_event, contents) => {
    const runtime = application.get('MiniAppRuntimeService')
    const appId = runtime.resolveAppIdBySession(contents.session)
    if (!appId) return

    // The host id travels with the guest: a detached window closing must be able to
    // suspend what it owns without touching the same app running elsewhere.
    runtime.registerGuest(appId, contents.id)
    installNavigationPolicy(contents, appId)
    installWebRtcPolicy(contents)
    contents.once('destroyed', () => runtime.unregisterGuest(contents.id))
  })
}
