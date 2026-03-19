import type { LanguageModelV3CallOptions } from '@ai-sdk/provider'
import type { Provider } from '@renderer/types'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// Mock dependencies
vi.mock('i18next', () => ({
  default: { t: (key: string, opts?: any) => `${key}${opts ? JSON.stringify(opts) : ''}` }
}))

vi.mock('../../provider/factory', () => ({
  getAiSdkProviderId: vi.fn()
}))

vi.mock('../../prepareParams/modelCapabilities', () => ({
  PDF_NATIVE_PROVIDER_IDS: new Set([
    'openai',
    'azure-openai',
    'anthropic',
    'google',
    'google-generative-ai',
    'google-vertex',
    'bedrock',
    'amazon-bedrock'
  ])
}))

// Must import after mocks
import { getAiSdkProviderId } from '../../provider/factory'
import { createPdfCompatibilityPlugin } from '../pdfCompatibilityPlugin'

const mockGetAiSdkProviderId = vi.mocked(getAiSdkProviderId)

// Mock window.toast
vi.stubGlobal('window', {
  ...globalThis.window,
  toast: {
    warning: vi.fn(),
    error: vi.fn()
  }
})

function makeProvider(id: string): Provider {
  return { id, name: id, apiKey: 'test', apiHost: 'https://test.com', isSystem: false } as Provider
}

function makePdfFilePart(pdfTextContent?: string) {
  return {
    type: 'file' as const,
    data: 'base64pdfdata',
    mediaType: 'application/pdf',
    filename: 'test.pdf',
    providerOptions: pdfTextContent ? { cherryStudio: { pdfTextContent } } : undefined
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
  // Extract the middleware from the plugin
  const context: any = { middlewares: [] }
  plugin.configureContext!(context)
  const middleware = context.middlewares[0]
  return middleware.transformParams({ params, type: 'generate', model: {} })
}

describe('pdfCompatibilityPlugin', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should pass through unchanged when provider supports native PDF', async () => {
    const provider = makeProvider('openai')
    mockGetAiSdkProviderId.mockReturnValue('openai')

    const params = {
      prompt: [
        {
          role: 'user' as const,
          content: [makeTextPart('Hello'), makePdfFilePart('extracted text')]
        }
      ]
    } as unknown as LanguageModelV3CallOptions

    const result = await runMiddleware(provider, params)
    expect(result).toEqual(params)
  })

  it('should convert PDF FilePart to TextPart when provider does NOT support native PDF', async () => {
    const provider = makeProvider('custom-provider')
    mockGetAiSdkProviderId.mockReturnValue('custom-openai')

    const params = {
      prompt: [
        {
          role: 'user' as const,
          content: [makeTextPart('Hello'), makePdfFilePart('file.pdf\nExtracted PDF content')]
        }
      ]
    } as unknown as LanguageModelV3CallOptions

    const result = await runMiddleware(provider, params)
    expect(result.prompt[0]).toMatchObject({
      role: 'user',
      content: [
        { type: 'text', text: 'Hello' },
        { type: 'text', text: 'file.pdf\nExtracted PDF content' }
      ]
    })
  })

  it('should drop PDF part and warn when no pre-extracted text is available', async () => {
    const provider = makeProvider('custom-provider')
    mockGetAiSdkProviderId.mockReturnValue('custom-openai')

    const params = {
      prompt: [
        {
          role: 'user' as const,
          content: [makeTextPart('Hello'), makePdfFilePart()] // no pdfTextContent
        }
      ]
    } as unknown as LanguageModelV3CallOptions

    const result = await runMiddleware(provider, params)
    expect(result.prompt[0]).toMatchObject({
      role: 'user',
      content: [{ type: 'text', text: 'Hello' }]
    })
    expect(window.toast.warning).toHaveBeenCalled()
  })

  it('should not convert non-PDF FileParts', async () => {
    const provider = makeProvider('custom-provider')
    mockGetAiSdkProviderId.mockReturnValue('custom-openai')

    const imagePart = makeImageFilePart()
    const params = {
      prompt: [
        {
          role: 'user' as const,
          content: [makeTextPart('Hello'), imagePart]
        }
      ]
    } as unknown as LanguageModelV3CallOptions

    const result = await runMiddleware(provider, params)
    expect(result.prompt[0]).toMatchObject({
      role: 'user',
      content: [{ type: 'text', text: 'Hello' }, imagePart]
    })
  })

  it('should handle mixed content: text + PDF + image — only PDF converted', async () => {
    const provider = makeProvider('custom-provider')
    mockGetAiSdkProviderId.mockReturnValue('custom-openai')

    const imagePart = makeImageFilePart()
    const params = {
      prompt: [
        {
          role: 'user' as const,
          content: [makeTextPart('Analyze these'), makePdfFilePart('doc.pdf\nPDF text content'), imagePart]
        }
      ]
    } as unknown as LanguageModelV3CallOptions

    const result = await runMiddleware(provider, params)
    expect(result.prompt[0]).toMatchObject({
      role: 'user',
      content: [{ type: 'text', text: 'Analyze these' }, { type: 'text', text: 'doc.pdf\nPDF text content' }, imagePart]
    })
  })

  it('should pass through when prompt is empty', async () => {
    const provider = makeProvider('custom-provider')
    mockGetAiSdkProviderId.mockReturnValue('custom-openai')

    const params = { prompt: [] } as unknown as LanguageModelV3CallOptions
    const result = await runMiddleware(provider, params)
    expect(result).toEqual(params)
  })

  it('should pass through messages with string content (system messages)', async () => {
    const provider = makeProvider('custom-provider')
    mockGetAiSdkProviderId.mockReturnValue('custom-openai')

    const params = {
      prompt: [{ role: 'system' as const, content: 'You are a helpful assistant' }]
    } as unknown as LanguageModelV3CallOptions

    const result = await runMiddleware(provider, params)
    expect(result.prompt[0]).toMatchObject({
      role: 'system',
      content: 'You are a helpful assistant'
    })
  })
})
