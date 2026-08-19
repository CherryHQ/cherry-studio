import i18n from '@renderer/i18n/resolver'
import { toast } from '@renderer/services/toast'
import {
  ConversationBlockReason,
  ConversationKind,
  ConversationOpenMode,
  ConversationOpenTrigger
} from '@shared/ai/conversation'
import type { AiStreamOpenRequest, AiStreamOpenResponse } from '@shared/ai/transport'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { streamDispatchService } from '../StreamDispatchService'

const TOPIC = 'topic-1'
const CONVERSATION = { kind: ConversationKind.Chat, id: TOPIC } as const
const req: AiStreamOpenRequest = {
  trigger: ConversationOpenTrigger.SubmitMessage,
  conversation: CONVERSATION,
  userMessageParts: []
}

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
      mode: ConversationOpenMode.Started
    }
    streamOpen.mockResolvedValue(ack)
    const seen: unknown[] = []
    const off = streamDispatchService.subscribe(CONVERSATION, (r) => seen.push(r))

    streamDispatchService.dispatch(req)
    await flush()

    expect(streamOpen).toHaveBeenCalledWith(req)
    expect(seen).toEqual([{ ok: true, conversation: CONVERSATION, ack }])
    off()
  })

  it('routes a rejected dispatch as an error result', async () => {
    streamOpen.mockRejectedValue(new Error('ipc boom'))
    const seen: Array<{ ok: boolean }> = []
    const off = streamDispatchService.subscribe(CONVERSATION, (r) => seen.push(r))

    streamDispatchService.dispatch(req)
    await flush()

    expect(seen).toHaveLength(1)
    expect(seen[0]).toMatchObject({ ok: false, conversation: CONVERSATION })
    expect(toast.error).not.toHaveBeenCalled()
    off()
  })

  it('shows workspace dispatch failures as toast', async () => {
    streamOpen.mockResolvedValue({
      mode: ConversationOpenMode.Blocked,
      reason: ConversationBlockReason.AgentSessionWorkspace,
      message: 'Workspace path for session session-1 is not accessible: /missing'
    } satisfies AiStreamOpenResponse)

    streamDispatchService.dispatch(req)
    await flush()

    expect(toast.error).toHaveBeenCalledWith('Workspace path for session session-1 is not accessible: /missing')
  })

  it('localizes paused dispatch failures from their reason', async () => {
    streamOpen.mockResolvedValue({
      mode: ConversationOpenMode.Blocked,
      reason: ConversationBlockReason.Paused
    } satisfies AiStreamOpenResponse)

    streamDispatchService.dispatch(req)
    await flush()

    expect(toast.error).toHaveBeenCalledWith(i18n.t('restore.messages_paused'))
  })

  it('unsubscribe stops further delivery', async () => {
    streamOpen.mockResolvedValue({ mode: ConversationOpenMode.Started })
    const seen: unknown[] = []
    const off = streamDispatchService.subscribe(CONVERSATION, (r) => seen.push(r))
    off()
    streamDispatchService.dispatch(req)
    await flush()
    expect(seen).toHaveLength(0)
  })
})
