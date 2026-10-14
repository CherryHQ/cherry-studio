import { vi } from 'vitest'

export const mockTemporaryChatService = {
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
