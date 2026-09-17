import { application } from '@application'
import { courseService } from '@main/data/services/CourseService'
import type { tutorRequestSchemas } from '@shared/ipc/schemas/tutor'
import type { IpcHandlersFor } from '@shared/ipc/types'

export const tutorHandlers: IpcHandlersFor<typeof tutorRequestSchemas> = {
  'tutor.course.create': async (payload) => {
    const course = courseService.create({ title: payload.title, knowledgeBaseId: payload.knowledgeBaseId })
    const jobManager = application.get('JobManager')
    const handle = jobManager.enqueue('course.build-syllabus', { courseId: course.id })
    courseService.patch(course.id, { syllabusJobId: handle.id, syllabusStatus: 'building' })
    return { courseId: course.id, jobId: handle.id }
  },

  'tutor.course.list': async () => courseService.list(),

  'tutor.course.lessons': async (payload) => courseService.getLessons(payload.courseId),

  'tutor.lesson.complete': async (payload) => courseService.completeLesson(payload.lessonId)
}
