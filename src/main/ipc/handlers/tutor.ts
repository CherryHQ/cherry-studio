import { application } from '@application'
import { courseService } from '@main/data/services/CourseService'
import type { tutorRequestSchemas } from '@shared/ipc/schemas/tutor'
import type { IpcHandlersFor } from '@shared/ipc/types'

export const tutorHandlers: IpcHandlersFor<typeof tutorRequestSchemas> = {
  'tutor.course.create': async (payload) => {
    const jobManager = application.get('JobManager')
    // Course row, its syllabus job, and the job-id backlink all commit or roll back together —
    // otherwise a failure between steps leaves an orphan course with no job, or a job the course
    // row never learned about.
    const { courseId, jobId } = application.get('DbService').withWriteTx((tx) => {
      const course = courseService.createTx(tx, { title: payload.title, knowledgeBaseId: payload.knowledgeBaseId })
      const handle = jobManager.enqueueTx(tx, 'course.build-syllabus', { courseId: course.id })
      courseService.patchTx(tx, course.id, { syllabusJobId: handle.id, syllabusStatus: 'building' })
      return { courseId: course.id, jobId: handle.id }
    })
    return { courseId, jobId }
  },

  'tutor.course.list': async () => courseService.list(),

  'tutor.course.lessons': async (payload) => courseService.getLessons(payload.courseId),

  'tutor.lesson.complete': async (payload) => courseService.completeLesson(payload.lessonId)
}
