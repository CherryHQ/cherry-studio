import { parentPort, workerData } from 'node:worker_threads'

import {
  getSessionInfo,
  getSessionMessages,
  getSubagentMessages,
  importSessionToStore,
  listSubagents
} from '@anthropic-ai/claude-agent-sdk'

const { sessionId, cwd } = workerData
const options = { dir: cwd }
const info = await getSessionInfo(sessionId, options)
if (!info || info.sessionId !== sessionId) {
  parentPort.postMessage(null)
} else {
  const entries = []
  await importSessionToStore(
    sessionId,
    {
      async append(key, batch) {
        entries.push({ subpath: key.subpath, entries: batch })
      },
      async load() {
        return null
      }
    },
    { ...options, includeSubagents: true }
  )
  const ids = await listSubagents(sessionId, options)
  const children = await Promise.all(
    ids.map(async (agentId) => ({ agentId, messages: await getSubagentMessages(sessionId, agentId, options) }))
  )
  parentPort.postMessage({ messages: await getSessionMessages(sessionId, options), children, entries })
}
