import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  createAssistantMessageEventStream,
  fauxAssistantMessage,
  fauxToolCall,
  InMemoryCredentialStore
} from '@earendil-works/pi-ai'
import { ModelRuntime } from '@earendil-works/pi-coding-agent'
import { expect, it, onTestFinished } from 'vitest'

import { runtimeId, type ObservationPayload, type OperationResult } from '@cherrystudio/agent-runtime'

import { createPiRuntime } from '../src'

function confirmed<T>(result: OperationResult<T>): T {
  expect(result.status).toBe('confirmed')
  if (result.status !== 'confirmed') throw new Error(result.error.message)
  return result.value
}

async function setup() {
  const cwd = mkdtempSync(join(tmpdir(), 'pi-stream-observation-'))
  onTestFinished(() => rmSync(cwd, { recursive: true, force: true }))
  const models = await ModelRuntime.create({
    credentials: new InMemoryCredentialStore(),
    modelsPath: null,
    refreshOnCreate: false
  })
  const stream = createAssistantMessageEventStream()
  const message = fauxAssistantMessage([])
  let started!: () => void
  const ready = new Promise<void>((resolve) => {
    started = resolve
  })
  models.registerProvider('stream-test', {
    api: 'stream-test',
    apiKey: 'unused',
    baseUrl: 'https://stream-test.invalid',
    models: [
      {
        id: 'model',
        name: 'Model',
        reasoning: true,
        input: ['text'],
        contextWindow: 32000,
        maxTokens: 1024,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }
      }
    ],
    streamSimple(model) {
      Object.assign(message, { api: model.api, model: model.id, provider: model.provider })
      stream.push({ type: 'start', partial: message })
      return stream
    }
  })
  const errors: unknown[] = []
  const runtime = confirmed(
    await createPiRuntime({ backendId: runtimeId('stream'), onError: (error) => errors.push(error) })
  )
  onTestFinished(async () => {
    stream.push({ type: 'done', reason: 'stop', message })
    stream.end()
    await runtime.shutdown()
    expect(errors).toEqual([])
  })
  const handle = confirmed(
    await runtime.create({
      cwd,
      agentDir: cwd,
      modelRuntime: models,
      model: models.getModel('stream-test', 'model')!,
      extensionFactories: [
        (pi) => {
          pi.on('message_start', (event) => {
            if (event.message.role === 'assistant') started()
          })
          pi.on('session_start', () => {
            pi.sendUserMessage('Stream a reply')
          })
        }
      ]
    })
  )
  const events: ObservationPayload[] = []
  confirmed(
    await handle.observe((event) => {
      events.push(event)
    })
  )
  await ready
  const updates = () =>
    events.flatMap((event) =>
      event.type === 'message.upsert' && event.message.role === 'assistant' ? [event.message] : []
    )
  const block = (kind: 'text' | 'thinking', initial: string) => {
    const part =
      kind === 'text' ? { type: 'text' as const, text: initial } : { type: 'thinking' as const, thinking: initial }
    const contentIndex = message.content.push(part) - 1
    const set = (value: string) => {
      if (part.type === 'text') part.text = value
      else part.thinking = value
    }
    const get = () => (part.type === 'text' ? part.text : part.thinking)
    return {
      start: () =>
        stream.push({ type: kind === 'text' ? 'text_start' : 'thinking_start', contentIndex, partial: message }),
      delta: (delta: string) => {
        set(get() + delta)
        stream.push({ type: kind === 'text' ? 'text_delta' : 'thinking_delta', contentIndex, delta, partial: message })
      },
      end: (content = get()) => {
        set(content)
        stream.push({ type: kind === 'text' ? 'text_end' : 'thinking_end', contentIndex, content, partial: message })
      }
    }
  }
  return { handle, stream, message, updates, block }
}

for (const kind of ['text', 'thinking'] as const) {
  for (const initial of ['', 'Initial ']) {
    it.each(['paced', 'burst'] as const)(
      `preserves ${kind} starting with ${JSON.stringify(initial)} in %s delivery`,
      async (delivery) => {
        const { handle, updates, block } = await setup()
        const part = block(kind, initial)
        const type = kind === 'text' ? 'text' : 'reasoning'
        part.start()
        if (delivery === 'paced')
          await expect.poll(() => updates().at(-1)?.parts).toMatchObject([{ type, text: initial, state: 'streaming' }])
        part.delta('first')
        if (delivery === 'paced')
          await expect
            .poll(() => updates().at(-1)?.parts)
            .toMatchObject([{ type, text: initial + 'first', state: 'streaming' }])
        part.delta(' second')
        part.end()
        await expect
          .poll(() => updates().at(-1))
          .toMatchObject({
            metadata: { completeness: 'partial' },
            parts: [{ type, text: initial + 'first second', state: 'done' }]
          })
        for (const update of updates())
          for (const value of update.parts) {
            if (value.type === 'text' || value.type === 'reasoning')
              expect((initial + 'first second').startsWith(value.text)).toBe(true)
          }
        const late: ObservationPayload[] = []
        const observation = confirmed(
          await handle.observe((event) => {
            late.push(event)
          })
        )
        await expect.poll(() => late[0]).toMatchObject({ type: 'snapshot' })
        const snapshot = late[0]
        if (snapshot.type !== 'snapshot') throw new Error('Missing snapshot')
        expect(snapshot.messages.filter((message) => message.role === 'assistant')).toEqual([updates().at(-1)])
        await observation.stop()
      }
    )
  }

  it(`shows nonempty ${kind} without any delta before the message finishes`, async () => {
    const { updates, block, stream, message } = await setup()
    const part = block(kind, 'Start only')
    const type = kind === 'text' ? 'text' : 'reasoning'
    part.start()
    await expect.poll(() => updates().at(-1)?.parts).toMatchObject([{ type, text: 'Start only', state: 'streaming' }])
    part.end()
    await expect
      .poll(() => updates().at(-1))
      .toMatchObject({
        metadata: { completeness: 'partial' },
        parts: [{ type, text: 'Start only', state: 'done' }]
      })
    stream.push({ type: 'done', reason: 'stop', message })
    stream.end()
    await expect
      .poll(() => updates().at(-1))
      .toMatchObject({
        metadata: { completeness: 'complete' },
        parts: [{ type, text: 'Start only', state: 'done' }]
      })
  })

  it(`keeps authoritative ${kind} end corrections when a later block streams`, async () => {
    const { updates, block } = await setup()
    const part = block(kind, '')
    const type = kind === 'text' ? 'text' : 'reasoning'
    part.start()
    part.delta('Draft with trailing text')
    await expect.poll(() => updates().at(-1)?.parts).toMatchObject([{ text: 'Draft with trailing text' }])
    part.end('Corrected')
    await expect.poll(() => updates().at(-1)?.parts).toMatchObject([{ type, text: 'Corrected', state: 'done' }])
    const next = block('text', '')
    next.start()
    next.delta('Next')
    await expect
      .poll(() => updates().at(-1)?.parts)
      .toMatchObject([
        { type, text: 'Corrected', state: 'done' },
        { type: 'text', text: 'Next', state: 'streaming' }
      ])
    next.end()
  })
}

it('retains corrected text across interleaved tool input and an aborted response', async () => {
  const { updates, block, stream, message } = await setup()
  const first = block('thinking', 'Reason')
  first.start()
  first.end('Correct reasoning')
  const call = fauxToolCall('echo', {}, { id: 'call-1' })
  const contentIndex = message.content.push(call) - 1
  stream.push({ type: 'toolcall_start', contentIndex, partial: message })
  call.arguments = { text: 'Input' }
  stream.push({ type: 'toolcall_delta', contentIndex, delta: '{"text":"Input"}', partial: message })
  stream.push({ type: 'toolcall_end', contentIndex, toolCall: call, partial: message })
  const last = block('text', 'After ')
  last.start()
  last.delta('tool')
  await expect
    .poll(() => updates().at(-1)?.parts)
    .toMatchObject([
      { type: 'reasoning', text: 'Correct reasoning', state: 'done' },
      { type: 'dynamic-tool', toolCallId: 'call-1', input: { text: 'Input' }, state: 'input-available' },
      { type: 'text', text: 'After tool', state: 'streaming' }
    ])
  message.stopReason = 'aborted'
  stream.push({ type: 'error', reason: 'aborted', error: message })
  stream.end()
  await expect
    .poll(() => updates().at(-1))
    .toMatchObject({
      metadata: { completeness: 'complete' },
      parts: [
        { type: 'reasoning', text: 'Correct reasoning' },
        { type: 'dynamic-tool', toolCallId: 'call-1', input: { text: 'Input' } },
        { type: 'text', text: 'After tool', state: 'done' }
      ]
    })
})
