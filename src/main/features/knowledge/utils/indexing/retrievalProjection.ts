import { application } from '@application'
import { loggerService } from '@logger'
import { type UniqueModelId, UniqueModelIdSchema } from '@shared/data/types/model'
import * as z from 'zod'

import type { KnowledgeContentChunk } from './chunk'

const logger = loggerService.withContext('Knowledge:RetrievalProjection')

const MAX_BATCH_CHARACTERS = 3_500
const MAX_BATCH_SPANS = 8
const MAX_OUTPUT_TOKENS = 4_096
const MAX_FACT_CHARACTERS = 512
const MAX_FACTS_PER_BATCH = 64

const ProjectionFactSchema = z.strictObject({
  text: z.string().trim().min(1).max(MAX_FACT_CHARACTERS),
  spanId: z.string().min(1),
  anchors: z.array(z.string().min(1).max(200)).max(32)
})

const ProjectionResponseSchema = z.strictObject({
  facts: z.array(z.unknown()).max(MAX_FACTS_PER_BATCH)
})

interface ProjectionSpan {
  id: string
  unitIndex: number
  text: string
}

export interface GeneratedRetrievalProjection {
  unitIndex: number
  text: string
}

const SYSTEM_PROMPT = `You create semantic retrieval propositions from source spans.
Return JSON only with this shape:
{"facts":[{"text":"an independently understandable factual proposition","spanId":"S0001","anchors":["exact source anchor"]}]}

Rules:
- Each fact must be fully supported by exactly one supplied span.
- Do not combine facts across spans.
- Do not infer, guess, summarize beyond the source, or add outside knowledge.
- Preserve names, identifiers, dates, quantities, product names, and organizations exactly.
- anchors must list every name, identifier, date, quantity, product, organization, or other distinctive phrase used in the fact, copied exactly from the cited span.
- Prefer propositions that a user could search for even when their wording differs from the source.
- Return zero facts for a span that contains no useful factual claim.`

/**
 * Generate retrieval-only propositions from authoritative raw chunks.
 *
 * Every retained proposition cites one request-local span id and passes local
 * anchor validation. Invalid batches/facts fail closed; cancellation still
 * propagates so the owning indexing job can stop promptly.
 */
export async function generateRetrievalProjections(
  chunks: KnowledgeContentChunk[],
  configuredModelId: string,
  signal?: AbortSignal
): Promise<GeneratedRetrievalProjection[]> {
  if (chunks.length === 0) {
    return []
  }

  const parsedModelId = UniqueModelIdSchema.safeParse(configuredModelId)
  if (!parsedModelId.success) {
    logger.warn('Skipping retrieval projections because the configured model id is invalid')
    return []
  }

  const projections: GeneratedRetrievalProjection[] = []
  const seenTextsByUnit = new Map<number, Set<string>>()

  for (const batch of createProjectionBatches(chunks)) {
    signal?.throwIfAborted()
    const facts = await generateBatch(batch, parsedModelId.data, signal)
    for (const fact of facts) {
      const normalizedText = fact.text.trim()
      const seenTexts = seenTextsByUnit.get(fact.unitIndex) ?? new Set<string>()
      if (seenTexts.has(normalizedText)) {
        continue
      }
      seenTexts.add(normalizedText)
      seenTextsByUnit.set(fact.unitIndex, seenTexts)
      projections.push({ unitIndex: fact.unitIndex, text: normalizedText })
    }
  }

  return projections
}

function createProjectionBatches(chunks: KnowledgeContentChunk[]): ProjectionSpan[][] {
  const batches: ProjectionSpan[][] = []
  let current: ProjectionSpan[] = []
  let currentCharacters = 0

  const flush = () => {
    if (current.length > 0) {
      batches.push(current)
      current = []
      currentCharacters = 0
    }
  }

  for (const chunk of chunks) {
    if (
      current.length > 0 &&
      (current.length >= MAX_BATCH_SPANS || currentCharacters + chunk.text.length > MAX_BATCH_CHARACTERS)
    ) {
      flush()
    }
    current.push({
      id: `S${String(current.length + 1).padStart(4, '0')}`,
      unitIndex: chunk.unitIndex,
      text: chunk.text
    })
    currentCharacters += chunk.text.length
  }
  flush()

  return batches
}

async function generateBatch(
  spans: ProjectionSpan[],
  uniqueModelId: UniqueModelId,
  signal?: AbortSignal
): Promise<GeneratedRetrievalProjection[]> {
  const prompt = JSON.stringify({
    spans: spans.map(({ id, text }) => ({ id, text }))
  })

  // One identical retry recovered every transient batch failure in the pilot.
  // Keep it local so a bad projection batch never fails raw-source indexing.
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      const result = await application.get('AiService').generateText({
        uniqueModelId,
        system: SYSTEM_PROMPT,
        prompt,
        callOverrides: {
          temperature: 0,
          maxOutputTokens: MAX_OUTPUT_TOKENS
        },
        requestOptions: {
          maxRetries: 0,
          ...(signal ? { signal } : {})
        }
      })
      const validated = validateProjectionResponse(result.text, spans)
      if (validated !== null) {
        return validated
      }
    } catch (error) {
      signal?.throwIfAborted()
      if (attempt === 2) {
        logger.warn('Retrieval projection batch failed after one retry', {
          spanCount: spans.length,
          error: error instanceof Error ? error.message : String(error)
        })
      }
    }
  }

  logger.warn('Dropping retrieval projection batch because no valid JSON response was produced', {
    spanCount: spans.length
  })
  return []
}

function validateProjectionResponse(
  responseText: string,
  spans: ProjectionSpan[]
): GeneratedRetrievalProjection[] | null {
  const parsedJson = parseJsonResponse(responseText)
  const response = ProjectionResponseSchema.safeParse(parsedJson)
  if (!response.success) {
    return null
  }

  const spansById = new Map(spans.map((span) => [span.id, span]))
  const retained: GeneratedRetrievalProjection[] = []

  for (const candidate of response.data.facts) {
    const fact = ProjectionFactSchema.safeParse(candidate)
    if (!fact.success) {
      continue
    }
    const span = spansById.get(fact.data.spanId)
    if (!span || !anchorsAreSupported(fact.data.text, fact.data.anchors, span.text)) {
      continue
    }
    retained.push({ unitIndex: span.unitIndex, text: fact.data.text })
  }

  return retained
}

function parseJsonResponse(text: string): unknown {
  const trimmed = text.trim()
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(trimmed)
  const candidate = fenced?.[1] ?? trimmed
  try {
    return JSON.parse(candidate)
  } catch {
    return null
  }
}

function anchorsAreSupported(factText: string, declaredAnchors: string[], sourceText: string): boolean {
  const anchors = new Set([...declaredAnchors, ...extractHardAnchors(factText)])
  for (const anchor of anchors) {
    if (!sourceText.includes(anchor)) {
      return false
    }
  }
  return true
}

/**
 * Deterministically catch the high-risk hallucinations seen in the pilot even
 * when a model omits them from its declared anchors: numeric/ID tokens, acronyms,
 * and CamelCase product or organization names.
 */
function extractHardAnchors(text: string): string[] {
  const anchors = new Set<string>()
  const patterns = [
    /[\p{L}\p{N}_./:@%+-]*\p{N}[\p{L}\p{N}_./:@%+-]*/gu,
    /\b[A-Z][A-Z0-9_-]{1,}\b/g,
    /\b[A-Z][a-z]+[A-Z][A-Za-z0-9]*\b/g
  ]
  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      anchors.add(match[0])
    }
  }
  return [...anchors]
}
