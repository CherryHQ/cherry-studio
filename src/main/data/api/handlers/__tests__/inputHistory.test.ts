import { beforeEach, describe, expect, it, vi } from 'vitest'

const { listMock, saveMock } = vi.hoisted(() => ({
  listMock: vi.fn(),
  saveMock: vi.fn()
}))

vi.mock('@data/services/InputHistoryService', () => ({
  inputHistoryService: {
    list: listMock,
    save: saveMock
  }
}))

import { inputHistoryHandlers } from '../inputHistory'

describe('inputHistoryHandlers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('delegates GET to inputHistoryService.list', async () => {
    listMock.mockResolvedValueOnce([{ content: 'hello' }])

    await expect(inputHistoryHandlers['/input-history'].GET({} as never)).resolves.toMatchObject([{ content: 'hello' }])

    expect(listMock).toHaveBeenCalledOnce()
  })

  it('trims POST content before saving', async () => {
    saveMock.mockResolvedValueOnce({ content: 'hello' })

    await inputHistoryHandlers['/input-history'].POST({ body: { content: '  hello  ' } } as never)

    expect(saveMock).toHaveBeenCalledWith({ content: 'hello' })
  })

  it('rejects blank POST content before calling the service', async () => {
    await expect(
      inputHistoryHandlers['/input-history'].POST({ body: { content: '   ' } } as never)
    ).rejects.toHaveProperty('name', 'ZodError')

    expect(saveMock).not.toHaveBeenCalled()
  })
})
