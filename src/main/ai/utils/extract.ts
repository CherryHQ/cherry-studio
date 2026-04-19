import { XMLParser } from 'fast-xml-parser'

export interface ExtractResults {
  websearch?: WebsearchExtractResults
  knowledge?: KnowledgeExtractResults
}

export interface WebsearchExtractResults {
  question: string[]
  links?: string[]
}

export interface KnowledgeExtractResults {
  rewrite: string
  question: string[]
}

/**
 * Parse an XML-tagged response from the search-intent extraction LLM call into
 * structured ExtractResults.
 *
 * Mirrors the renderer-side `extractInfoFromXML` (deleted with the legacy
 * `aiCore` layer in commit 188f25478) so the migrated `searchOrchestrationPlugin`
 * keeps the same parsing semantics.
 */
export const extractInfoFromXML = (text: string): ExtractResults => {
  const parser = new XMLParser({
    isArray: (name) => name === 'question' || name === 'links'
  })
  return parser.parse(text)
}
