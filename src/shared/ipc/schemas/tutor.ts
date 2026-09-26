import * as z from 'zod'

import { defineRoute } from '../define'

export const tutorRequestSchemas = {
  'tutor.course.create': defineRoute({
    input: z.strictObject({ title: z.string().min(1), knowledgeBaseId: z.string() }),
    output: z.object({ courseId: z.string(), jobId: z.string() })
  }),

  'tutor.course.list': defineRoute({
    input: z.strictObject({}),
    output: z.array(
      z.object({
        id: z.string(),
        title: z.string(),
        knowledgeBaseId: z.string(),
        syllabusStatus: z.string(),
        totalLessons: z.number(),
        completedLessons: z.number(),
        currentLessonId: z.string().nullable().optional(),
        createdAt: z.number(),
        updatedAt: z.number()
      })
    )
  }),

  'tutor.course.lessons': defineRoute({
    input: z.strictObject({ courseId: z.string() }),
    output: z.array(
      z.object({
        id: z.string(),
        courseId: z.string(),
        sortOrder: z.number(),
        title: z.string(),
        status: z.string(),
        pageStart: z.number().nullable().optional(),
        pageEnd: z.number().nullable().optional(),
        createdAt: z.number(),
        updatedAt: z.number()
      })
    )
  }),

  'tutor.lesson.complete': defineRoute({
    input: z.strictObject({ lessonId: z.string() }),
    output: z.object({ nextLessonId: z.string().nullable() })
  })
} as const
