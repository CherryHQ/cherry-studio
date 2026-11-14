import * as z from 'zod'

import {
  WEBVIEW_ANNOTATION_LIMITS,
  WebviewAnnotationSchema,
  WebviewAnnotationTargetSchema
} from '@shared/types/webviewAnnotation'

import { defineRoute } from '../define'

/**
 * Webview IPC schemas — host-side control of MiniApp `<webview>` guests, addressed by
 * `webviewId` (the guest's webContents id, a plain number). The legacy channels passed
 * positional args; the IpcApi routes fold them into a single input object.
 *
 * `print_to_pdf` / `save_as_html` return the written file path, or `null` when the user
 * cancels the native save dialog (they throw if the guest webContents is gone).
 */
export const webviewRequestSchemas = {
  'webview.region.set_country': defineRoute({
    input: z.strictObject({
      appId: z.string().min(1).max(256),
      country: z.enum(['US', 'JP', 'SG', 'GB', 'FR', 'DE']).nullable()
    }),
    output: z.void()
  }),
  'webview.region.prepare': defineRoute({
    input: z.strictObject({ appId: z.string().min(1).max(256) }),
    output: z.strictObject({ partition: z.string(), fake: z.boolean(), leaseId: z.uuid().nullable() })
  }),
  'webview.region.release': defineRoute({
    input: z.strictObject({ leaseId: z.uuid() }),
    output: z.void()
  }),
  'webview.region.clear_data': defineRoute({
    input: z.strictObject({ appId: z.string().min(1).max(256) }),
    output: z.void()
  }),
  'webview.region.wait_until_ready': defineRoute({
    input: z.strictObject({ webviewId: z.number().int().positive() }),
    output: z.void()
  }),
  'webview.debugging.get_state': defineRoute({
    input: z.strictObject({ webviewId: z.number().int().positive() }),
    output: z.strictObject({ attached: z.boolean(), revision: z.number().int().nonnegative() })
  }),
  'webview.set_open_link_external': defineRoute({
    input: z.object({ webviewId: z.number(), isExternal: z.boolean() }),
    output: z.void()
  }),
  'webview.set_spell_check_enabled': defineRoute({
    input: z.object({ webviewId: z.number(), isEnable: z.boolean() }),
    output: z.void()
  }),
  /** Host-side visibility; main freezes a guest that stays hidden. */
  'webview.set_visible': defineRoute({
    input: z.object({ webviewId: z.number(), visible: z.boolean() }),
    output: z.void()
  }),
  'webview.export_annotations': defineRoute({
    input: z
      .object({
        webviewId: z.number().int().positive(),
        documentSessionId: z.uuid(),
        target: WebviewAnnotationTargetSchema,
        annotations: z.array(WebviewAnnotationSchema).min(1).max(WEBVIEW_ANNOTATION_LIMITS.annotations)
      })
      .strict(),
    output: z.string().max(WEBVIEW_ANNOTATION_LIMITS.exportMarkdown)
  }),
  'webview.print_to_pdf': defineRoute({ input: z.object({ webviewId: z.number() }), output: z.string().nullable() }),
  'webview.save_as_html': defineRoute({ input: z.object({ webviewId: z.number() }), output: z.string().nullable() })
}

export type WebviewEventSchemas = {
  'webview.region.invalidated': { appId: string }
  'webview.region.failed': { webviewId: number }
  'webview.debugging.changed': { webviewId: number; attached: boolean; revision: number }
}
