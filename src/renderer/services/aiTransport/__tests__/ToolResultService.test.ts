import { afterEach, describe, expect, it, vi } from 'vitest'

import type {
  AiToolResultReadOptions,
  AiToolResultRequest,
  AiToolResultResponse,
  DeferredToolResultRef
} from '@shared/ai/transport'
import { aiRequestSchemas } from '@shared/ipc/schemas/ai'

import { ToolResultService, type ToolResultSnapshot } from '../ToolResultService'

const ref: DeferredToolResultRef = { topicId: 'topic', messageId: 'message', toolCallId: 'tool' }
const preview = { purpose: 'preview' } satisfies AiToolResultReadOptions
const full = { purpose: 'full' } satisfies AiToolResultReadOptions
const ready = (output: unknown): AiToolResultResponse => ({
  status: 'ready',
  purpose: 'preview',
  output,
  truncated: false
})

function bridge(respond: (input: AiToolResultRequest) => AiToolResultResponse | Promise<AiToolResultResponse>) {
  vi.spyOn(window.api.ipcApi, 'request').mockImplementation(async (route, input) => {
    if (route !== 'ai.tool.get_result') throw new Error(`Unexpected route: ${route}`)
    const request = aiRequestSchemas['ai.tool.get_result'].input.parse(input)
    return { ok: true, data: await respond(request) }
  })
}

afterEach(() => vi.restoreAllMocks())

describe('ToolResultService', () => {
  it('publishes replacement B when the same identity receives a late response for A', async () => {
    const old = Promise.withResolvers<AiToolResultResponse>()
    const replacement = Promise.withResolvers<AiToolResultResponse>()
    let reads = 0
    bridge(() => (++reads === 1 ? old.promise : replacement.promise))
    const service = new ToolResultService()
    const observed: ToolResultSnapshot[] = []
    const stop = service.subscribe(ref, preview, (state) => observed.push(state))
    const oldRead = service.read(ref)
    service.invalidate(ref)
    const currentRead = service.read(ref)
    replacement.resolve(ready('B'))
    await expect(currentRead).resolves.toEqual(ready('B'))
    old.resolve(ready('A'))
    await expect(oldRead).resolves.toEqual(ready('B'))
    expect(service.getSnapshot(ref)).toEqual(ready('B'))
    expect(observed.filter((state) => state.status === 'ready')).toEqual([ready('B')])
    stop()
  })

  it('ignores a closed card response when the card reopens with a new request', async () => {
    const old = Promise.withResolvers<AiToolResultResponse>()
    const current = Promise.withResolvers<AiToolResultResponse>()
    let reads = 0
    bridge(() => (++reads === 1 ? old.promise : current.promise))
    const service = new ToolResultService()
    const stop = service.subscribe(ref, preview, () => {})
    const oldRead = service.read(ref)
    stop()
    const observed: ToolResultSnapshot[] = []
    const stopReopened = service.subscribe(ref, preview, (state) => observed.push(state))
    const currentRead = service.read(ref)
    old.resolve(ready('obsolete'))
    current.resolve(ready('current'))
    await Promise.all([oldRead, currentRead])
    expect(service.getSnapshot(ref)).toEqual(ready('current'))
    expect(observed.filter((state) => state.status === 'ready')).toEqual([ready('current')])
    stopReopened()
  })

  it('evicts least recently used results by serialized bytes and never caches a full result exceeding 16 MiB', async () => {
    bridge((input) => ({
      status: 'ready',
      purpose: 'full',
      output: input.toolCallId === 'large' ? 'x'.repeat(17 * 1024 * 1024) : 'x'.repeat(6 * 1024 * 1024)
    }))
    const service = new ToolResultService()
    const first = { ...ref, toolCallId: 'first' }
    const second = { ...ref, toolCallId: 'second' }
    const third = { ...ref, toolCallId: 'third' }
    await service.read(first, full)
    await service.read(second, full)
    expect(service.getSnapshot(first, full).status).toBe('ready')
    await service.read(third, full)
    expect(service.getSnapshot(first, full).status).toBe('ready')
    expect(service.getSnapshot(second, full).status).toBe('idle')
    expect(service.getSnapshot(third, full).status).toBe('ready')
    const large = { ...ref, toolCallId: 'large' }
    const response = await service.read(large, full)
    expect(
      response.status === 'ready' &&
        response.purpose === 'full' &&
        typeof response.output === 'string' &&
        response.output.length
    ).toBe(17 * 1024 * 1024)
    expect(service.getSnapshot(large, full)).toEqual({ status: 'idle' })
  })

  it('keeps another conversation consumer alive and clears cached and in-flight values after the last release', async () => {
    const late = Promise.withResolvers<AiToolResultResponse>()
    bridge((input) => (input.toolCallId === 'late' ? late.promise : ready('shared')))
    const service = new ToolResultService()
    const releaseFirst = service.retainTopic(ref.topicId)
    const releaseSecond = service.retainTopic(ref.topicId)
    await service.read(ref)
    releaseFirst()
    releaseFirst()
    expect(service.getSnapshot(ref)).toEqual(ready('shared'))
    const lateRef = { ...ref, toolCallId: 'late' }
    const pending = service.read(lateRef)
    releaseSecond()
    late.resolve(ready('obsolete'))
    await pending
    expect(service.getSnapshot(ref)).toEqual({ status: 'idle' })
    expect(service.getSnapshot(lateRef)).toEqual({ status: 'idle' })
  })

  it('retries pending on targeted invalidation and on reattachment without treating it as unavailable', async () => {
    let response: AiToolResultResponse = { status: 'pending' }
    bridge(() => response)
    const service = new ToolResultService()
    const observed: ToolResultSnapshot[] = []
    const stop = service.subscribe(ref, preview, (state) => observed.push(state))
    await expect(service.read(ref)).resolves.toEqual({ status: 'pending' })
    expect(service.getSnapshot(ref)).toEqual({ status: 'pending' })
    response = ready('committed')
    service.invalidate(ref)
    await expect(service.read(ref)).resolves.toEqual(ready('committed'))
    expect(observed.at(-1)).toEqual(ready('committed'))
    stop()
    service.invalidateTopic(ref.topicId)
    response = { status: 'pending' }
    const stopPending = service.subscribe(ref, preview, () => {})
    await service.read(ref)
    stopPending()
    response = ready('after reopen')
    const stopReopened = service.subscribe(ref, preview, () => {})
    await expect(service.read(ref)).resolves.toEqual(ready('after reopen'))
    stopReopened()
  })

  it('isolates preview, full and text-range cursors for the same tool identity', async () => {
    bridge((input) =>
      input.purpose === 'text-range'
        ? {
            status: 'ready',
            purpose: 'text-range',
            text: `range:${input.cursor ?? 0}`,
            nextCursor: (input.cursor ?? 0) + 10
          }
        : input.purpose === 'full'
          ? { status: 'ready', purpose: 'full', output: 'full' }
          : ready('preview')
    )
    const service = new ToolResultService()
    await Promise.all([
      service.read(ref),
      service.read(ref, full),
      service.read(ref, { purpose: 'text-range' }),
      service.read(ref, { purpose: 'text-range', cursor: 10 })
    ])
    expect(service.getSnapshot(ref)).toEqual(ready('preview'))
    expect(service.getSnapshot(ref, full)).toEqual({ status: 'ready', purpose: 'full', output: 'full' })
    expect(service.getSnapshot(ref, { purpose: 'text-range' })).toEqual({
      status: 'ready',
      purpose: 'text-range',
      text: 'range:0',
      nextCursor: 10
    })
    expect(service.getSnapshot(ref, { purpose: 'text-range', cursor: 10 })).toEqual({
      status: 'ready',
      purpose: 'text-range',
      text: 'range:10',
      nextCursor: 20
    })
  })
})
