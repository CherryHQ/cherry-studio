import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { Worker } from 'node:worker_threads'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { RuntimeForkResult } from '../../fork'
import { forkClaudeSession } from '../claudeFork'

vi.mock('../forkWorker?nodeWorker', () => ({
  default: (options: ConstructorParameters<typeof Worker>[1]) =>
    new Worker(new URL('../forkWorker.ts', import.meta.url), options)
}))

describe('Claude native forks', () => {
  it('maps UUIDs once in isolated SDK workers through a child and grandchild', async () => {
    const userUuid = '20249b48-e174-4610-84c2-af6224228290'
    let entries = [
      { type: 'user', uuid: userUuid, parentUuid: null, sessionId, message: { role: 'user', content: 'PAST_ONLY' } },
      {
        type: 'assistant',
        uuid: messageUuid,
        parentUuid: userUuid,
        sessionId,
        message: { role: 'assistant', content: [{ type: 'text', text: 'PAST_ONLY' }] }
      }
    ]
    let currentId = sessionId
    let currentUuid = messageUuid
    const parentEnv = process.env.CLAUDE_CONFIG_DIR
    for (const name of ['child', 'grandchild']) {
      const checkpoint = {
        runtime: 'claude-code',
        runtimeSessionId: currentId,
        messageUuid: currentUuid,
        configDir: directory
      }
      const worker = new Worker(new URL('../forkWorker.ts', import.meta.url), {
        workerData: {
          entries,
          checkpoint,
          checkpoints: [checkpoint],
          artifactDirectory: path.join(directory, name),
          targetCwd: directory
        },
        env: { ...process.env }
      })
      let result: RuntimeForkResult
      try {
        result = await new Promise<RuntimeForkResult>((resolve, reject) => {
          worker.once('message', (message) =>
            message.error ? reject(new Error(message.error)) : resolve(message.result)
          )
          worker.once('error', reject)
          worker.once('exit', (code) => reject(new Error('worker exited: ' + code)))
        })
      } finally {
        await worker.terminate()
      }
      const output = (await readFile(result.publish[0].source, 'utf8'))
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line))
      const mapped = output.find((entry) => entry.forkedFrom?.messageUuid === currentUuid)
      expect(mapped).toBeDefined()
      expect(mapped.uuid).not.toBe(currentUuid)
      expect(result.checkpoints[0]).toMatchObject({ messageUuid: mapped.uuid, configDir: directory })
      expect(JSON.stringify(output)).toContain('PAST_ONLY')
      expect(process.env.CLAUDE_CONFIG_DIR).toBe(parentEnv)
      entries = output
      currentId = result.resumeToken
      currentUuid = mapped.uuid
      await rm(result.publish[0].source)
    }
  })
  const sessionId = '374c8467-e787-4c67-b890-a3d91b50dba6'
  const messageUuid = '9ad4b714-fe5d-4664-9f76-2b0cd13f4c03'
  let directory: string
  let file: string
  const entry = JSON.stringify({
    type: 'assistant',
    uuid: messageUuid,
    isSidechain: false,
    message: { content: '检查点' }
  })
  beforeEach(async () => {
    directory = await mkdtemp(path.join(tmpdir(), 'cherry-claude-checkpoint-test-'))
    file = path.join(directory, 'projects', 'project', sessionId + '.jsonl')
  })
  afterEach(async () => {
    await rm(directory, { recursive: true, force: true })
  })

  function forkInput() {
    const checkpoint = {
      runtime: 'claude-code' as const,
      runtimeSessionId: sessionId,
      messageUuid,
      configDir: directory
    }
    return {
      sourceSessionId: 'source',
      targetSessionId: 'child',
      targetCwd: directory,
      artifactDirectory: path.join(directory, 'artifacts'),
      checkpoint,
      checkpoints: [checkpoint],
      signal: new AbortController().signal
    }
  }

  it('rejects malformed native checkpoints before looking for history', async () => {
    const input = forkInput()
    input.checkpoint.messageUuid = 'not-a-uuid'
    await expect(forkClaudeSession(input)).rejects.toMatchObject({ reason: 'unsupported_checkpoint' })
  })

  it.each(['\n', '\r\n'])('forks the exact UUID on demand and excludes later history (%j)', async (newline) => {
    await mkdir(path.dirname(file), { recursive: true })
    await writeFile(
      file,
      entry +
        newline +
        JSON.stringify({ type: 'user', uuid: 'future-message', message: { content: 'FUTURE_ONLY' } }) +
        newline
    )
    const before = await readFile(file)
    const result = await forkClaudeSession(forkInput())
    const output = await readFile(result.publish[0].source, 'utf8')
    expect(output).not.toContain('FUTURE_ONLY')
    expect(JSON.parse(output.trim().split('\n')[0]).forkedFrom.messageUuid).toBe(messageUuid)
    expect(result.resumeToken).not.toBe(sessionId)
    expect(await readFile(file)).toEqual(before)
  })

  it.each([
    ['missing', '', 'history_missing'],
    ['unflushed', entry, 'history_missing'],
    ['corrupt', 'invalid-json\n' + entry + '\n', 'history_corrupt']
  ])('reports %s history instead of selecting another boundary', async (_name, content, reason) => {
    await mkdir(path.dirname(file), { recursive: true })
    await writeFile(file, content)
    await expect(forkClaudeSession(forkInput())).rejects.toMatchObject({ reason })
  })
})
