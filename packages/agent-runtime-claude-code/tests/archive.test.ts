import { createHash, randomUUID } from 'node:crypto'
import { once } from 'node:events'
import { appendFile, mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { Worker } from 'node:worker_threads'

import { afterEach, expect, it } from 'vitest'

import { runtimeId } from '@cherrystudio/agent-runtime'

import { createClaudeCodeRuntime } from '../src'
import { ARCHIVE_CHUNK_BYTES, readArchive } from '../src/archive'
import { confirmed } from './nativeFixture'

const cleanups: (() => Promise<unknown>)[] = []
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
})

async function transcript() {
  const directory = await realpath(await mkdtemp(path.join(tmpdir(), 'claude-archive-')))
  cleanups.push(() => rm(directory, { recursive: true, force: true }))
  const cwd = path.join(directory, 'work')
  const configDir = path.join(directory, 'config')
  const project = path.join(configDir, 'projects', cwd.replace(/[^a-zA-Z0-9]/g, '-'))
  const id = randomUUID()
  const file = path.join(project, `${id}.jsonl`)
  await mkdir(cwd)
  await mkdir(project, { recursive: true })
  await writeFile(file, '{"type":"custom-title","customTitle":"Archive fixture"}\n')
  return { cwd, configDir, id, file }
}

function message(sessionId: string, parentUuid: string | null, text: string) {
  return {
    type: 'user',
    uuid: randomUUID(),
    sessionId,
    parentUuid,
    isSidechain: false,
    timestamp: new Date(0).toISOString(),
    message: { role: 'user', content: [{ type: 'text', text }] }
  }
}

it('restores ordered history across byte chunks and isolates archive and observation data', async () => {
  const { cwd, configDir, id, file } = await transcript()
  const expected = createHash('sha256')
  const ids: string[] = []
  for (let i = 0; i < 10; i++) {
    const text = i + '历史🙂'.repeat(262144)
    const row = message(id, ids.at(-1) ?? null, text)
    ids.push(row.uuid)
    expected.update(text)
    await appendFile(file, JSON.stringify(row) + '\n')
  }
  const subagents = path.join(file.slice(0, -'.jsonl'.length), 'subagents')
  await mkdir(subagents, { recursive: true })
  await writeFile(path.join(subagents, 'agent-123abc.jsonl'), '{"type":"progress"}\n')

  const native = await readArchive(configDir, cwd, id)
  expect(native?.children).toEqual([{ agentId: '123abc', messages: [] }])
  expect(native?.messages.map((row) => row.uuid)).toEqual(ids)
  const backendId = runtimeId<'backend'>(randomUUID())
  const runtime = createClaudeCodeRuntime({ backendId, configDir, load: async () => ({ cwd }) })
  cleanups.push(() => runtime.shutdown())
  const handle = confirmed(await runtime.open({ backendId, id: runtimeId(id) }))
  cleanups.push(() => handle.release())
  const archive = confirmed(await handle.claude.archive({ refresh: false }))
  expect(archive.content.map((row) => row.id)).toEqual(ids)
  const digest = createHash('sha256')
  for (const row of archive.content) {
    const part = row.parts[0]
    if (part?.type !== 'text') throw new Error('Expected restored text')
    digest.update(part.text)
    part.text = 'mutated by archive consumer'
  }
  expect(digest.digest('hex')).toBe(expected.digest('hex'))

  const observation = confirmed(
    await handle.claude.observe((batch) => {
      const snapshot = batch.events[0]
      if (snapshot?.type !== 'snapshot') throw new Error('Expected initial snapshot')
      expect(snapshot.messages.map((row) => row.id)).toEqual(ids)
      expect(batch.native.map((row) => row.message.uuid)).toEqual(ids)
      const part = snapshot.messages[0].parts[0]
      if (part?.type !== 'text') throw new Error('Expected restored text')
      expect(part.text.startsWith('0历史🙂')).toBe(true)
      part.text = 'mutated by observer'
    })
  )
  await observation.drain()
  await observation.stop()
  expect(confirmed(await handle.claude.archive({ refresh: false })).content[0].parts[0]).toMatchObject({
    text: expect.stringMatching(/^0历史🙂/)
  })
  await expect(readArchive(configDir, cwd, randomUUID())).resolves.toBeNull()
}, 30000)

it('keeps at most one byte-bounded chunk in flight until the receiver acknowledges it', async () => {
  const { cwd, configDir, id, file } = await transcript()
  const text = '歷🙂'.repeat(500)
  const head = message(id, null, text)
  const tail = message(id, head.uuid, text)
  await appendFile(file, [head, tail].map((row) => JSON.stringify(row)).join('\n') + '\n')
  const chunkBytes = 4096
  const worker = new Worker(new URL('../src/archiveWorker.mjs', import.meta.url), {
    workerData: { cwd, sessionId: id, chunkBytes },
    env: { ...process.env, CLAUDE_CONFIG_DIR: configDir }
  })
  cleanups.push(() => worker.terminate())
  const nextFrame = async () => {
    const [frame] = await once(worker, 'message')
    return frame
  }
  expect(await nextFrame()).toMatchObject({ kind: 'entries' })
  let next = nextFrame()
  worker.postMessage('ack')
  const first = await next
  expect(first).toMatchObject({ kind: 'messages' })
  expect(first.buffers).toHaveLength(1)
  expect(first.buffers[0].byteLength).toBeLessThanOrEqual(chunkBytes)

  let advanced = false
  next = nextFrame().then((frame) => {
    advanced = true
    return frame
  })
  await new Promise((resolve) => setTimeout(resolve, 50))
  expect(advanced).toBe(false)

  worker.postMessage('ack')
  const second = await next
  expect(second).toMatchObject({ kind: 'messages' })
  expect(second.buffers).toHaveLength(1)
  expect(second.buffers[0].byteLength).toBeLessThanOrEqual(chunkBytes)
  next = nextFrame()
  worker.postMessage('ack')
  expect(await next).toMatchObject({ kind: 'done' })
})

it('rejects an oversized record without publishing a partial archive and can retry', async () => {
  const { cwd, configDir, id, file } = await transcript()
  const row = message(id, null, 'x'.repeat(ARCHIVE_CHUNK_BYTES))
  await appendFile(file, JSON.stringify(row) + '\n')
  const backendId = runtimeId<'backend'>(randomUUID())
  const thread = { backendId, id: runtimeId<'thread'>(id) }
  const errors: unknown[] = []
  const runtime = createClaudeCodeRuntime({
    backendId,
    configDir,
    load: async () => ({ cwd }),
    onError: (error) => errors.push(error)
  })
  cleanups.push(() => runtime.shutdown())
  expect(await runtime.open(thread)).toMatchObject({
    status: 'rejected',
    error: { code: 'native-storage-unavailable' }
  })
  expect(errors).toEqual([expect.objectContaining({ message: expect.stringContaining('transfer limit') })])

  row.message.content[0].text = 'readable retry'
  await writeFile(file, JSON.stringify(row) + '\n')
  const handle = confirmed(await runtime.open(thread))
  cleanups.push(() => handle.release())
  expect(confirmed(await handle.claude.archive({ refresh: false })).content).toMatchObject([
    { id: row.uuid, parts: [{ text: 'readable retry' }] }
  ])
}, 30000)
