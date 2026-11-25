import { parentPort } from 'node:worker_threads'

import { NativeWatcher } from './nativeWatcher'
import { watcherCommandSchema, type WatcherReply } from './watcherProtocol'

if (!parentPort) throw new Error('File watcher worker requires a parent port')
const port = parentPort
const watchers = new Map<number, NativeWatcher>()
const send = (reply: WatcherReply) => port.postMessage(reply)

port.on('message', async (raw: unknown) => {
  const command = watcherCommandSchema.parse(raw)
  switch (command.kind) {
    case 'create':
      watchers.set(
        command.id,
        new NativeWatcher(command.input, (event) => send({ kind: 'event', id: command.id, event }))
      )
      break
    case 'close':
      await watchers.get(command.id)?.close()
      watchers.delete(command.id)
      send({ kind: 'event', id: command.id, event: { kind: 'closed' } })
      break
    case 'stop':
      await Promise.all([...watchers.values()].map((watcher) => watcher.close()))
      watchers.clear()
      send({ kind: 'stopped' })
      port.close()
      break
  }
})
