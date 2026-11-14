import { once } from 'node:events'
import { serialize } from 'node:v8'
import { parentPort, workerData } from 'node:worker_threads'

import {
  getSessionInfo,
  getSessionMessages,
  getSubagentMessages,
  importSessionToStore,
  listSubagents
} from '@anthropic-ai/claude-agent-sdk'

const { sessionId, cwd, chunkBytes } = workerData
const options = { dir: cwd }

async function send(message, transfer = []) {
  const acknowledged = once(parentPort, 'message')
  parentPort.postMessage(message, transfer)
  await acknowledged
}

async function sendRecords(header, records) {
  let buffers = []
  let bytes = 0
  for (const record of records) {
    const encoded = serialize(record)
    if (encoded.byteLength > chunkBytes) {
      throw new Error(`Claude archive record exceeds the ${chunkBytes}-byte transfer limit`)
    }
    // Also bound the number of transferable buffers when records are tiny.
    if (bytes + encoded.byteLength > chunkBytes || buffers.length === 256) {
      await send({ ...header, buffers }, buffers)
      buffers = []
      bytes = 0
    }
    buffers.push(encoded.buffer)
    bytes += encoded.byteLength
  }
  if (buffers.length > 0) await send({ ...header, buffers }, buffers)
}

const info = await getSessionInfo(sessionId, options)
if (!info || info.sessionId !== sessionId) {
  parentPort.postMessage({ kind: 'missing' })
} else {
  await importSessionToStore(
    sessionId,
    {
      async append(key, batch) {
        // Restore needs the raw entry's metadata, while the SDK message supplies its body.
        const entries = batch.map((entry) => ({
          type: entry.type,
          uuid: entry.uuid,
          supersedes: entry.supersedes,
          retracted_message_uuids: entry.retracted_message_uuids,
          isAbortedMidStream: entry.isAbortedMidStream,
          isApiErrorMessage: entry.isApiErrorMessage,
          ...(Object.hasOwn(entry, 'parentAgentId') && { parentAgentId: entry.parentAgentId })
        }))
        await sendRecords({ kind: 'entries', subpath: key.subpath }, entries)
      },
      async load() {
        return null
      }
    },
    { ...options, includeSubagents: true }
  )
  for (const agentId of await listSubagents(sessionId, options)) {
    await send({ kind: 'child', agentId })
    await sendRecords({ kind: 'child-messages', agentId }, await getSubagentMessages(sessionId, agentId, options))
  }
  await sendRecords({ kind: 'messages' }, await getSessionMessages(sessionId, options))
  parentPort.postMessage({ kind: 'done' })
}
