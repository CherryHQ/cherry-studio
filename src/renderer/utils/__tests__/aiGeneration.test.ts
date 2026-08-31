import { beforeEach, describe, expect, it, vi } from 'vitest'

import { fetchGenerate, fetchMessagesSummary, fetchNoteSummary } from '../aiGeneration'

// Stand-in Model — only `.id` reaches the request; nothing else is inspected.
const TEST_MODEL = { id: 'quick-model', provider: 'test-provider' }

// All three helpers go through ipcApi.request('ai.text.generate', …). Tests drive
// the response and assert the request contract (reasoning must stay disabled).
const { generateTextMock } = vi.hoisted(() => ({
  generateTextMock:
    vi.fn<
      (args: {
        uniqueModelId: string
        reasoningEffort?: string
        system?: string
        prompt?: string
      }) => Promise<{ text: string }>
    >()
}))
vi.mock('@renderer/ipc', () => ({
  ipcApi: { request: (_route: string, input: any) => generateTextMock(input) }
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

describe('aiGeneration reasoning opt-out', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    generateTextMock.mockResolvedValue({ text: 'A title' })
    readQuickModelMock.mockResolvedValue(TEST_MODEL)
    readDefaultModelMock.mockResolvedValue(TEST_MODEL)
  })

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
