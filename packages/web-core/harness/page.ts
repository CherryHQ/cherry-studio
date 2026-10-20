import { CoreClient } from '../src/client/CoreClient'

// Page side of the Playwright harness: tests drive `window.harness` through page.evaluate.
const worker = new Worker(new URL('./harnessWorker.ts', import.meta.url), { type: 'module' })
const client = new CoreClient(worker)
const broadcasts: { channel: string; payload: unknown }[] = []
client.onBroadcast((channel, payload) => broadcasts.push({ channel, payload }))

Object.assign(globalThis, { harness: { client, broadcasts, CoreClient } })
