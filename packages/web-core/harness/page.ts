import { CoreClient } from '../src/client/CoreClient'

// Page side of the Playwright harness: tests drive `window.harness` through page.evaluate.
const worker = new Worker(new URL('./harnessWorker.ts', import.meta.url), { type: 'module' })
const client = new CoreClient(worker)
const broadcasts: { channel: string; args: unknown[] }[] = []
client.onBroadcast((channel, args) => broadcasts.push({ channel, args }))

Object.assign(globalThis, { harness: { client, broadcasts, CoreClient } })
