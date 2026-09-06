import { sanitizeRemoteUrl } from '@main/utils/remoteUrlSafety'
import * as z from 'zod'

import { settleAction } from '../../actions/settle'
import { browserRefSchema } from '../../browserUse'
import { BrowserSessionError } from '../../session/BrowserSessionError'
import type { CdpBrowserController } from '../controller'
import { browserResult } from './result'
import { targetShape } from './snapshot'

export const historySchema = z.strictObject(targetShape)
export const waitForSchema = z
  .strictObject({
    ...targetShape,
    text: z.string().min(1).optional(),
    ref: browserRefSchema.optional(),
    gone: z.boolean().default(false),
    timeoutMs: z.number().int().min(1).max(30_000).default(10_000)
  })
  .refine((p) => p.text !== undefined || p.ref !== undefined, 'Provide text or ref')
export const navigateToolDefinitions = [
  ...['go_back', 'go_forward'].map((name) => ({
    name,
    description: 'Navigate through this tab history and return a snapshot diff.',
    inputSchema: historySchema
  })),
  {
    name: 'wait_for',
    description:
      'Wait until text or a ref is present in the snapshot, or absent with gone=true. Supply text or ref; if both are supplied, both conditions must hold.',
    inputSchema: waitForSchema
  }
]

export async function handleHistory(
  controller: CdpBrowserController,
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
        sanitizeRemoteUrl(entry.url)
        await session.send('Page.navigateToHistoryEntry', { entryId: entry.id }, options)
      },
      options
    )
    return { navigated, snapshot: (await session.snapshot({}, options)).text }
  })
}

export async function handleWaitFor(controller: CdpBrowserController, args: unknown, signal?: AbortSignal) {
  const input = waitForSchema.parse(args)
  return browserResult(controller, input, signal, async (session, options) => {
    options.deadline = Date.now() + input.timeoutMs
    while (true) {
      options.signal?.throwIfAborted()
      if (Date.now() >= options.deadline) throw new BrowserSessionError('timeout')
      if (input.ref) session.resolveRef(input.ref)
      const result = await session.snapshot({ full: true }, options)
      const checks: boolean[] = []
      if (input.text !== undefined) checks.push(result.snapshot.nodes.some((node) => node.name.includes(input.text!)))
      if (input.ref !== undefined) checks.push(result.snapshot.nodes.some((node) => node.ref === input.ref))
      if (checks.every((present) => (input.gone ? !present : present))) return { snapshot: result.text }
      await session.pause(250, options)
    }
  })
}
