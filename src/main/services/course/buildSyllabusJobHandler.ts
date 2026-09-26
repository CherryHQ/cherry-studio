import './jobTypes'
import { generateText } from 'ai'
import Database from 'better-sqlite3'

import { application } from '@application'
import { loggerService } from '@logger'
import { resolveCompressionModel } from '@main/ai/contextBuild/resolveCompressionModel'
import type { JobHandler } from '@main/core/job/types'
import { courseService } from '@main/data/services/CourseService'
import { getKnowledgeVectorStoreFilePathSync } from '@main/features/knowledge'

import type { BuildSyllabusJobInput } from './jobTypes'

const logger = loggerService.withContext('Course:BuildSyllabusJobHandler')

const HEADING_RE = /^(?:(?:Bölüm|Chapter|Ders|Konu|Unit|Part|Section)\s+\d+[\s:.]+|(?:\d+[\s.]+){1,3})(.+)/im
const NUMBERED_HEADING_RE = /^(\d+[\s.]+[\w\s]{3,60})$/m

function extractHeadingsFromChunks(chunks: string[]): string[] {
  const headings: string[] = []
  for (const text of chunks) {
    for (const line of text.split('\n')) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.length < 3 || trimmed.length > 120) continue
      if (HEADING_RE.test(trimmed) || NUMBERED_HEADING_RE.test(trimmed)) {
        const clean = trimmed.replace(/^#+\s*/, '').trim()
        if (clean && !headings.includes(clean)) headings.push(clean)
      }
    }
    if (headings.length >= 20) break
  }
  return headings
}

async function extractViaLlm(courseId: string, text: string): Promise<string[]> {
  const routingService = application.getOptional('ModelRoutingService')
  if (!routingService) return []
  const candidates = routingService.candidatesFor('general')
  if (candidates.length === 0) return []

  const descriptor = await resolveCompressionModel(candidates[0], { id: `course:syllabus:${courseId}` })
  if (!descriptor) return []

  const truncated = text.slice(0, 4000)
  const prompt = `Extract the chapter or section titles from this table of contents or beginning of a document. Return ONLY a JSON array of title strings, no explanation.\n\nText:\n${truncated}`

  try {
    const result = await generateText({ model: descriptor.languageModel, prompt })
    const match = result.text.match(/\[[\s\S]*\]/)
    if (!match) return []
    const parsed: unknown = JSON.parse(match[0])
    if (!Array.isArray(parsed)) return []
    return (parsed as unknown[]).filter((x): x is string => typeof x === 'string' && x.trim().length > 0).slice(0, 30)
  } catch (err) {
    logger.warn('LLM syllabus extraction failed', { error: String(err) })
    return []
  }
}

export const buildSyllabusJobHandler: JobHandler<BuildSyllabusJobInput> = {
  recovery: 'retry',
  defaultQueue: () => 'course.syllabus',
  defaultConcurrency: 1,
  defaultRetryPolicy: { maxAttempts: 1, backoff: 'none', baseDelayMs: 0, maxDelayMs: 0 },
  defaultTimeoutMs: 5 * 60_000,

  async execute(ctx) {
    const { courseId } = ctx.input
    const course = courseService.getById(courseId)

    courseService.patch(courseId, { syllabusStatus: 'building' })
    ctx.reportProgress(5, { stage: 'reading' })

    // Read first 30 chunks from the knowledge base vector index
    const indexPath = getKnowledgeVectorStoreFilePathSync(course.knowledgeBaseId)
    let chunks: string[] = []

    try {
      const db = new Database(indexPath, { readonly: true })
      try {
        const rows = db
          .prepare(
            `SELECT c.text FROM search_unit su
             JOIN content c ON su.content_hash = c.content_hash
             ORDER BY su.unit_index ASC LIMIT 30`
          )
          .all() as Array<{ text: string }>
        chunks = rows.map((r) => r.text)
      } finally {
        db.close()
      }
    } catch (err) {
      logger.warn('Failed to read knowledge index for course', { courseId, error: String(err) })
    }

    ctx.reportProgress(40, { stage: 'extracting' })

    let headings = extractHeadingsFromChunks(chunks)
    if (headings.length < 3 && chunks.length > 0) {
      const fullText = chunks.join('\n')
      headings = await extractViaLlm(courseId, fullText)
    }

    if (headings.length === 0) {
      courseService.patch(courseId, { syllabusStatus: 'failed' })
      throw new Error(`Could not extract syllabus for course ${courseId}`)
    }

    courseService.upsertLessons(
      courseId,
      headings.map((title, i) => ({ title, sortOrder: i + 1 }))
    )
    courseService.patch(courseId, {
      syllabusStatus: 'ready',
      totalLessons: headings.length,
      completedLessons: 0
    })

    ctx.reportProgress(100, { stage: 'done' })
  }
}
