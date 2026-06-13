import type { IpcMainInvokeEvent } from 'electron'

/**
 * Whether a frame URL belongs to the app's own renderer.
 *
 * Packaged builds load renderer pages with `loadFile()` → `file:` protocol.
 * The dev server loads them with `loadURL(`${ELECTRON_RENDERER_URL}/…`)`, so in
 * dev we additionally trust exactly that origin. Everything else — remote
 * https origins reachable via MiniApp / `<webview>` — is rejected.
 *
 * Pure (the dev origin is injected) so it is verifiable without Electron.
 */
export function isTrustedSenderUrl(url: string, devServerUrl?: string | null): boolean {
  if (!url) return false

  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return false
  }

  if (parsed.protocol === 'file:') return true

  if (devServerUrl) {
    try {
      return parsed.origin === new URL(devServerUrl).origin
    } catch {
      return false
    }
  }

  return false
}

/**
 * Source-trust gate for the single IpcApi request channel.
 *
 * Because one channel funnels every business capability into one handler, the
 * router validates the *caller* before the input: all web frames (including
 * iframes and `<webview>` guests) can send IPC, and this app runs with
 * `webviewTag: true` + `webSecurity: false` + MiniApps rendering arbitrary
 * remote URLs. Per Electron's security checklist, verify `senderFrame`.
 */
export function validateSender(event: IpcMainInvokeEvent): boolean {
  // Embedded <webview> guests arrive as their own WebContents — never let them reach IpcApi.
  if (event.sender.getType() === 'webview') return false

  const frame = event.senderFrame
  if (!frame) return false

  // Only the top-level frame may reach IpcApi. A sub-frame (e.g. an <iframe>
  // embedding content inside an app window, which shares the renderer with
  // webSecurity:false) must be rejected even if its URL looks app-owned —
  // `WebFrameMain.parent` is null only for the top frame.
  if (frame.parent !== null) return false

  return isTrustedSenderUrl(frame.url, process.env.ELECTRON_RENDERER_URL ?? null)
}
