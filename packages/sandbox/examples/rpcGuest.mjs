import { createRpcPeer } from '@cherrystudio/sandbox/rpc'

const peer = createRpcPeer(process.stdin, process.stdout, { authorize: async () => true })
peer.handle('example.compute', async ({ value }) => {
  if (!Number.isSafeInteger(value)) throw new Error('Expected an integer')
  const doubled = await peer.request('example.double', { value })
  return { value: doubled.value + 1 }
})
peer.handle('example.forbidden', async () => peer.request('example.secret', {}))
peer.handle('example.wait', async (_params, signal) => {
  await new Promise((resolve) => signal.addEventListener('abort', resolve, { once: true }))
  return null
})
process.stdin.on('end', () => peer.dispose())
