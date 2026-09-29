import { dialogSchema } from '@main/ai/mcp/browserToolDefinitions'

import { settleAction } from '../../actions/settle'
import { BrowserSessionError } from '../../session/BrowserSessionError'
import type { BrowserController } from '../browserController'
import { browserResult } from './result'

export async function handleDialog(controller: BrowserController, args: unknown, signal?: AbortSignal) {
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
