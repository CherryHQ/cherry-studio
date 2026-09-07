import { beforeEach, describe, expect, it, vi } from 'vitest'

import { fetchGenerate, fetchMessagesSummary, fetchNoteSummary } from '../aiGeneration'

// Stand-in Model — only `.id` reaches the request; nothing else is inspected.
const TEST_MODEL = { id: 'quick-model', provider: 'test-provider' }

const { generateTextMock, ipcRequestMock } = vi.hoisted(() => ({
  generateTextMock:
    vi.fn<
      (args: {
        requestId?: string
        uniqueModelId: string
        reasoningEffort?: string
        system?: string
        prompt?: string
      }) => Promise<{ text: string }>
    >(),
  ipcRequestMock: vi.fn()
}))
vi.mock('@renderer/ipc', () => ({
  ipcApi: { request: (route: string, input: any) => ipcRequestMock(route, input) }
}))

const { readQuickModelMock, readDefaultModelMock } = vi.hoisted(() => ({
  readQuickModelMock: vi.fn(),
  readDefaultModelMock: vi.fn()
}))
vi.mock('@renderer/utils/model', () => ({
  readQuickModel: () => readQuickModelMock(),
  readDefaultModel: () => readDefaultModelMock()
}))

vi.mock('@renderer/i18n/resolver', () => ({
  default: { t: (key: string) => key }
}))

beforeEach(() => {
  vi.clearAllMocks()
  generateTextMock.mockResolvedValue({ text: 'A title' })
  ipcRequestMock.mockImplementation((route: string, input: any) => {
    if (route === 'ai.text.generate') return generateTextMock(input)
    if (route === 'ai.text.abort') return Promise.resolve(undefined)
    throw new Error(`Unexpected route: ${route}`)
  })
  readQuickModelMock.mockResolvedValue(TEST_MODEL)
  readDefaultModelMock.mockResolvedValue(TEST_MODEL)
})

describe('aiGeneration reasoning opt-out', () => {
  it('fetchMessagesSummary disables reasoning on the naming request', async () => {
    await fetchMessagesSummary({ messages: [{ role: 'user', parts: [] } as never] })

    expect(generateTextMock).toHaveBeenCalledWith(
      expect.objectContaining({ uniqueModelId: TEST_MODEL.id, reasoningEffort: 'none' })
    )
  })

  it('fetchNoteSummary disables reasoning on the naming request', async () => {
    expect(await fetchNoteSummary({ content: 'note body' })).toBe('A title')

    expect(generateTextMock).toHaveBeenCalledWith(
      expect.objectContaining({ uniqueModelId: TEST_MODEL.id, reasoningEffort: 'none' })
    )
  })

  it('fetchGenerate disables reasoning on the generation request', async () => {
    await fetchGenerate({ prompt: 'system prompt', content: 'user content' })

    expect(generateTextMock).toHaveBeenCalledWith(
      expect.objectContaining({ uniqueModelId: TEST_MODEL.id, reasoningEffort: 'none' })
    )
  })
})

describe('fetchGenerate cancellation', () => {
  it('settles locally on abort and pairs ai.text.abort with the same request id', async () => {
    generateTextMock.mockImplementationOnce(() => new Promise(() => undefined))
    const controller = new AbortController()
    const result = fetchGenerate({
      prompt: 'system prompt',
      content: 'user content',
      signal: controller.signal,
      throwOnError: true
    }).catch((error) => error)

    await vi.waitFor(() => expect(generateTextMock).toHaveBeenCalledTimes(1))
    const requestId = generateTextMock.mock.calls[0][0].requestId
    expect(requestId).toEqual(expect.any(String))

    const reason = new DOMException('cancelled', 'AbortError')
    controller.abort(reason)

    await expect(result).resolves.toBe(reason)
    expect(ipcRequestMock).toHaveBeenCalledWith('ai.text.abort', { requestId })
  })

  it('keeps legacy callers on the existing request shape when no signal is supplied', async () => {
    await fetchGenerate({ prompt: 'system prompt', content: 'user content' })

    expect(generateTextMock.mock.calls[0][0]).not.toHaveProperty('requestId')
    expect(ipcRequestMock).not.toHaveBeenCalledWith('ai.text.abort', expect.anything())
  })
})
