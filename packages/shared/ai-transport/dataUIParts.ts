/**
 * Cherry Studio custom DataUIPart type mappings.
 *
 * These types define the payload shapes for Cherry Studio's custom block types,
 * carried via AI SDK's DataUIPart extension mechanism.
 *
 * Consumed by T3 (useAiChat hook) as the CherryUIMessage generic parameter.
 */
export interface CherryDataUIParts extends Record<string, unknown> {
  citation: {
    type: 'web' | 'knowledge' | 'memory'
    sources: Array<{ url?: string; title?: string; content?: string }>
  }
  translation: {
    content: string
    targetLanguage: string
    sourceLanguage?: string
  }
  error: {
    name?: string
    message: string
    code?: string
  }
  video: {
    url: string
    mimeType?: string
  }
  compact: {
    summary: string
    removedCount: number
  }
  code: {
    language: string
    code: string
    filename?: string
  }
}
