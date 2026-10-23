import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'

import { SandboxManager } from '@cherrystudio/sandbox'

import { prepareRpc } from './runtime.mjs'

const python = process.argv.includes('--python')
const packageRoot = fileURLToPath(new URL('../', import.meta.url))
const manager = new SandboxManager()
const guest = prepareRpc(packageRoot, python)
const spec = guest.spec
try {
  const instance = manager.start(spec, {
    rpc: {
      authorize: async ({ ownerId, method }) => ownerId === 'rpc-demo' && method === 'example.double',
      configure(peer) {
        peer.handle('example.double', async ({ value }) => {
          if (!Number.isSafeInteger(value) || !Number.isSafeInteger(value * 2))
            throw new Error('Expected a safe integer')
          return { value: value * 2 }
        })
      }
    }
  })
  const errors = (async () => {
    for await (const chunk of instance.stderr) process.stderr.write(chunk)
  })()
  await instance.ready
  const result = await instance.rpc.request('example.compute', { value: 20 })
  assert.deepEqual(result, { value: 41 })
  process.stdout.write(JSON.stringify({ runtime: python ? 'python' : 'node', result }) + '\n')
  const completion = await instance.stop()
  await errors
  process.stdout.write(JSON.stringify({ completion }) + '\n')
} finally {
  const stopped = await manager.dispose()
  if (stopped.every((result) => result.tree !== 'unknown' && result.cleanup === 'complete')) guest.cleanup()
}
