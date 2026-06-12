import type { AiStreamOpenRequest, AiStreamOpenResponse } from '@shared/ai/transport'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { streamDispatchCoordinator } from '../streamDispatchCoordinator'

const TOPIC = 'topic-1'
const req: AiStreamOpenRequest = { trigger: 'submit-message', topicId: TOPIC, userMessageParts: [] }

let streamOpen: ReturnType<typeof vi.fn>
let originalApi: unknown
let originalToast: unknown

beforeEach(() => {
  streamOpen = vi.fn()
  originalApi = (window as unknown as { api: unknown }).api
  originalToast = (window as unknown as { toast: unknown }).toast
  ;(window as unknown as { api: unknown }).api = { ...(originalApi as object), ai: { streamOpen } }
  ;(window as unknown as { toast: unknown }).toast = { error: vi.fn() }
})
afterEach(() => {
  ;(window as unknown as { api: unknown }).api = originalApi
  ;(window as unknown as { toast: unknown }).toast = originalToast
  vi.clearAllMocks()
})

const flush = () => new Promise((r) => setTimeout(r, 0))

describe('streamDispatchCoordinator', () => {
  it('routes a resolved ack to subscribers', async () => {
    const ack: AiStreamOpenResponse = {
      mode: 'started',
      userMessageId: 'u-1',
      reservedMessages: [
        {
          id: 'u-1',
          role: 'user',
          parts: [{ type: 'text', text: 'hello' }],
          metadata: { status: 'success', createdAt: '2026-05-23T00:00:00.000Z' }
        },
        {
          id: 'a-1',
          role: 'assistant',
          parts: [],
          metadata: {
            status: 'pending',
            createdAt: '2026-05-23T00:00:00.001Z',
            modelId: 'openai:gpt-4o',
            modelSnapshot: { id: 'gpt-4o', name: 'GPT-4o', provider: 'openai' }
          }
        },
        {
          id: 'a-2',
          role: 'assistant',
          parts: [],
          metadata: {
            status: 'pending',
            createdAt: '2026-05-23T00:00:00.002Z',
            modelId: 'anthropic:claude-3-5-sonnet',
            modelSnapshot: { id: 'claude-3-5-sonnet', name: 'Claude 3.5 Sonnet', provider: 'anthropic' }
          }
        }
      ]
    }
    streamOpen.mockResolvedValue(ack)
    const seen: unknown[] = []
    const off = streamDispatchCoordinator.subscribe(TOPIC, (r) => seen.push(r))

    streamDispatchCoordinator.dispatch(TOPIC, req)
    await flush()

    expect(streamOpen).toHaveBeenCalledWith(req)
    expect(seen).toEqual([{ ok: true, topicId: TOPIC, ack }])
    off()
  })

  it('routes a rejected dispatch as an error result', async () => {
    streamOpen.mockRejectedValue(new Error('ipc boom'))
    const seen: Array<{ ok: boolean }> = []
    const off = streamDispatchCoordinator.subscribe(TOPIC, (r) => seen.push(r))

    streamDispatchCoordinator.dispatch(TOPIC, req)
    await flush()

    expect(seen).toHaveLength(1)
    expect(seen[0]).toMatchObject({ ok: false, topicId: TOPIC })
    expect(window.toast.error).not.toHaveBeenCalled()
    off()
  })

  it('shows workspace dispatch failures as toast', async () => {
    streamOpen.mockResolvedValue({
      mode: 'blocked',
      reason: 'agent-session-workspace',
      message: 'Workspace path for session session-1 is not accessible: /missing'
    } satisfies AiStreamOpenResponse)

    streamDispatchCoordinator.dispatch(TOPIC, req)
    await flush()

    expect(window.toast.error).toHaveBeenCalledWith('Workspace path for session session-1 is not accessible: /missing')
  })

  it('unsubscribe stops further delivery', async () => {
    streamOpen.mockResolvedValue({ mode: 'started' })
    const seen: unknown[] = []
    const off = streamDispatchCoordinator.subscribe(TOPIC, (r) => seen.push(r))
    off()
    streamDispatchCoordinator.dispatch(TOPIC, req)
    await flush()
    expect(seen).toHaveLength(0)
  })
})
