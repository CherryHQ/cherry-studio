import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { JobContext } from '@main/core/job/types'

import type { BuildSyllabusJobInput } from '../jobTypes'

const { getByIdMock, patchMock, upsertLessonsMock, getIndexPathMock, dbRunMock, DatabaseMock } = vi.hoisted(() => ({
  getByIdMock: vi.fn(),
  patchMock: vi.fn(),
  upsertLessonsMock: vi.fn(),
  getIndexPathMock: vi.fn(),
  dbRunMock: vi.fn(),
  DatabaseMock: vi.fn()
}))

vi.mock('@application', () => ({ application: { getOptional: vi.fn().mockReturnValue(undefined) } }))
vi.mock('@main/data/services/CourseService', () => ({
  courseService: { getById: getByIdMock, patch: patchMock, upsertLessons: upsertLessonsMock }
}))
vi.mock('@main/features/knowledge', () => ({ getKnowledgeVectorStoreFilePathSync: getIndexPathMock }))
vi.mock('better-sqlite3', () => ({ default: DatabaseMock }))

const { buildSyllabusJobHandler } = await import('../buildSyllabusJobHandler')

function createCtx(overrides: Partial<JobContext<BuildSyllabusJobInput>> = {}): JobContext<BuildSyllabusJobInput> {
  return {
    jobId: 'syllabus-job-1',
    input: { courseId: 'course-1' },
    attempt: 0,
    signal: new AbortController().signal,
    metadata: {},
    patchMetadata: vi.fn().mockResolvedValue(undefined),
    reportProgress: vi.fn(),
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as never,
    ...overrides
  } as JobContext<BuildSyllabusJobInput>
}

beforeEach(() => {
  vi.clearAllMocks()
  getByIdMock.mockReturnValue({ id: 'course-1', knowledgeBaseId: 'kb-1' })
  getIndexPathMock.mockReturnValue('/tmp/index.sqlite')
  patchMock.mockReturnValue(undefined)
  upsertLessonsMock.mockReturnValue(undefined)
})

describe('buildSyllabusJobHandler.execute', () => {
  it('marks the course failed (not left building) when the knowledge index cannot be read at all', async () => {
    DatabaseMock.mockImplementation(() => {
      throw new Error('cannot open index')
    })

    await expect(buildSyllabusJobHandler.execute(createCtx())).rejects.toThrow('Could not extract syllabus')

    expect(patchMock).toHaveBeenCalledWith('course-1', { syllabusStatus: 'building' })
    expect(patchMock).toHaveBeenCalledWith('course-1', { syllabusStatus: 'failed' })
  })

  it('marks the course failed (not left building forever) when persisting the extracted lessons throws', async () => {
    DatabaseMock.mockImplementation(function MockDatabase() {
      return {
        prepare: () => ({
          all: () => [{ text: '1. Introduction' }, { text: '2. Basics' }, { text: '3. Advanced Topics' }]
        }),
        close: dbRunMock
      }
    })
    upsertLessonsMock.mockImplementation(() => {
      throw new Error('write failed')
    })

    await expect(buildSyllabusJobHandler.execute(createCtx())).rejects.toThrow('write failed')

    expect(patchMock).toHaveBeenCalledWith('course-1', { syllabusStatus: 'failed' })
    // The old code only reset status to 'failed' on the "no headings" branch — proving this
    // test would have failed before the fix, since upsertLessons throwing skipped that branch.
    expect(patchMock).not.toHaveBeenCalledWith('course-1', expect.objectContaining({ syllabusStatus: 'ready' }))
  })

  it('reaches ready with the extracted lessons on the happy path', async () => {
    DatabaseMock.mockImplementation(function MockDatabase() {
      return {
        prepare: () => ({
          all: () => [{ text: '1. Introduction' }, { text: '2. Basics' }, { text: '3. Advanced Topics' }]
        }),
        close: dbRunMock
      }
    })

    await buildSyllabusJobHandler.execute(createCtx())

    expect(upsertLessonsMock).toHaveBeenCalledWith('course-1', [
      { title: '1. Introduction', sortOrder: 1 },
      { title: '2. Basics', sortOrder: 2 },
      { title: '3. Advanced Topics', sortOrder: 3 }
    ])
    expect(patchMock).toHaveBeenCalledWith('course-1', {
      syllabusStatus: 'ready',
      totalLessons: 3,
      completedLessons: 0
    })
  })
})
