import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { pathToFileURL } from 'node:url'

import { web } from '@e2e-dev/web'

interface Page {
  isClosed(): boolean
  context(): {
    newCDPSession(): Promise<{ send(): Promise<{ targetInfo: { targetId: string } }>; detach(): Promise<void> }>
  }
  goto(url: string): Promise<void>
}
const require = createRequire(import.meta.url)
const { AttemptSession } = (await import(
  pathToFileURL(join(dirname(require.resolve('@e2e-dev/web')), 'attempt-session.js')).href
)) as {
  AttemptSession: { prototype: { nextPage(this: unknown, context: { pages(): Page[] }): Promise<Page> } }
}

function page(targetId: string, navigations: string[]): Page {
  return {
    isClosed: () => false,
    context: () => ({
      newCDPSession: async () => ({ send: async () => ({ targetInfo: { targetId } }), detach: async () => {} })
    }),
    goto: async (url) => {
      navigations.push(`${targetId}:${url}`)
    }
  }
}

await test('an explicit native target binds the main window even when an auxiliary page comes first', async () => {
  const navigations: string[] = []
  const auxiliary = page('auxiliary', navigations)
  const main = page('main', navigations)
  const selected = await AttemptSession.prototype.nextPage.call(
    { firstPage: true, options: { persistent: { existingTargetId: 'main' } } },
    { pages: () => [auxiliary, main] }
  )
  assert.equal(selected, main)
  assert.deepEqual(navigations, ['main:about:blank'])
})

await test('a missing explicit target fails without navigating another native window', async () => {
  const navigations: string[] = []
  await assert.rejects(
    AttemptSession.prototype.nextPage.call(
      { firstPage: true, options: { persistent: { existingTargetId: 'missing' } } },
      { pages: () => [page('auxiliary', navigations)] }
    ),
    /requested native target is missing/
  )
  assert.deepEqual(navigations, [])
})

await test('an explicit target cannot silently use the new-context connection mode', () => {
  assert.throws(
    () => web({ connect: { cdpEndpoint: () => 'http://127.0.0.1:12345', existingTargetId: 'main' } }),
    /requires a nonempty target ID and reconnectEndpoint/
  )
})
