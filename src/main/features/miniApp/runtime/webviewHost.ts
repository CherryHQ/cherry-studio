import { app, webContents } from 'electron'

import { application } from '@application'

import { installNavigationPolicy } from './navigation'
import { installWebRtcPolicy } from './network'
import { isMiniAppPartition, miniAppIdOfPartition } from './partition'

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
  if (!isMiniAppPartition(params.partition)) return

  const appId = miniAppIdOfPartition(params.partition)
  if (!params.src.startsWith(`cherry-miniapp://${appId}/`)) {
    event.preventDefault()
    return
  }
  // REFUSED, not compared: the renderer names none of these (`WebviewContainer` renders
  // only `partition`, `useragent`, `style`, `data-*`, and `allowpopups` for `kind: 'site'`),
  // so any value is a bug or an attempt.
  //
  // `webpreferences` has to be here rather than answered pref-by-pref below: Electron parses
  // it with `parseCommaSeparatedKeyValue` — NO allowlist — and spreads the result LAST over
  // the preferences it derives from the other attributes. Only the six in its inheritance
  // clamp (`contextIsolation` / `javascript` / `nodeIntegration` / `sandbox` /
  // `nodeIntegrationInSubFrames` / `enableWebSQL`) are safe from it, and `webviewTag` is not
  // among them — a guest granted it attaches a NESTED webview that this gate never sees, on
  // any partition and any URL, walking out of the deny-all PAC, the webRequest allowlist and
  // the CSP. Denylisting individual prefs instead would need an edit every time Electron adds one.
  if (params.preload || params.webpreferences || params.blinkfeatures || params.disableblinkfeatures) {
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
  // The OTHER way in, and the one the note above describes without closing: refusing the
  // `webpreferences` attribute shuts the attribute path, but the host runs `webviewTag: true`
  // and Electron's inheritance clamp does not cover `webviewTag`, so a guest inherits it and
  // can attach a NESTED webview on any partition — outside this app's origin check, its PAC,
  // its request filter and its CSP alike. Denied explicitly, not left to a default.
  webPreferences.webviewTag = false
}

const gated = new WeakSet<Electron.WebContents>()

/**
 * Installs the mini app webview gate on ONE host window.
 *
 * Idempotent: `installMiniAppWebviewGate` may reach the same contents from both its
 * sweep and its event, and two copies of these listeners would register the guest twice.
 */
export function installMiniAppWebviewHost(hostContents: Electron.WebContents): void {
  if (gated.has(hostContents)) return
  gated.add(hostContents)

  hostContents.on('will-attach-webview', (event, webPreferences, params) => {
    if (!isMiniAppPartition(params.partition)) return
    const appId = miniAppIdOfPartition(params.partition)

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

  // The pane-visibility keys this host mints are scoped to its id and nothing else drops them.
  hostContents.once('destroyed', () => application.get('MiniAppRuntimeService').forgetHost(hostContents.id))

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

/**
 * Arms the gate on EVERY web contents, current and future.
 *
 * Per-window installation was the bug: three window types declare `webviewTag` and only
 * two called this, so a synthesised `<webview partition="persist:miniapp:X">` on the
 * third had no main-process veto at all — and, as the note above says, a gate present on
 * some hosts is not a weaker gate but an absent one.
 *
 * Blanket rather than by window type, because `applyMiniAppWebviewPolicy` already returns
 * for any partition that is not a mini app's: nothing else can be affected, and a window
 * type added later is covered without anyone remembering to come back here. The sweep is
 * what makes it whole — this runs in `onReady`, and windows created by an earlier service
 * in the same phase already exist by then.
 */
export function installMiniAppWebviewGate(): () => void {
  const install = (contents: Electron.WebContents) => installMiniAppWebviewHost(contents)
  webContents.getAllWebContents().forEach(install)
  const onCreated = (_event: Electron.Event, contents: Electron.WebContents) => install(contents)
  app.on('web-contents-created', onCreated)
  return () => app.removeListener('web-contents-created', onCreated)
}
