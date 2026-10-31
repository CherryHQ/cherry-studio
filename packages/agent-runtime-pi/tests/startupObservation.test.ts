import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { createAssistantMessageEventStream, fauxAssistantMessage, InMemoryCredentialStore } from '@earendil-works/pi-ai'
import { ModelRuntime, SessionManager, type ExtensionFactory } from '@earendil-works/pi-coding-agent'
import { expect, it, onTestFinished } from 'vitest'

import { runtimeId, type ObservationPayload, type OperationResult } from '@cherrystudio/agent-runtime'

import { createPiRuntime } from '../src'

function confirmed<T>(result: OperationResult<T>): T {
  expect(result.status).toBe('confirmed')
  if (result.status !== 'confirmed') throw new Error(result.error.message)
  return result.value
}

it.each(['create', 'open'] as const)('observes startup output before completion through %s', async (operation) => {
  const cwd = mkdtempSync(join(tmpdir(), 'pi-startup-observation-'))
  onTestFinished(() => rmSync(cwd, { recursive: true, force: true }))
  const modelRuntime = await ModelRuntime.create({
    credentials: new InMemoryCredentialStore(),
    modelsPath: null,
    refreshOnCreate: false
  })
  const stream = createAssistantMessageEventStream()
  const message = fauxAssistantMessage('')
  let started!: () => void
  const startup = new Promise<void>((resolve) => {
    started = resolve
  })
  modelRuntime.registerProvider('startup-test', {
    api: 'startup-test',
    apiKey: 'unused',
    baseUrl: 'https://startup-test.invalid',
    models: [
      {
        id: 'startup-model',
        name: 'Startup',
        reasoning: false,
        input: ['text'],
        contextWindow: 32000,
        maxTokens: 1024,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }
      }
    ],
    streamSimple(model) {
      message.provider = model.provider
      message.model = model.id
      message.api = model.api
      stream.push({ type: 'start', partial: message })
      return stream
    }
  })
  const extension: ExtensionFactory = (pi) => {
    pi.on('message_start', (event) => {
      if (event.message.role === 'assistant') started()
    })
    pi.on('session_start', async () => {
      pi.sendUserMessage('startup task')
      await startup
    })
  }
  const manager = SessionManager.inMemory(cwd)
  const options = {
    cwd,
    agentDir: cwd,
    modelRuntime,
    model: modelRuntime.getModel('startup-test', 'startup-model')!,
    sessionManager: manager,
    extensionFactories: [extension]
  }
  const runtime = confirmed(await createPiRuntime({ backendId: runtimeId('startup'), load: async () => options }))
  onTestFinished(async () => {
    stream.push({ type: 'done', reason: 'stop', message })
    stream.end()
    await runtime.shutdown()
  })
  const handle = confirmed(
    operation === 'create'
      ? await runtime.create(options)
      : await runtime.open({ backendId: runtimeId('startup'), id: runtimeId(manager.getSessionId()) })
  )
  const events: ObservationPayload[] = []
  confirmed(
    await handle.observe((event) => {
      events.push(event)
    })
  )
  const text = { type: 'text' as const, text: '' }
  message.content = [text]
  stream.push({ type: 'text_start', contentIndex: 0, partial: message })
  text.text = 'First'
  stream.push({ type: 'text_delta', contentIndex: 0, delta: 'First', partial: message })
  const updates = () => events.filter((event) => event.type === 'message.upsert' && event.message.role === 'assistant')
  await expect
    .poll(() => updates().at(-1))
    .toMatchObject({
      message: { metadata: { completeness: 'partial' }, parts: [{ type: 'text', text: 'First', state: 'streaming' }] }
    })
  text.text = 'First second'
  stream.push({ type: 'text_delta', contentIndex: 0, delta: ' second', partial: message })
  await expect
    .poll(() => updates().at(-1))
    .toMatchObject({
      message: {
        metadata: { completeness: 'partial' },
        parts: [{ type: 'text', text: 'First second', state: 'streaming' }]
      }
    })
  stream.push({ type: 'text_end', contentIndex: 0, content: 'First second', partial: message })
  stream.push({ type: 'done', reason: 'stop', message })
  stream.end()
  await expect.poll(() => events.at(-1)).toMatchObject({ type: 'activity.changed', activity: { state: 'idle' } })
  const snapshots: ObservationPayload[] = []
  confirmed(
    await handle.observe((event) => {
      snapshots.push(event)
    })
  )
  await expect.poll(() => snapshots[0]).toMatchObject({ type: 'snapshot' })
  const snapshot = snapshots[0]
  if (snapshot.type !== 'snapshot') throw new Error('Missing snapshot')
  expect(snapshot.messages.filter((item) => item.role === 'assistant')).toMatchObject([
    { metadata: { completeness: 'complete' }, parts: [{ type: 'text', text: 'First second', state: 'done' }] }
  ])
})
