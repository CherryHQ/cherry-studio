import { mkdtemp, readFile, readdir, rmdir, unlink, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import { MockApplicationUtils } from '@test-mocks/main/application'
import { generateText } from 'ai'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import { application } from '@application'
import { BaseService, Emitter } from '@main/core/lifecycle'

import type { MemoryAuthority } from '../memoryAuthority'
import { type MemoryEntry, serializeMemoryEntries } from '../memoryEntries'
import { memoryRuntimeFetch } from '../memoryRuntime'
import { MemoryService } from '../MemoryService'

let root: string
let service: MemoryService
const owner: MemoryAuthority = { scope: { kind: 'shared' }, assertAuthorized: () => undefined }
const fact: MemoryEntry = {
  schemaVersion: 1,
  id: 'home',
  status: 'active',
  text: 'UNIQUE_OLD_ADDRESS',
  derivedFrom: [],
  sources: [{ kind: 'chat', conversationId: 'chat', messageId: 'message', sourceVersion: 'v1' }]
}
const entryFile = () => application.getPath('feature.memory.data', 'MEMORY.md')

async function removeFixture(directory: string): Promise<void> {
  if (directory !== root && !directory.startsWith(`${root}${path.sep}`)) throw new Error('Outside fixture')
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name)
    if (entry.isDirectory()) await removeFixture(target)
    else await unlink(target)
  }
  await rmdir(directory)
}

beforeEach(async () => {
  BaseService.resetInstances()
  root = await mkdtemp(path.join(os.tmpdir(), 'memory-runtime-'))
  vi.spyOn(application, 'getPath').mockImplementation((key, name) => path.join(root, key, name ?? ''))
  service = new MemoryService()
  MockApplicationUtils.setService('MemoryService', service)
  const session = service.open(owner)
  await session.entry()
  session.dispose()
  await writeFile(entryFile(), serializeMemoryEntries([fact]))
})

afterEach(async () => {
  await service['_doStop']()
  vi.restoreAllMocks()
  MockApplicationUtils.resetServices()
  await removeFixture(root)
})

async function clear() {
  const editor = service.open(owner)
  const preview = await editor.previewClear()
  await editor.clear(preview.token, async () => () => undefined)
  editor.dispose()
}

it('blocks old system, tools and summaries at the provider transport after a real clear and service restart', async () => {
  const received: unknown[] = []
  const transport: typeof fetch = async (_input, init) => {
    received.push(JSON.parse(String(init?.body)))
    return Response.json({
      id: 'reply',
      created: 0,
      model: 'test',
      choices: [{ index: 0, message: { role: 'assistant', content: 'OK' }, finish_reason: 'stop' }]
    })
  }
  const run = () =>
    generateText({
      model: createOpenAICompatible({
        name: 'test',
        baseURL: 'https://test.invalid/v1',
        fetch: memoryRuntimeFetch(transport, () => [owner])
      })('test'),
      system: 'Old reference: UNIQUE_OLD_ADDRESS',
      messages: [
        { role: 'user', content: 'Continue' },
        { role: 'assistant', content: [{ type: 'tool-call', toolCallId: 'read', toolName: 'read', input: {} }] },
        {
          role: 'tool',
          content: [
            {
              type: 'tool-result',
              toolCallId: 'read',
              toolName: 'read',
              output: { type: 'text', value: 'UNIQUE_OLD_ADDRESS' }
            }
          ]
        },
        { role: 'user', content: 'Summary: UNIQUE_OLD_ADDRESS' }
      ],
      maxRetries: 0
    })
  expect((await run()).text).toBe('OK')
  expect(JSON.stringify(received[0])).toContain('UNIQUE_OLD_ADDRESS')
  await clear()
  expect(await readFile(entryFile(), 'utf8')).not.toContain('UNIQUE_OLD_ADDRESS')
  await expect(run()).rejects.toThrow('isolation')
  await service['_doStop']()
  BaseService.resetInstances()
  service = new MemoryService()
  MockApplicationUtils.setService('MemoryService', service)
  await expect(run()).rejects.toThrow('isolation')
  expect(received).toHaveLength(1)
})

it.each(['clear', 'revoke'] as const)(
  'aborts an in-flight upstream request on %s and cannot return its result',
  async (change) => {
    const revoked = new Emitter<void>()
    let started!: () => void
    const ready = new Promise<void>((resolve) => {
      started = resolve
    })
    const transport: typeof fetch = async (_input, init) =>
      new Promise((_resolve, reject) => {
        init!.signal!.addEventListener('abort', () => reject(init!.signal!.reason), { once: true })
        started()
      })
    const guarded = memoryRuntimeFetch(transport, () => [{ ...owner, onRevoked: revoked.event }])
    const pending = guarded('https://test.invalid')
    const rejected = expect(pending).rejects.toThrow('invalidated')
    await ready
    if (change === 'clear') await clear()
    else revoked.fire()
    await rejected
    revoked.dispose()
  }
)

it.each(['expired', 'forgotten', 'broken'] as const)(
  'rejects persistent %s state before sending any request',
  async (state) => {
    await writeFile(
      entryFile(),
      state === 'broken'
        ? '<!-- cherry-memory-entry:v9\n{}\n-->'
        : serializeMemoryEntries([
            {
              ...fact,
              status: state,
              text: state === 'forgotten' ? '' : fact.text,
              sources: [{ ...fact.sources[0], sourceVersion: 'v2' }]
            }
          ])
    )
    const received: string[] = []
    const guarded = memoryRuntimeFetch(
      async () => {
        received.push('sent')
        return Response.json({})
      },
      () => [owner]
    )
    await expect(guarded('https://test.invalid')).rejects.toThrow()
    expect(received).toEqual([])
  }
)

it('keeps unowned requests and ordinary legacy memory working', async () => {
  await writeFile(entryFile(), 'Plain legacy preference')
  const transport: typeof fetch = async () => Response.json({ answer: 'OK' })
  expect(await (await memoryRuntimeFetch(transport, () => [owner])('https://test.invalid')).json()).toEqual({
    answer: 'OK'
  })
  await clear()
  expect(await (await memoryRuntimeFetch(transport, () => [])('https://test.invalid')).json()).toEqual({ answer: 'OK' })
})
