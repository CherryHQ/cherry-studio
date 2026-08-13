import i18n from '@renderer/i18n/resolver'
import { toast } from '@renderer/services/toast'
import type { AiStreamOpenRequest, AiStreamOpenResponse } from '@shared/ai/transport'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { streamDispatchService } from '../StreamDispatchService'

const TOPIC = 'topic-1'
const req: AiStreamOpenRequest = { trigger: 'submit-message', topicId: TOPIC, userMessageParts: [] }

// `streamOpen` backs the `ai.stream.open` route on the mocked ipcApi (hoisted so the
// vi.mock factory can reference it).
const { streamOpen } = vi.hoisted(() => ({ streamOpen: vi.fn() }))
vi.mock('@renderer/ipc', () => ({
  ipcApi: {
    request: (route: string, input: unknown) =>
      route === 'ai.stream.open' ? streamOpen(input) : Promise.resolve(undefined),
    on: () => () => {}
  }
}))

afterEach(() => {
  vi.clearAllMocks()
})

const flush = () => new Promise((r) => setTimeout(r, 0))

describe('StreamDispatchService', () => {
  it('routes a resolved ack to subscribers', async () => {
    const ack: AiStreamOpenResponse = {
      mode: 'started',
      userMessageId: 'u-1'
    }
    streamOpen.mockResolvedValue(ack)
    const seen: unknown[] = []
    const off = streamDispatchService.subscribe(TOPIC, (r) => seen.push(r))

    streamDispatchService.dispatch(TOPIC, req)
    await flush()

    expect(streamOpen).toHaveBeenCalledWith(req)
    expect(seen).toEqual([{ ok: true, topicId: TOPIC, ack }])
    off()
  })

  it('routes a rejected dispatch as an error result', async () => {
    streamOpen.mockRejectedValue(new Error('ipc boom'))
    const seen: Array<{ ok: boolean }> = []
    const off = streamDispatchService.subscribe(TOPIC, (r) => seen.push(r))

    streamDispatchService.dispatch(TOPIC, req)
    await flush()

    expect(seen).toHaveLength(1)
    expect(seen[0]).toMatchObject({ ok: false, topicId: TOPIC })
    expect(toast.error).not.toHaveBeenCalled()
    off()
  })

  it('shows workspace dispatch failures as toast', async () => {
    streamOpen.mockResolvedValue({
      mode: 'blocked',
      reason: 'agent-session-workspace',
      message: 'Workspace path for session session-1 is not accessible: /missing'
    } satisfies AiStreamOpenResponse)

    streamDispatchService.dispatch(TOPIC, req)
    await flush()

    expect(toast.error).toHaveBeenCalledWith('Workspace path for session session-1 is not accessible: /missing')
  })

  it('localizes paused dispatch failures from their reason', async () => {
    streamOpen.mockResolvedValue({
      mode: 'blocked',
      reason: 'paused'
    } satisfies AiStreamOpenResponse)

    streamDispatchService.dispatch(TOPIC, req)
    await flush()

    expect(toast.error).toHaveBeenCalledWith(i18n.t('restore.messages_paused'))
  })

  it('unsubscribe stops further delivery', async () => {
    streamOpen.mockResolvedValue({ mode: 'started' })
    const seen: unknown[] = []
    const off = streamDispatchService.subscribe(TOPIC, (r) => seen.push(r))
    off()
    streamDispatchService.dispatch(TOPIC, req)
    await flush()
    expect(seen).toHaveLength(0)
  })
})
