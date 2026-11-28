import { PassThrough } from 'node:stream'

import { expect, it } from 'vitest'

import { connectCodexAppServer, type CodexClientHandlers } from '../src/appServerClient'
import { createPeer } from './peer'

async function connect(handlers?: CodexClientHandlers) {
  const peer = createPeer()
  const { ready } = peer.connect(handlers)
  await peer.handshake()
  return { ...peer, client: await ready }
}

it('answers the server with its own request id while independent client requests complete out of order', async () => {
  const approval = Promise.withResolvers<{ decision: 'decline' }>()
  const delta = Promise.withResolvers<string>()
  const peer = await connect({
    requests: { 'item/fileChange/requestApproval': () => approval.promise },
    onNotification: ({ method }) => delta.resolve(method)
  })
  try {
    const catalog = peer.client.listModels()
    const account = peer.client.request('account/usage/read', {})
    const models = await peer.read()
    const usage = await peer.read()
    peer.send({ id: models.id, method: 'item/fileChange/requestApproval', params: {} })
    peer.send({ method: 'item/agentMessage/delta', params: { delta: 'hello' } })
    peer.send({ id: usage.id, result: { summary: { totalTokens: 19 } } })
    expect(await delta.promise).toBe('item/agentMessage/delta')
    expect(await account).toMatchObject({ summary: { totalTokens: 19 } })
    peer.send({ id: models.id, result: { data: [{ id: 'one', displayName: 'First' }], nextCursor: 'more' } })
    const page = await peer.read()
    expect(page).toMatchObject({ method: 'model/list', params: { cursor: 'more' } })
    peer.send({ id: page.id, result: { data: [{ id: 'two', displayName: 'Second' }], nextCursor: null } })
    expect((await catalog).map((model) => model.id)).toEqual(['one', 'two'])
    approval.resolve({ decision: 'decline' })
    expect(await peer.read()).toEqual({ id: models.id, result: { decision: 'decline' } })
  } finally {
    peer.close()
  }
})

it('preserves native errors and rejects unsupported reverse requests without closing the connection', async () => {
  const peer = await connect()
  try {
    peer.send({ id: 'server-1', method: 'future/method', params: {} })
    expect(await peer.read()).toMatchObject({ id: 'server-1', error: { code: -32601 } })
    const request = peer.client.request('thread/resume', { threadId: 'old' })
    const { id } = await peer.read()
    peer.send({ id, error: { code: -32000, message: 'Authentication required', data: { reason: 'expired' } } })
    await expect(request).rejects.toMatchObject({ code: -32000, data: { reason: 'expired' } })
  } finally {
    peer.close()
  }
})

it('rejects every outstanding request on EOF and rejects subsequent calls immediately', async () => {
  const peer = await connect()
  try {
    const first = peer.client.listModels()
    const second = peer.client.request('skills/list', {})
    await peer.read()
    await peer.read()
    const outcomes = Promise.all(
      [first, second].map((operation) => expect(operation).rejects.toThrow('Codex output closed'))
    )
    peer.stdout.end()
    await outcomes
    await expect(peer.client.listModels()).rejects.toThrow('Codex output closed')
  } finally {
    peer.close()
  }
})

it('lets the process owner cancel initialization before Codex has answered', async () => {
  const stdin = new PassThrough()
  const stdout = new PassThrough()
  const wire = connectCodexAppServer(stdin, stdout, { name: 'test', title: null, version: '1' })
  try {
    wire.close()
    await expect(wire.ready).rejects.toThrow('Codex connection closed')
  } finally {
    stdin.end()
    stdout.end()
  }
})
