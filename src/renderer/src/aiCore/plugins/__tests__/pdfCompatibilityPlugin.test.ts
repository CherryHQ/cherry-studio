import type { LanguageModelV3CallOptions } from '@ai-sdk/provider'
import type { Model, Provider, ProviderType } from '@renderer/types'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('i18next', () => ({
  default: { t: (key: string, opts?: Record<string, unknown>) => `${key}${opts ? JSON.stringify(opts) : ''}` }
}))

vi.mock('@renderer/config/models', () => ({
  isAnthropicModel: vi.fn(() => false),
  isGeminiModel: vi.fn(() => false)
}))

vi.mock('@renderer/config/models/openai', () => ({
  isOpenAILLMModel: vi.fn(() => false)
}))

const mockExtractPdfText = vi.fn()

vi.mock('@shared/utils/pdf', () => ({
  extractPdfText: (...args: unknown[]) => mockExtractPdfText(...args)
}))

vi.stubGlobal('window', {
  ...globalThis.window,
  api: {
    pdf: {
      extractText: mockExtractPdfText
    }
  },
  toast: {
    warning: vi.fn(),
    error: vi.fn()
  }
})

import { isAnthropicModel, isGeminiModel } from '@renderer/config/models'
import { isOpenAILLMModel } from '@renderer/config/models/openai'

import { createPdfCompatibilityPlugin } from '../pdfCompatibilityPlugin'

function makeProvider(id: string, type: ProviderType): Provider {
  return { id, name: id, type, apiKey: 'test', apiHost: 'https://test.com', isSystem: false, models: [] } as Provider
}

function makeModel(): Model {
  return { id: 'test-model', provider: 'test', name: 'Test', group: 'test' } as Model
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

async function runMiddleware(provider: Provider, params: LanguageModelV3CallOptions, model: Model = makeModel()) {
  const plugin = createPdfCompatibilityPlugin(provider, model)
  const context: {
    middlewares: Array<{ transformParams: (opts: Record<string, unknown>) => Promise<LanguageModelV3CallOptions> }>
  } = { middlewares: [] }
  void plugin.configureContext!(context as never)
  const middleware = context.middlewares[0]
  return middleware.transformParams({ params, type: 'generate', model: {} })
}

describe('pdfCompatibilityPlugin', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(isOpenAILLMModel).mockReturnValue(false)
    vi.mocked(isAnthropicModel).mockReturnValue(false)
    vi.mocked(isGeminiModel).mockReturnValue(false)
  })

  it('should pass through for OpenAI model on any provider type', async () => {
    vi.mocked(isOpenAILLMModel).mockReturnValue(true)
    const provider = makeProvider('moonshot', 'openai')

    const params = {
      prompt: [{ role: 'user' as const, content: [makeTextPart('Hello'), makePdfFilePart()] }]
    } as unknown as LanguageModelV3CallOptions

    const result = await runMiddleware(provider, params)
    expect(result).toEqual(params)
    expect(mockExtractPdfText).not.toHaveBeenCalled()
  })

  it('should pass through for Claude model on any provider type', async () => {
    vi.mocked(isAnthropicModel).mockReturnValue(true)
    const provider = makeProvider('my-aggregator', 'new-api')

    const params = {
      prompt: [{ role: 'user' as const, content: [makeTextPart('Hello'), makePdfFilePart()] }]
    } as unknown as LanguageModelV3CallOptions

    const result = await runMiddleware(provider, params)
    expect(result).toEqual(params)
    expect(mockExtractPdfText).not.toHaveBeenCalled()
  })

  it('should pass through for Gemini model on any provider type', async () => {
    vi.mocked(isGeminiModel).mockReturnValue(true)
    const provider = makeProvider('my-aggregator', 'new-api')

    const params = {
      prompt: [{ role: 'user' as const, content: [makeTextPart('Hello'), makePdfFilePart()] }]
    } as unknown as LanguageModelV3CallOptions

    const result = await runMiddleware(provider, params)
    expect(result).toEqual(params)
    expect(mockExtractPdfText).not.toHaveBeenCalled()
  })

  it('should pass through unchanged when provider type supports native PDF (openai-response)', async () => {
    const provider = makeProvider('openai', 'openai-response')

    const params = {
      prompt: [{ role: 'user' as const, content: [makeTextPart('Hello'), makePdfFilePart()] }]
    } as unknown as LanguageModelV3CallOptions

    const result = await runMiddleware(provider, params)
    expect(result).toEqual(params)
    expect(mockExtractPdfText).not.toHaveBeenCalled()
  })

  it('should convert PDF for non-native provider types (new-api, gateway, openai)', async () => {
    const provider = makeProvider('moonshot', 'openai')
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
