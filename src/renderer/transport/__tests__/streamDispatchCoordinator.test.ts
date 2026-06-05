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
      placeholderIds: ['a-1', 'a-2']
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
