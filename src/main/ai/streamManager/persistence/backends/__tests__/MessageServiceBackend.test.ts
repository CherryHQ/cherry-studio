import type { CherryUIMessage, MessageSnapshot } from '@shared/data/types/message'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const updateMock = vi.fn()
vi.mock('@main/data/services/MessageService', () => ({
  messageService: { update: updateMock }
}))

const { MessageServiceBackend } = await import('../MessageServiceBackend')

const MESSAGE_ID = 'assistant-1'

function finalMessage(text = 'done'): CherryUIMessage {
  return { id: 'final', role: 'assistant', parts: [{ type: 'text', text }] } as CherryUIMessage
}

const SNAPSHOT: MessageSnapshot = {
  id: 'a1',
  name: 'Assistant',
  emoji: '🤖',
  model: { id: 'gpt-5', name: 'GPT-5', provider: 'openai' }
}

beforeEach(() => updateMock.mockReset())

describe('MessageServiceBackend.persistAssistant', () => {
  // Regression: the continue path computes `anchor.messageSnapshot ?? fallback` and hands it to the
  // backend, so the terminal write must persist it — otherwise a resumed null-snapshot row finishes
  // snapshot-less and the author-first header can't recover the producing assistant/model.
  it('persists the author snapshot on finalize — backfills a continued null-snapshot row', () => {
    const backend = new MessageServiceBackend({ assistantMessageId: MESSAGE_ID, messageSnapshot: SNAPSHOT })
    backend.persistAssistant({ status: 'success', finalMessage: finalMessage() })

    expect(updateMock).toHaveBeenCalledTimes(1)
    const [id, dto] = updateMock.mock.calls[0]
    expect(id).toBe(MESSAGE_ID)
    expect(dto.status).toBe('success')
    expect(dto.messageSnapshot).toEqual(SNAPSHOT)
  })

  it('omits messageSnapshot when none was resolved, so it never clobbers an existing row snapshot', () => {
    const backend = new MessageServiceBackend({ assistantMessageId: MESSAGE_ID })
    backend.persistAssistant({ status: 'success', finalMessage: finalMessage() })

    const [, dto] = updateMock.mock.calls[0]
    expect('messageSnapshot' in dto).toBe(false)
  })
})
