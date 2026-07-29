import { learningSourceTable } from '@data/db/schemas/learningSource'
import {
  learningUnitDedupDecisionTable,
  learningUnitSourceTable,
  learningUnitTable
} from '@data/db/schemas/learningUnit'
import { learningSourceService } from '@data/services/LearningSourceService'
import {
  buildExtractionBatches,
  LearningExtractionService,
  parseExtractionResponse,
  splitLearningText
} from '@main/features/englishLearning/extraction/LearningExtractionService'
import { setupTestDatabase } from '@test-helpers/db'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@data/dataApiDataChange', () => ({ notifyDataApiDataChange: vi.fn() }))

const validResponse = JSON.stringify({
  units: [
    {
      kind: 'expression',
      english: 'lend a hand',
      meaning: '帮忙',
      usageNote: 'Informal and natural.',
      example: 'Could you lend me a hand?',
      tags: ['help'],
      cefr: 'B1',
      confidence: 0.98
    }
  ]
})

function createSource(
  sourceRecordId: string,
  overrides: Partial<Parameters<typeof learningSourceService.register>[0]> = {}
) {
  return learningSourceService.register({
    kind: 'translation',
    sourceRecordId,
    sourceRevision: 'revision-1',
    sourceLanguage: 'zh-CN',
    targetLanguage: 'en-US',
    sourceText: '请帮我一下。',
    targetText: 'Could you lend me a hand?',
    ...overrides
  })
}

describe('LearningExtractionService', () => {
  const dbh = setupTestDatabase()

  it('cleans and deterministically splits paragraphs, sentences, and long segments', () => {
    const long = 'a'.repeat(2_001)

    expect(splitLearningText(` First sentence.  Second sentence!\n\n${long}`)).toEqual([
      'First sentence.',
      'Second sentence!',
      'a'.repeat(2_000),
      'a'
    ])
    expect(buildExtractionBatches({ sourceText: '你好。 再见。', targetText: 'Hello. Goodbye.' })).toEqual([
      {
        sourceSegments: ['你好。', '再见。'],
        targetSegments: ['Hello.', 'Goodbye.']
      }
    ])
    const elevenSentences = Array.from({ length: 11 }, (_, index) => `Sentence ${index + 1}.`).join(' ')
    expect(buildExtractionBatches({ sourceText: elevenSentences, targetText: elevenSentences })).toHaveLength(2)
  })

  it.each([
    ['translation', '翻译结果', 'The translation contains a useful phrase.'],
    ['selection_action', '请互译这句话', 'A natural translation with a useful phrase.'],
    ['selection_refine', 'This sentence need polish.', 'This sentence needs polishing.']
  ] as const)('uses the same two-layer extraction contract for %s history', async (kind, sourceText, targetText) => {
    const service = new LearningExtractionService()
    const source = createSource(`two-layer-${kind}`, {
      kind,
      sourceText,
      targetText,
      sourceLanguage: null,
      targetLanguage: null
    })
    const generateText = vi.fn().mockResolvedValue({ text: validResponse })

    await service.extract(source, { generateText })

    const request = generateText.mock.calls[0][0]
    expect(request.system).toContain('Use two layers consistently for every history kind.')
    expect(request.system).toContain('always emit one sentence unit')
    expect(request.system).toContain('emit at most two independently reusable')
    expect(request.system).toContain('example to its original complete context sentence')
    expect(JSON.parse(request.prompt)).toMatchObject({
      historyKind: kind,
      sourceSegments: [sourceText],
      targetSegments: [targetText]
    })
  })

  it('parses strict JSON and a fenced JSON response', () => {
    expect(parseExtractionResponse(validResponse)).toHaveLength(1)
    expect(parseExtractionResponse(`\`\`\`json\n${validResponse}\n\`\`\``)[0].english).toBe('lend a hand')
    expect(() => parseExtractionResponse('{"units":[]}')).toThrow('invalid structured output')
  })

  it('extracts a source, creates a unit, and preserves duplicate provenance links', async () => {
    const service = new LearningExtractionService()
    const first = createSource('translation-1')
    const second = createSource('translation-2')
    const generateText = vi.fn().mockResolvedValue({ text: validResponse })

    await service.processSource(first.id, { generateText })
    await service.processSource(second.id, { generateText })

    expect(learningSourceService.getById(first.id).status).toBe('ready')
    expect(dbh.db.select().from(learningUnitTable).all()).toHaveLength(1)
    expect(dbh.db.select().from(learningUnitSourceTable).all()).toHaveLength(2)
    expect(generateText).toHaveBeenCalledTimes(2)
    expect(generateText.mock.calls[0][0]).toMatchObject({
      callOverrides: { temperature: 0, maxOutputTokens: 4_000 }
    })
  })

  it('repairs one invalid model response and fails explicitly after a second invalid response', async () => {
    const service = new LearningExtractionService()
    const repairedSource = createSource('translation-repair')
    const repairedGenerator = vi
      .fn()
      .mockResolvedValueOnce({ text: 'not json' })
      .mockResolvedValueOnce({ text: validResponse })

    await service.processSource(repairedSource.id, { generateText: repairedGenerator })
    expect(learningSourceService.getById(repairedSource.id).status).toBe('ready')
    expect(repairedGenerator).toHaveBeenCalledTimes(2)

    const failedSource = createSource('translation-failed')
    const invalidGenerator = vi.fn().mockResolvedValue({ text: 'still not json' })
    await expect(service.processSource(failedSource.id, { generateText: invalidGenerator })).rejects.toThrow(
      'invalid structured output'
    )
    expect(learningSourceService.getById(failedSource.id)).toMatchObject({
      status: 'failed',
      error: 'The learning extraction model returned invalid structured output'
    })
  })

  it('auto-merges only a high-confidence semantic duplicate and records the model decision', async () => {
    const service = new LearningExtractionService()
    const firstSource = createSource('translation-semantic-1')
    await service.processSource(firstSource.id, { generateText: vi.fn().mockResolvedValue({ text: validResponse }) })
    const existingUnit = dbh.db.select().from(learningUnitTable).get()!
    const secondSource = createSource('translation-semantic-2')
    const variantResponse = JSON.stringify({
      units: [
        {
          kind: 'expression',
          english: 'Could you help me?',
          meaning: '帮忙',
          usageNote: null,
          example: null,
          tags: ['help'],
          cefr: 'A2',
          confidence: 0.95
        }
      ]
    })
    const generateText = vi
      .fn()
      .mockResolvedValueOnce({ text: variantResponse })
      .mockResolvedValueOnce({
        text: JSON.stringify({ decision: 'same', matchedUnitId: existingUnit.id, confidence: 0.97 })
      })

    await service.processSource(secondSource.id, { generateText })

    expect(dbh.db.select().from(learningUnitTable).all()).toHaveLength(1)
    expect(dbh.db.select().from(learningUnitSourceTable).all()).toHaveLength(2)
    expect(dbh.db.select().from(learningUnitDedupDecisionTable).get()).toMatchObject({
      learningSourceId: secondSource.id,
      matchedUnitId: existingUnit.id,
      resultingUnitId: existingUnit.id,
      decision: 'same',
      confidence: 0.97
    })

    learningSourceService.setStatus(secondSource.id, 'failed', 'interrupted after a partial write')
    learningSourceService.retry(secondSource.id)
    const retryGenerator = vi.fn().mockResolvedValueOnce({ text: variantResponse })
    await service.processSource(secondSource.id, { generateText: retryGenerator })
    expect(retryGenerator).toHaveBeenCalledTimes(1)
    expect(dbh.db.select().from(learningUnitDedupDecisionTable).all()).toHaveLength(1)
  })

  it('keeps a low-confidence semantic match as a separate unit', async () => {
    const service = new LearningExtractionService()
    const firstSource = createSource('translation-low-confidence-1')
    await service.processSource(firstSource.id, { generateText: vi.fn().mockResolvedValue({ text: validResponse }) })
    const existingUnit = dbh.db.select().from(learningUnitTable).get()!
    const secondSource = createSource('translation-low-confidence-2')
    const variantResponse = validResponse.replace('lend a hand', 'give me a hand')
    const generateText = vi
      .fn()
      .mockResolvedValueOnce({ text: variantResponse })
      .mockResolvedValueOnce({
        text: JSON.stringify({ decision: 'same', matchedUnitId: existingUnit.id, confidence: 0.8 })
      })

    await service.processSource(secondSource.id, { generateText })

    expect(dbh.db.select().from(learningUnitTable).all()).toHaveLength(2)
    expect(dbh.db.select().from(learningUnitDedupDecisionTable).get()).toMatchObject({
      decision: 'same',
      confidence: 0.8
    })
  })

  it('requeues sources left processing by an interrupted app session', () => {
    const source = createSource('translation-interrupted')
    learningSourceService.setStatus(source.id, 'processing')

    expect(learningSourceService.requeueInterrupted()).toBe(1)
    expect(dbh.db.select().from(learningSourceTable).get()).toMatchObject({
      id: source.id,
      status: 'pending'
    })
  })
})
