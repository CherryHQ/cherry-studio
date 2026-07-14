import { beforeEach, describe, expect, it, vi } from 'vitest'

const { appGetMock, cleanupPdfMock, cancelPdfMock, ipcSendMock, openMock, translatePdfMock } = vi.hoisted(() => ({
  appGetMock: vi.fn(),
  cleanupPdfMock: vi.fn(),
  cancelPdfMock: vi.fn(),
  ipcSendMock: vi.fn(),
  openMock: vi.fn(),
  translatePdfMock: vi.fn()
}))
vi.mock('@application', () => ({ application: { get: appGetMock } }))
vi.mock('@main/services/translate/translateService', () => ({ translateService: { open: openMock } }))

import { translateHandlers } from '../translate'

const webContents = {}
const windowManager = { getWindow: vi.fn(() => ({ webContents })) }
const pdfTranslationService = { cancel: cancelPdfMock, cleanup: cleanupPdfMock, translate: translatePdfMock }
const req = { streamId: 'translate:1', text: 'hi', targetLangCode: 'en' } as Parameters<
  (typeof translateHandlers)['translate.open']
>[0]

beforeEach(() => {
  vi.clearAllMocks()
  appGetMock.mockImplementation((name: string) => {
    if (name === 'WindowManager') return windowManager
    if (name === 'PdfTranslationService') return pdfTranslationService
    if (name === 'IpcApiService') return { send: ipcSendMock }
    throw new Error(`Unexpected application.get(${name})`)
  })
})

describe('translateHandlers', () => {
  it('open resolves the caller WebContents and delegates to translateService', async () => {
    openMock.mockReturnValue({ streamId: 'translate:1' })
    expect(await translateHandlers['translate.open'](req, { senderId: 'w1' })).toEqual({ streamId: 'translate:1' })
    expect(windowManager.getWindow).toHaveBeenCalledWith('w1')
    expect(openMock).toHaveBeenCalledWith(webContents, req)
  })

  it('open throws when the caller is not a WindowManager-tracked window', async () => {
    await expect(translateHandlers['translate.open'](req, { senderId: null })).rejects.toThrow(
      'translate.open requires a managed window'
    )
  })

  it('starts PDF translation and sends progress only to the calling window', async () => {
    translatePdfMock.mockImplementation(async (_request, onStage, onProgress) => {
      onStage('preparing')
      onStage('translating')
      onProgress({ stage: 'translating', progress: 42 })
      return { fileName: 'paper.zh-CN.dual.pdf', outputPath: '/tmp/job/paper.zh-CN.dual.pdf' }
    })
    const request = {
      jobId: 'b289bad7-a813-4cf7-91c0-2a9dc82235b2',
      modelId: 'openai::gpt-4.1',
      sourcePath: '/tmp/paper.pdf',
      sourceLangCode: 'en-us',
      targetLangCode: 'zh-cn'
    } as const

    await expect(translateHandlers['translate.pdf.start'](request, { senderId: 'w1' })).resolves.toEqual({
      fileName: 'paper.zh-CN.dual.pdf',
      outputPath: '/tmp/job/paper.zh-CN.dual.pdf'
    })
    expect(ipcSendMock).toHaveBeenNthCalledWith(1, 'w1', 'translate.pdf.stage', {
      jobId: request.jobId,
      stage: 'preparing'
    })
    expect(ipcSendMock).toHaveBeenNthCalledWith(2, 'w1', 'translate.pdf.stage', {
      jobId: request.jobId,
      stage: 'translating'
    })
    expect(ipcSendMock).toHaveBeenNthCalledWith(3, 'w1', 'translate.pdf.progress', {
      jobId: request.jobId,
      stage: 'translating',
      progress: 42
    })
  })

  it('cancels and cleans up PDF translation jobs', async () => {
    const input = { jobId: 'b289bad7-a813-4cf7-91c0-2a9dc82235b2' }

    await translateHandlers['translate.pdf.cancel'](input, { senderId: 'w1' })
    await translateHandlers['translate.pdf.cleanup'](input, { senderId: 'w1' })

    expect(cancelPdfMock).toHaveBeenCalledWith(input.jobId)
    expect(cleanupPdfMock).toHaveBeenCalledWith(input.jobId)
  })

  it('rejects PDF job mutations from an unmanaged sender', async () => {
    const input = { jobId: 'b289bad7-a813-4cf7-91c0-2a9dc82235b2' }

    await expect(translateHandlers['translate.pdf.cancel'](input, { senderId: null })).rejects.toThrow(
      'translate.pdf.cancel requires a managed window'
    )
    await expect(translateHandlers['translate.pdf.cleanup'](input, { senderId: null })).rejects.toThrow(
      'translate.pdf.cleanup requires a managed window'
    )
    expect(cancelPdfMock).not.toHaveBeenCalled()
    expect(cleanupPdfMock).not.toHaveBeenCalled()
  })
})
