/**
 * Regression for params-features-1: an OpenAI Responses provider resolves to the
 * base aiSdkProviderId `openai` (not the dead literal `openai-responses`), so native
 * PDF FileParts must be passed through untouched instead of being downgraded to text.
 */

import type { LanguageModelV3Message } from '@ai-sdk/provider'
import { describe, expect, it, vi } from 'vitest'

import { makeModel } from '../../../../../__tests__/fixtures/model'
import { makeProvider } from '../../../../../__tests__/fixtures/provider'
import type { AppProviderId } from '../../../../../types'
import { pdfCompatibilityFeature } from '../pdfCompatibility'

// extractPdfText only runs on the downgrade path; mock it so the negative case is observable.
vi.mock('@shared/utils/pdf', () => ({
  extractPdfText: vi.fn(async () => 'EXTRACTED TEXT')
}))

type Middleware = { transformParams: (args: { params: any }) => Promise<any> }

function getMiddleware(aiSdkProviderId: AppProviderId): Middleware {
  const provider = makeProvider({ id: 'openai' })
  const model = makeModel({ id: 'openai::gpt-4o', apiModelId: 'gpt-4o', name: 'gpt-4o' })
  const plugins = pdfCompatibilityFeature.contributeModelAdapters!({
    provider,
    model,
    aiSdkProviderId
  } as never)
  const ctx: { middlewares?: unknown[] } = {}
  const plugin = plugins[0] as unknown as { configureContext: (c: typeof ctx) => void }
  plugin.configureContext(ctx)
  return (ctx.middlewares as Middleware[])[0]
}

const pdfMessage: LanguageModelV3Message = {
  role: 'user',
  content: [{ type: 'file', mediaType: 'application/pdf', data: 'base64', filename: 'doc.pdf' } as never]
}

describe('pdfCompatibility middleware — openai native PDF', () => {
  it('passes native PDF parts through for an OpenAI Responses provider (aiSdkProviderId "openai")', async () => {
    const middleware = getMiddleware('openai')
    const result = await middleware.transformParams({ params: { prompt: [pdfMessage] } })

    // Unchanged: the FilePart is preserved, not converted to a TextPart.
    expect(result.prompt[0].content[0].type).toBe('file')
  })

  it('downgrades native PDF parts to text for an openai-compatible provider', async () => {
    const middleware = getMiddleware('openai-compatible')
    const result = await middleware.transformParams({ params: { prompt: [pdfMessage] } })

    // Converted: aggregator/openai-compatible backends may reject file parts.
    expect(result.prompt[0].content[0].type).toBe('text')
  })
})
