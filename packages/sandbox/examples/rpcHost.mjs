import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { realpathSync } from 'node:fs'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

import { SandboxManager } from '@cherrystudio/sandbox'

const python = process.argv.includes('--python')
const packageRoot = fileURLToPath(new URL('../', import.meta.url)).replace(/\/$/, '')
const executable = realpathSync(
  python ? execFileSync('/usr/bin/xcrun', ['--find', 'python3'], { encoding: 'utf8' }).trim() : process.execPath
)
const guest = fileURLToPath(new URL(python ? './rpcGuest.py' : './rpcGuest.mjs', import.meta.url))
const manager = new SandboxManager()
const spec = {
  ownerId: 'rpc-demo',
  environmentId: 'native',
  runtimeProfileId: 'mxc-command-v1',
  command: { executable, args: [guest], cwd: '/', env: {} },
  filesystem: {
    read: [packageRoot, realpathSync(packageRoot + '/../../node_modules'), dirname(dirname(executable))],
    write: [],
    denyRead: [],
    denyWrite: []
  },
  network: { mode: 'deny' },
  channel: 'stdio',
  limits: {
    startupTimeoutMs: 5000,
    lifetimeMs: 10000,
    stopGraceMs: 100,
    stopTimeoutMs: 1500,
    cleanupTimeoutMs: 1000,
    ioDrainTimeoutMs: 500,
    ioBufferBytes: 65536,
    outputBytes: 1048576
  }
}
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
  await manager.dispose()
}
