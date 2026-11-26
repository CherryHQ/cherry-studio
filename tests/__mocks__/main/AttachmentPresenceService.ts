import { vi } from 'vitest'

export const mockAttachmentPresenceService = {
  connection: vi.fn().mockReturnValue(1),
  disconnect: vi.fn(),
  present: vi.fn().mockReturnValue({ accepted: true }),
  submitting: vi.fn(),
  owners: vi.fn().mockReturnValue([]),
  cancelOwner: vi.fn(),
  list: vi.fn().mockResolvedValue([])
}
