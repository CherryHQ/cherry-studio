import { beforeEach, describe, expect, it, vi } from 'vitest'

const electronMock = vi.hoisted(() => ({
  app: { on: vi.fn(), off: vi.fn(), getPath: vi.fn(() => '/mock/path'), isPackaged: false, setAppLogsPath: vi.fn() },
  ipcMain: { handle: vi.fn(), on: vi.fn(), removeHandler: vi.fn(), removeListener: vi.fn() },
  utilityProcess: { fork: vi.fn() },
  MessageChannelMain: vi.fn()
}))
vi.mock('electron', () => electronMock)

const reachedManager = vi.hoisted(() => vi.fn())

vi.mock('@application', async () => {
  const { mockApplicationFactory } = await import('@test-mocks/main/application')
  const result = mockApplicationFactory()
  const originalGet = result.application.get.getMockImplementation()!
  result.application.get.mockImplementation((name: string) => {
    if (name === 'UtilityProcessManager') return reachedManager()
    return originalGet(name)
  })
  return result
})

vi.mock('../../installation/LocalModelStorageService', () => ({
  localModelStorageService: {
    resolveInstalledDir: () => '/models/local',
    isArtifactReady: () => true,
    isArtifactSupported: () => false,
    artifactPath: () => '/missing'
  }
}))

const { EmbeddingInferenceService } = await import('../../capabilities/embedding/EmbeddingInferenceService')
const { OcrInferenceService } = await import('../../capabilities/ocr/OcrInferenceService')
const embeddingInferenceService = new EmbeddingInferenceService()
const ocrInferenceService = new OcrInferenceService()

describe('InferenceService on a platform without onnxruntime-node', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('rejects embed without launching a process', async () => {
    await expect(embeddingInferenceService.embed(['hi'])).rejects.toThrow(/not supported.*onnxruntime-node/i)
    expect(reachedManager).not.toHaveBeenCalled()
  })

  it('rejects countTokens without launching a process', async () => {
    await expect(embeddingInferenceService.countTokens(['hi'])).rejects.toThrow(/not supported.*onnxruntime-node/i)
    expect(reachedManager).not.toHaveBeenCalled()
  })

  it('rejects recognize without launching a process', async () => {
    await expect(ocrInferenceService.recognize({ kind: 'path', imagePath: '/img.png' })).rejects.toThrow(
      /not supported.*onnxruntime-node/i
    )
    expect(reachedManager).not.toHaveBeenCalled()
  })
})
