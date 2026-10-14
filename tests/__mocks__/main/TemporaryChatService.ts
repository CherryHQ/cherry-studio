import { vi } from 'vitest'

export const mockTemporaryChatService = {
  pause: vi.fn((_reason?: string) => ({ dispose: vi.fn() })),
  drainInFlight: vi.fn(
    async (_options: { timeoutMs: number }): Promise<{ stragglerIds: string[] }> => ({ stragglerIds: [] })
  ),
  onPersisted: vi.fn(() => ({ dispose: () => {} })),
  hasTopic: vi.fn(() => false),
  getTopic: vi.fn(),
  createTopic: vi.fn(),
  listMessages: vi.fn(() => []),
  appendMessage: vi.fn(),
  appendAssistantMessage: vi.fn(),
  deleteTopic: vi.fn(),
  persist: vi.fn(),
  beginTurn: vi.fn(() => new AbortController()),
  finishTurn: vi.fn(),
  storeGeneratedFile: vi.fn()
}
