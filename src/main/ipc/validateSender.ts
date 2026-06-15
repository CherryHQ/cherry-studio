import { isAbsolute, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

import type { IpcMainInvokeEvent } from 'electron'

/** Whether `childPath` is `parentDir` itself or nested inside it (no prefix-only matches). */
function isPathInside(childPath: string, parentDir: string): boolean {
  const rel = relative(parentDir, childPath)
  // `..` escapes the parent; an absolute `rel` means they share no common root.
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))
}

/**
 * Whether a frame URL belongs to the app's own renderer.
 *
 * Packaged builds load renderer pages with `loadFile()` → `file:` protocol, always
 * inside the app root (asar bundle). The dev server loads them with
 * `loadURL(`${ELECTRON_RENDERER_URL}/…`)`, so in dev we additionally trust exactly
 * that origin.
 *
 * A `file:` URL is trusted only when its path is **inside `appRootDir`** — not any
 * `file:` wholesale. Reaching IpcApi does not require the app preload (a
 * `nodeIntegration` window can call `ipcRenderer.invoke` directly), so a
 * downloaded/exported HTML opened in such a window would otherwise be trusted, and
 * local HTML in a privileged context is a classic Electron RCE vector. Everything
 * else — remote https origins reachable via MiniApp / `<webview>` — is rejected.
 *
 * Pure (the dev origin and app root are injected) so it is verifiable without Electron.
 */
export function isTrustedSenderUrl(url: string, devServerUrl: string | null | undefined, appRootDir: string): boolean {
  if (!url) return false

  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return false
  }

  if (parsed.protocol === 'file:') {
    let filePath: string
    try {
      filePath = fileURLToPath(parsed)
    } catch {
      return false
    }
    return isPathInside(filePath, appRootDir)
  }

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
 *
 * `appRootDir` (the app's own bundle root, e.g. `application.getPath('app.root')`)
 * is injected so the `file:` check enforces "the app's own renderer" rather than
 * trusting any local file.
 */
export function validateSender(event: IpcMainInvokeEvent, appRootDir: string): boolean {
  // Embedded <webview> guests arrive as their own WebContents — never let them reach IpcApi.
  if (event.sender.getType() === 'webview') return false

  const frame = event.senderFrame
  if (!frame) return false

  // Only the top-level frame may reach IpcApi. A sub-frame (e.g. an <iframe>
  // embedding content inside an app window, which shares the renderer with
  // webSecurity:false) must be rejected even if its URL looks app-owned —
  // `WebFrameMain.parent` is null only for the top frame.
  if (frame.parent !== null) return false

  return isTrustedSenderUrl(frame.url, process.env.ELECTRON_RENDERER_URL ?? null, appRootDir)
}
