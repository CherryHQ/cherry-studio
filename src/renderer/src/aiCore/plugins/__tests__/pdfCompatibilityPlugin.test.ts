import type { LanguageModelV3CallOptions } from '@ai-sdk/provider'
import type { Provider, ProviderType } from '@renderer/types'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('i18next', () => ({
  default: { t: (key: string, opts?: Record<string, unknown>) => `${key}${opts ? JSON.stringify(opts) : ''}` }
}))

vi.mock('@shared/utils/pdf', () => ({
  extractPdfText: vi.fn()
}))

import { extractPdfText } from '@shared/utils/pdf'

import { createPdfCompatibilityPlugin } from '../pdfCompatibilityPlugin'

const mockExtractPdfText = vi.mocked(extractPdfText)

vi.stubGlobal('window', {
  ...globalThis.window,
  toast: {
    warning: vi.fn(),
    error: vi.fn()
  }
})

function makeProvider(id: string, type: ProviderType): Provider {
  return { id, name: id, type, apiKey: 'test', apiHost: 'https://test.com', isSystem: false, models: [] } as Provider
}

function makePdfFilePart(filename = 'test.pdf') {
  return {
    type: 'file' as const,
    data: 'base64pdfdata',
    mediaType: 'application/pdf',
    filename
  }
}

function makeImageFilePart() {
  return {
    type: 'file' as const,
    data: 'base64imgdata',
    mediaType: 'image/png',
    filename: 'test.png'
  }
}

function makeTextPart(text: string) {
  return { type: 'text' as const, text }
}

async function runMiddleware(provider: Provider, params: LanguageModelV3CallOptions) {
  const plugin = createPdfCompatibilityPlugin(provider)
  const context: {
    middlewares: Array<{ transformParams: (opts: Record<string, unknown>) => Promise<LanguageModelV3CallOptions> }>
  } = { middlewares: [] }
  plugin.configureContext!(context as never)
  const middleware = context.middlewares[0]
  return middleware.transformParams({ params, type: 'generate', model: {} })
}

describe('pdfCompatibilityPlugin', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should pass through unchanged when provider type supports native PDF (openai)', async () => {
    const provider = makeProvider('openai', 'openai')

    const params = {
      prompt: [{ role: 'user' as const, content: [makeTextPart('Hello'), makePdfFilePart()] }]
    } as unknown as LanguageModelV3CallOptions

    const result = await runMiddleware(provider, params)
    expect(result).toEqual(params)
    expect(mockExtractPdfText).not.toHaveBeenCalled()
  })

  it('should pass through unchanged for aggregator providers with openai type (cherryin)', async () => {
    const provider = makeProvider('cherryin', 'openai')

    const params = {
      prompt: [{ role: 'user' as const, content: [makeTextPart('Hello'), makePdfFilePart()] }]
    } as unknown as LanguageModelV3CallOptions

    const result = await runMiddleware(provider, params)
    expect(result).toEqual(params)
    expect(mockExtractPdfText).not.toHaveBeenCalled()
  })

  it('should pass through unchanged for new-api type providers', async () => {
    const provider = makeProvider('my-aggregator', 'new-api')

    const params = {
      prompt: [{ role: 'user' as const, content: [makeTextPart('Hello'), makePdfFilePart()] }]
    } as unknown as LanguageModelV3CallOptions

    const result = await runMiddleware(provider, params)
    expect(result).toEqual(params)
    expect(mockExtractPdfText).not.toHaveBeenCalled()
  })

  it('should convert PDF FilePart to TextPart for ollama provider', async () => {
    const provider = makeProvider('ollama', 'ollama')
    mockExtractPdfText.mockResolvedValue('Extracted PDF content')

    const params = {
      prompt: [{ role: 'user' as const, content: [makeTextPart('Hello'), makePdfFilePart('report.pdf')] }]
    } as unknown as LanguageModelV3CallOptions

    const result = await runMiddleware(provider, params)
    expect(mockExtractPdfText).toHaveBeenCalledWith('base64pdfdata')
    expect(result.prompt[0]).toMatchObject({
      role: 'user',
      content: [
        { type: 'text', text: 'Hello' },
        { type: 'text', text: 'report.pdf\nExtracted PDF content' }
      ]
    })
  })

  it('should drop PDF part and warn when text extraction fails', async () => {
    const provider = makeProvider('ollama', 'ollama')
    mockExtractPdfText.mockRejectedValue(new Error('parse failed'))

    const params = {
      prompt: [{ role: 'user' as const, content: [makeTextPart('Hello'), makePdfFilePart('broken.pdf')] }]
    } as unknown as LanguageModelV3CallOptions

    const result = await runMiddleware(provider, params)
    expect(result.prompt[0]).toMatchObject({
      role: 'user',
      content: [{ type: 'text', text: 'Hello' }]
    })
    expect(window.toast.warning).toHaveBeenCalled()
  })

  it('should not convert non-PDF FileParts', async () => {
    const provider = makeProvider('ollama', 'ollama')

    const imagePart = makeImageFilePart()
    const params = {
      prompt: [{ role: 'user' as const, content: [makeTextPart('Hello'), imagePart] }]
    } as unknown as LanguageModelV3CallOptions

    const result = await runMiddleware(provider, params)
    expect(result.prompt[0]).toMatchObject({
      role: 'user',
      content: [{ type: 'text', text: 'Hello' }, imagePart]
    })
    expect(mockExtractPdfText).not.toHaveBeenCalled()
  })

  it('should handle mixed content: text + PDF + image — only PDF converted', async () => {
    const provider = makeProvider('ollama', 'ollama')
    mockExtractPdfText.mockResolvedValue('PDF text content')

    const imagePart = makeImageFilePart()
    const params = {
      prompt: [{ role: 'user' as const, content: [makeTextPart('Analyze'), makePdfFilePart('doc.pdf'), imagePart] }]
    } as unknown as LanguageModelV3CallOptions

    const result = await runMiddleware(provider, params)
    expect(result.prompt[0]).toMatchObject({
      role: 'user',
      content: [{ type: 'text', text: 'Analyze' }, { type: 'text', text: 'doc.pdf\nPDF text content' }, imagePart]
    })
  })

  it('should pass through when prompt is empty', async () => {
    const provider = makeProvider('ollama', 'ollama')
    const params = { prompt: [] } as unknown as LanguageModelV3CallOptions
    const result = await runMiddleware(provider, params)
    expect(result).toEqual(params)
  })

  it('should pass through messages with string content (system messages)', async () => {
    const provider = makeProvider('ollama', 'ollama')
    const params = {
      prompt: [{ role: 'system' as const, content: 'You are a helpful assistant' }]
    } as unknown as LanguageModelV3CallOptions

    const result = await runMiddleware(provider, params)
    expect(result.prompt[0]).toMatchObject({ role: 'system', content: 'You are a helpful assistant' })
  })
})
