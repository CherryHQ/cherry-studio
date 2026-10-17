import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import i18n from '@renderer/i18n/resolver'
import { toast } from '@renderer/services/toast'
import type { AiStreamOpenRequest, AiStreamOpenResponse } from '@shared/ai/transport'

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

let previousLanguage: string

beforeEach(async () => {
  previousLanguage = i18n.language
  await i18n.changeLanguage('zh-CN')
})

afterEach(async () => {
  vi.clearAllMocks()
  await i18n.changeLanguage(previousLanguage)
})

const flush = () => new Promise((r) => setTimeout(r, 0))

describe('StreamDispatchService', () => {
  it('routes a resolved ack to subscribers', async () => {
    const ack: AiStreamOpenResponse = {
      mode: 'started'
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

  it.each([
    ['backup', '正在备份；完成前已暂停发送新消息。'],
    ['restore', '正在恢复备份；完成前已暂停发送新消息。']
  ] as const)('localizes paused dispatch failures for %s', async (operation, message) => {
    streamOpen.mockResolvedValue({
      mode: 'blocked',
      reason: 'paused',
      operation
    } satisfies AiStreamOpenResponse)

    streamDispatchService.dispatch(TOPIC, req)
    await flush()

    expect(toast.error).toHaveBeenCalledWith(message)
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
