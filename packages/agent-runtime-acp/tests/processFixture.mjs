import { readFile, writeFile } from 'node:fs/promises'
import { Readable, Writable } from 'node:stream'

import { agent, methods, ndJsonStream } from '@agentclientprotocol/sdk'

const archive = process.argv[2]
const sessionId = 'persisted-session'
const hold = setInterval(() => {}, 1000)
process.on('SIGTERM', () => {
  clearInterval(hold)
  process.exit(0)
})
agent({ name: 'owned-child' })
  .onRequest(methods.agent.initialize, () => ({
    protocolVersion: 1,
    agentCapabilities: { loadSession: true, sessionCapabilities: { close: {} } },
    authMethods: []
  }))
  .onRequest(methods.agent.session.new, async () => {
    await writeFile(archive, 'native-history')
    return { sessionId }
  })
  .onRequest(methods.agent.session.load, async ({ client }) => {
    await client.notify(methods.client.session.update, {
      sessionId,
      update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: await readFile(archive, 'utf8') } }
    })
    return {}
  })
  .onRequest(methods.agent.session.close, () => ({}))
  .connect(ndJsonStream(Writable.toWeb(process.stdout), Readable.toWeb(process.stdin)))
