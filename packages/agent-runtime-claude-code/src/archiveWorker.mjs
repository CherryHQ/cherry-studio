import { once } from 'node:events'
import { open, readdir, realpath, stat } from 'node:fs/promises'
import path from 'node:path'
import { serialize } from 'node:v8'
import { parentPort, workerData } from 'node:worker_threads'

import {
  getSessionInfo,
  getSessionMessages,
  getSubagentMessages,
  importSessionToStore
} from '@anthropic-ai/claude-agent-sdk'

const { sessionId, cwd, agentId: selectedChild, chunkBytes, childBytes, sessionBytes } = workerData
const options = { dir: cwd }

async function send(message, transfer = []) {
  const acknowledged = once(parentPort, 'message')
  parentPort.postMessage(message, transfer)
  await acknowledged
}

async function sendBuffers(header, records) {
  let buffers = []
  let bytes = 0
  for (const encoded of records) {
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

function* encode(records) {
  for (const record of records) yield serialize(record)
}

function projectEntries(batch, subpath) {
  // Restore needs the raw entry's metadata, while the SDK message supplies its body.
  return batch.map((entry) => ({
    type: entry.type,
    uuid: entry.uuid,
    ...(entry.type === 'user' &&
      entry.parentUuid === null &&
      entry.isSidechain === true &&
      subpath === `subagents/agent-${entry.agentId}` && { childOpening: true }),
    supersedes: entry.supersedes,
    retracted_message_uuids: entry.retracted_message_uuids,
    isAbortedMidStream: entry.isAbortedMidStream,
    isApiErrorMessage: entry.isApiErrorMessage,
    ...(Object.hasOwn(entry, 'parentAgentId') && { parentAgentId: entry.parentAgentId })
  }))
}

async function findSessionDirectory(info) {
  const projects = path.join(process.env.CLAUDE_CONFIG_DIR, 'projects')
  const resolvedCwd = await realpath(cwd).catch(() => cwd)
  const projectKeys = new Set([
    process.env.CLAUDE_CODE_PROJECT_DIR_NAME,
    ...[resolvedCwd, cwd, info?.cwd].map((dir) => dir?.replace(/[^a-zA-Z0-9]/g, '-'))
  ])
  const projectsOnDisk = await readdir(projects, { withFileTypes: true }).catch(() => [])
  // Worktree and long-path sessions can live under a different project key.
  for (const entry of projectsOnDisk) if (entry.isDirectory()) projectKeys.add(entry.name)
  let fallback
  for (const key of projectKeys) {
    if (!key || key !== path.basename(key) || key === '..') continue
    const directory = path.join(projects, key)
    const file = await stat(path.join(directory, sessionId + '.jsonl')).catch(() => undefined)
    if (!file?.isFile() || file.size === 0) continue
    const session = path.join(directory, sessionId)
    if (!info || (file.size === info.fileSize && Math.floor(file.mtimeMs) === info.lastModified)) return session
    fallback ??= session
  }
  return fallback
}

async function* childFiles(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true }).catch(() => [])) {
    const file = path.join(directory, entry.name)
    if (entry.isDirectory()) yield* childFiles(file)
    else if (entry.isFile() && entry.name.startsWith('agent-') && entry.name.endsWith('.jsonl')) yield file
  }
}

async function readBounded(file, limit) {
  const info = await stat(file).catch(() => undefined)
  if (!info?.isFile() || info.size === 0) return { bytes: 0 }
  if (info.size > limit) return { bytes: info.size }
  const handle = await open(file, 'r').catch(() => undefined)
  if (!handle) return { bytes: 0 }
  try {
    const { size: bytes } = await handle.stat()
    if (bytes > limit || bytes === 0) return { bytes }
    // Read a fixed snapshot because the CLI may append after stat.
    const data = Buffer.allocUnsafe(bytes)
    let offset = 0
    while (offset < bytes) {
      const { bytesRead } = await handle.read(data, offset, bytes - offset, offset)
      if (bytesRead === 0) break
      offset += bytesRead
    }
    return { bytes, data: data.subarray(0, offset) }
  } finally {
    await handle.close()
  }
}

function json(line) {
  if (!line) return
  try {
    const value = JSON.parse(line)
    if (value && typeof value === 'object') return value
  } catch {
    // The SDK ignores incomplete or malformed transcript lines.
  }
}

async function readChild(file, agentId, subpath, remaining) {
  const limit = Math.min(childBytes, remaining)
  const { bytes, data } = await readBounded(file, limit)
  const sidecarFile = file.slice(0, -'.jsonl'.length) + '.meta.json'
  const sidecar = json((await readBounded(sidecarFile, chunkBytes)).data)
  const deferred = () => ({
    deferredBytes: bytes,
    ...(sidecar?.parentAgentId === null || typeof sidecar?.parentAgentId === 'string'
      ? { parentAgentId: sidecar.parentAgentId }
      : {}),
    ...(typeof sidecar?.toolUseId === 'string' && { toolCallId: sidecar.toolUseId })
  })
  if (bytes > limit) return deferred()

  const records = data ? data.toString('utf8').split('\n').map(json).filter(Boolean) : []
  if (sidecar) records.push({ type: 'agent_metadata', ...sidecar })
  let transferBytes = 0
  function exceedsBudget(encoded) {
    transferBytes += encoded.byteLength
    return encoded.byteLength > chunkBytes || transferBytes > limit
  }
  const entries = []
  for (const encoded of encode(projectEntries(records, subpath))) {
    if (exceedsBudget(encoded)) return deferred()
    entries.push(encoded)
  }
  const messages = await getSubagentMessages(sessionId, agentId, {
    ...options,
    sessionStore: { load: async () => records }
  })
  const buffers = []
  for (const encoded of encode(messages)) {
    if (exceedsBudget(encoded)) return deferred()
    buffers.push(encoded)
  }
  return { entries, buffers, bytes: Math.max(bytes, transferBytes) }
}

const info = selectedChild === undefined ? await getSessionInfo(sessionId, options) : undefined
if (
  selectedChild === undefined
    ? info?.sessionId !== sessionId
    : !/^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/i.test(sessionId)
) {
  parentPort.postMessage({ kind: 'missing' })
} else {
  const directory = await findSessionDirectory(info)
  if (selectedChild === undefined) {
    await importSessionToStore(
      sessionId,
      {
        async append(key, batch) {
          await sendBuffers({ kind: 'entries', subpath: key.subpath }, encode(projectEntries(batch, key.subpath)))
        },
        async load() {
          return null
        }
      },
      { ...options, includeSubagents: false }
    )
  }
  let remaining = selectedChild === undefined ? sessionBytes : childBytes
  let found = false
  if (directory) {
    for await (const file of childFiles(path.join(directory, 'subagents'))) {
      const agentId = path.basename(file).slice('agent-'.length, -'.jsonl'.length)
      if (selectedChild !== undefined && selectedChild !== agentId) continue
      found = true
      const subpath = path.relative(directory, file).split(path.sep).join('/').slice(0, -'.jsonl'.length)
      const child = await readChild(file, agentId, subpath, remaining)
      if ('deferredBytes' in child) await send({ kind: 'child', child: { agentId, ...child } })
      else {
        remaining -= child.bytes
        await send({ kind: 'child', child: { agentId } })
        await sendBuffers({ kind: 'entries', subpath }, child.entries)
        await sendBuffers({ kind: 'child-messages', agentId }, child.buffers)
      }
      if (selectedChild !== undefined) break
    }
  }
  if (selectedChild === undefined)
    await sendBuffers({ kind: 'messages' }, encode(await getSessionMessages(sessionId, options)))
  parentPort.postMessage({ kind: selectedChild === undefined || found ? 'done' : 'missing' })
}
