import { historySchema, waitForSchema } from '@main/ai/mcp/browserToolDefinitions'

import { settleAction } from '../../actions/settle'
import { BrowserSessionError } from '../../session/BrowserSessionError'
import type { BrowserController } from '../browserController'
import { browserResult } from './result'

export async function handleHistory(
  controller: BrowserController,
  args: unknown,
  direction: -1 | 1,
  signal?: AbortSignal
) {
  const input = historySchema.parse(args ?? {})
  return browserResult(controller, input, signal, async (session, options) => {
    const { navigated } = await settleAction(
      session,
      async () => {
        const history = await session.send('Page.getNavigationHistory', undefined, options)
        const entry = history.entries[history.currentIndex + direction]
        if (!entry) throw new BrowserSessionError('not_found')
        if (entry.url !== 'about:blank') controller.validateUrl(entry.url)
        await session.send('Page.navigateToHistoryEntry', { entryId: entry.id }, options)
      },
      options
    )
    return { navigated, snapshot: (await session.snapshot({}, options)).text }
  })
}

export async function handleWaitFor(controller: BrowserController, args: unknown, signal?: AbortSignal) {
  const input = waitForSchema.parse(args)
  return browserResult(controller, input, signal, async (session, options) => {
    options.deadline = Date.now() + input.timeoutMs
    while (true) {
      options.signal?.throwIfAborted()
      if (Date.now() >= options.deadline) throw new BrowserSessionError('timeout')
      if (input.ref && !input.gone) session.resolveRef(input.ref)
      const result = await session.snapshot({ full: true }, options)
      const checks: boolean[] = []
      if (input.text !== undefined) checks.push(result.snapshot.nodes.some((node) => node.name.includes(input.text!)))
      if (input.ref !== undefined) checks.push(result.snapshot.nodes.some((node) => node.ref === input.ref))
      if (checks.every((present) => (input.gone ? !present : present))) return { snapshot: result.text }
      await session.pause(250, options)
    }
  })
}
