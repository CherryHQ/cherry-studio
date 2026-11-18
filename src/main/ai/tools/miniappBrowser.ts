/**
 * `miniapp-browser` tool core (issue #21646, stage 2) — runtime-agnostic.
 *
 * Automation for ONE page: the live guest of a preview the calling session owns.
 * The boundary is structural (AC6):
 *
 *   - The only way to name a target is a `previewId`; the session check in
 *     {@link resolveBoundGuest} makes another session's preview unaddressable.
 *   - Actions run inside the guest's own webContents. Host consent surfaces —
 *     preview approval, installation, Launchpad — are main-process UI that no
 *     action here can reach, and there is deliberately no action for them.
 *   - A closed or replaced preview invalidates the target: the registry is
 *     re-consulted per call, so no stale webContents id can outlive its preview.
 *
 * Snapshot/click/type/wait use `executeJavaScript` in the guest's main world —
 * the guest CSP allows eval — and screenshots use `capturePage`. Console logs
 * are buffered from the moment automation first touches the page; nothing is
 * retroactive, because nothing was listening before.
 */

import { webContents } from 'electron'
import * as z from 'zod'

import { application } from '@application'
import { loggerService } from '@logger'

const logger = loggerService.withContext('MiniAppBrowser')

export const MINIAPP_BROWSER_TOOL_NAME = 'miniapp-browser'

export const MINIAPP_BROWSER_DESCRIPTION = `Operate one bound Mini App preview page: snapshot its DOM, click or type into elements, wait for a predicate, read console logs, or take a screenshot. Targets only a preview your session owns; cannot act on host dialogs or consent.`

export const miniappBrowserInputSchema = z.discriminatedUnion('action', [
  z.strictObject({ action: z.literal('snapshot'), previewId: z.string().min(1) }),
  z.strictObject({
    action: z.literal('click'),
    previewId: z.string().min(1),
    selector: z.string().min(1).describe('CSS selector of the element to click')
  }),
  z.strictObject({
    action: z.literal('type'),
    previewId: z.string().min(1),
    selector: z.string().min(1).describe('CSS selector of the element to type into'),
    text: z.string().describe('Text to enter; replaces the element’s current value')
  }),
  z.strictObject({
    action: z.literal('wait'),
    previewId: z.string().min(1),
    predicate: z.string().min(1).describe('JS expression evaluated in the page; wait until it is truthy'),
    timeoutMs: z.number().int().min(100).max(30_000).optional()
  }),
  z.strictObject({ action: z.literal('logs'), previewId: z.string().min(1) }),
  z.strictObject({ action: z.literal('screenshot'), previewId: z.string().min(1) })
])
export type MiniappBrowserInput = z.infer<typeof miniappBrowserInputSchema>

export const miniappBrowserErrorSchema = z.object({ error: z.string(), code: z.string().optional() })
export type MiniappBrowserError = z.infer<typeof miniappBrowserErrorSchema>

const snapshotOutputSchema = z.object({ url: z.string(), title: z.string(), dom: z.string() })
const actionOutputSchema = z.object({ ok: z.literal(true) })
const logsOutputSchema = z.object({
  logs: z.array(z.object({ level: z.string(), message: z.string(), at: z.number() }))
})
const screenshotOutputSchema = z.object({ pngBase64: z.string() })

export const miniappBrowserOutputSchema = z.union([
  snapshotOutputSchema,
  actionOutputSchema,
  logsOutputSchema,
  screenshotOutputSchema,
  miniappBrowserErrorSchema
])
export type MiniappBrowserOutput = z.infer<typeof miniappBrowserOutputSchema>

function failure(message: string, code?: string): MiniappBrowserError {
  return code === undefined ? { error: message } : { error: message, code }
}

/** What the tool layer threads in from the request context. */
export interface MiniappBrowserContext {
  readonly sessionId?: string
}

const DEFAULT_WAIT_TIMEOUT_MS = 10_000
const WAIT_POLL_INTERVAL_MS = 100
const MAX_LOG_LINES_PER_PAGE = 200
const MAX_SNAPSHOT_CHARS = 50_000

interface ConsoleLine {
  level: string
  message: string
  at: number
}

/** webContentsId → console lines since automation first attached. */
const consoleBuffers = new Map<number, ConsoleLine[]>()

/**
 * The guest this call may drive, or a refusal. Re-resolved EVERY call: the preview
 * registry is the truth, and a webContents id is only as good as the live preview
 * and session behind it.
 */
function resolveBoundGuest(previewId: string, ctx: MiniappBrowserContext): Electron.WebContents | MiniappBrowserError {
  if (!ctx.sessionId) {
    return failure('The miniapp-browser tool needs a chat session; this invocation has none', 'no-session')
  }
  const preview = application.get('MiniAppPreviewService').getPreview(previewId)
  if (!preview || preview.sessionId !== ctx.sessionId) {
    return failure('Unknown preview', 'unknown-preview')
  }
  const guests = application.get('MiniAppRuntimeService').guestsOf(preview.runtimeId)
  const guest = guests.map((id) => webContents.fromId(id)).find((wc) => wc && !wc.isDestroyed())
  if (!guest) {
    return failure('The preview has no live page; open it in the preview pane first', 'no-page')
  }
  if (!consoleBuffers.has(guest.id)) {
    consoleBuffers.set(guest.id, [])
    guest.on('console-message', (_event, level, message) => {
      const lines = consoleBuffers.get(guest.id)
      if (!lines) return
      // Ring, not boundless: the guest controls its own console rate.
      if (lines.length >= MAX_LOG_LINES_PER_PAGE) lines.shift()
      lines.push({ level: String(level), message: message.slice(0, 1000), at: Date.now() })
    })
    guest.once('destroyed', () => consoleBuffers.delete(guest.id))
  }
  return guest
}

/** Serialized for executeJavaScript — the guest's CSP allows eval (stage 2 keeps the real CSP). */
function pageScript(body: string): string {
  return `(() => { ${body} })()`
}

export async function runMiniappBrowser(
  input: MiniappBrowserInput,
  ctx: MiniappBrowserContext
): Promise<MiniappBrowserOutput> {
  const guest = resolveBoundGuest(input.previewId, ctx)
  if ('error' in guest) return guest

  try {
    switch (input.action) {
      case 'snapshot': {
        const dom = (await guest.executeJavaScript(
          pageScript("const el = document.documentElement; return el ? el.outerHTML : '';")
        )) as string
        return {
          url: guest.getURL(),
          title: guest.getTitle(),
          dom: dom.length > MAX_SNAPSHOT_CHARS ? `${dom.slice(0, MAX_SNAPSHOT_CHARS)}…` : dom
        }
      }
      case 'click': {
        const found = (await guest.executeJavaScript(
          pageScript(
            `const el = document.querySelector(${JSON.stringify(input.selector)});` +
              'if (!el) return false; el.click(); return true;'
          )
        )) as boolean
        if (!found) return failure(`No element matches ${input.selector}`, 'no-element')
        return { ok: true }
      }
      case 'type': {
        const found = (await guest.executeJavaScript(
          pageScript(
            `const el = document.querySelector(${JSON.stringify(input.selector)});` +
              'if (!el) return false; el.focus();' +
              `const text = ${JSON.stringify(input.text)};` +
              "if ('value' in el) { el.value = text; } else { el.textContent = text; }" +
              "el.dispatchEvent(new Event('input', { bubbles: true }));" +
              "el.dispatchEvent(new Event('change', { bubbles: true }));" +
              'return true;'
          )
        )) as boolean
        if (!found) return failure(`No element matches ${input.selector}`, 'no-element')
        return { ok: true }
      }
      case 'wait': {
        const deadline = Date.now() + (input.timeoutMs ?? DEFAULT_WAIT_TIMEOUT_MS)
        // Poll inside the page: one round trip per interval, no host-side races.
        const met = (await guest.executeJavaScript(
          `new Promise((resolve) => {` +
            `const deadline = ${deadline};` +
            `const tick = () => {` +
            `let ok = false; try { ok = Boolean(${input.predicate}); } catch { ok = false; }` +
            `if (ok || Date.now() >= deadline) return resolve(ok);` +
            `setTimeout(tick, ${WAIT_POLL_INTERVAL_MS});` +
            `}; tick(); })`
        )) as boolean
        if (!met) return failure('Predicate was not truthy before the timeout', 'wait-timeout')
        return { ok: true }
      }
      case 'logs': {
        return { logs: [...(consoleBuffers.get(guest.id) ?? [])] }
      }
      case 'screenshot': {
        const image = await guest.capturePage()
        return { pngBase64: image.toPNG().toString('base64') }
      }
    }
  } catch (error) {
    logger.warn('miniapp-browser action failed', { action: input.action, error })
    return failure(`Action failed: ${error instanceof Error ? error.message : String(error)}`)
  }
}
