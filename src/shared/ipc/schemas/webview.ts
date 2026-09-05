import {
  WEBVIEW_ANNOTATION_LIMITS,
  WebviewAnnotationSchema,
  WebviewAnnotationTargetSchema
} from '@shared/types/webviewAnnotation'
import * as z from 'zod'

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
  'webview.set_open_link_external': defineRoute({
    input: z.object({ webviewId: z.number(), isExternal: z.boolean() }),
    output: z.void()
  }),
  'webview.set_spell_check_enabled': defineRoute({
    input: z.object({ webviewId: z.number(), isEnable: z.boolean() }),
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
