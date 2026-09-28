import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockApplicationGet, mockCourseCreateTx, mockCoursePatchTx } = vi.hoisted(() => ({
  mockApplicationGet: vi.fn(),
  mockCourseCreateTx: vi.fn(),
  mockCoursePatchTx: vi.fn()
}))

vi.mock('@application', () => ({
  application: { get: mockApplicationGet }
}))

vi.mock('@main/data/services/CourseService', () => ({
  courseService: {
    createTx: (...args: unknown[]) => mockCourseCreateTx(...args),
    patchTx: (...args: unknown[]) => mockCoursePatchTx(...args)
  }
}))

const { tutorHandlers } = await import('../tutor')

describe('tutorHandlers[tutor.course.create]', () => {
  beforeEach(() => {
    mockApplicationGet.mockReset()
    mockCourseCreateTx.mockReset()
    mockCoursePatchTx.mockReset()
  })

  it('creates the course, enqueues its syllabus job, and links the job id back — all inside one transaction', async () => {
    const tx = { marker: 'the-one-tx' }
    mockCourseCreateTx.mockReturnValue({ id: 'course-1' })
    const enqueueTx = vi.fn().mockReturnValue({ id: 'job-1', snapshot: {}, finished: new Promise(() => {}) })
    mockApplicationGet.mockImplementation((name: string) => {
      if (name === 'JobManager') return { enqueueTx }
      if (name === 'DbService') return { withWriteTx: (fn: any) => fn(tx) }
      return undefined
    })

    const result = await tutorHandlers['tutor.course.create'](
      { title: 'Physics 101', knowledgeBaseId: 'kb-1' },
      { senderId: null }
    )

    expect(result).toEqual({ courseId: 'course-1', jobId: 'job-1' })
    // All three writes must share the SAME tx — that is what makes an enqueue or
    // patch failure roll the course creation back too, instead of leaving an
    // orphan course row with no syllabus job.
    expect(mockCourseCreateTx).toHaveBeenCalledWith(tx, { title: 'Physics 101', knowledgeBaseId: 'kb-1' })
    expect(enqueueTx).toHaveBeenCalledWith(tx, 'course.build-syllabus', { courseId: 'course-1' })
    expect(mockCoursePatchTx).toHaveBeenCalledWith(tx, 'course-1', {
      syllabusJobId: 'job-1',
      syllabusStatus: 'building'
    })
  })

  it('never leaves an orphan course row when enqueueing the syllabus job fails', async () => {
    mockCourseCreateTx.mockReturnValue({ id: 'course-2' })
    const enqueueTx = vi.fn().mockImplementation(() => {
      throw new Error('enqueue boom')
    })
    mockApplicationGet.mockImplementation((name: string) => {
      if (name === 'JobManager') return { enqueueTx }
      if (name === 'DbService') return { withWriteTx: (fn: any) => fn({}) }
      return undefined
    })

    await expect(
      tutorHandlers['tutor.course.create']({ title: 'Chemistry 101', knowledgeBaseId: 'kb-2' }, { senderId: null })
    ).rejects.toThrow('enqueue boom')
    // The patch never runs — proving the failure happened before it, inside the same tx.
    expect(mockCoursePatchTx).not.toHaveBeenCalled()
  })
})
