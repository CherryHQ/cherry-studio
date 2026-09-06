import * as z from 'zod'

import { settleAction } from '../../actions/settle'
import { BrowserSessionError } from '../../session/BrowserSessionError'
import type { CdpBrowserController } from '../controller'
import { browserResult } from './result'
import { targetShape } from './snapshot'

export const dialogSchema = z.strictObject({
  ...targetShape,
  accept: z.boolean(),
  promptText: z.string().max(40_000).optional()
})
export const dialogToolDefinition = {
  name: 'handle_dialog',
  description:
    'Accept or dismiss the pending JavaScript dialog. promptText is used for prompts. No blocked command is replayed.',
  inputSchema: dialogSchema
}
export async function handleDialog(controller: CdpBrowserController, args: unknown, signal?: AbortSignal) {
  const { tabId, privateMode, ...input } = dialogSchema.parse(args)
  return browserResult(controller, { tabId, privateMode }, signal, async (session, options) => {
    if (!session.pendingDialog) throw new BrowserSessionError('not_found')
    const { navigated } = await settleAction(
      session,
      () => session.send('Page.handleJavaScriptDialog', input, options),
      options
    )
    return { navigated, snapshot: (await session.snapshot({}, options)).text }
  })
}
