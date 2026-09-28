import { sql } from 'drizzle-orm'
import { check, index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'

import { createUpdateTimestamps, uuidPrimaryKey } from './_columnHelpers'

export const courseTable = sqliteTable(
  'course',
  {
    id: uuidPrimaryKey(),
    title: text().notNull(),
    knowledgeBaseId: text('knowledge_base_id').notNull(),
    currentLessonId: text('current_lesson_id'),
    syllabusJobId: text('syllabus_job_id'),
    syllabusStatus: text('syllabus_status').notNull().default('pending'),
    totalLessons: integer('total_lessons').notNull().default(0),
    completedLessons: integer('completed_lessons').notNull().default(0),
    ...createUpdateTimestamps
  },
  (t) => [
    check('course_syllabus_status_check', sql`${t.syllabusStatus} IN ('pending','building','ready','failed')`),
    index('course_knowledge_base_idx').on(t.knowledgeBaseId)
  ]
)

export const courseLessonTable = sqliteTable(
  'course_lesson',
  {
    id: uuidPrimaryKey(),
    courseId: text('course_id').notNull(),
    sortOrder: integer('sort_order').notNull(),
    title: text().notNull(),
    pageStart: integer('page_start'),
    pageEnd: integer('page_end'),
    chunkStart: integer('chunk_start'),
    chunkEnd: integer('chunk_end'),
    status: text().notNull().default('locked'),
    ...createUpdateTimestamps
  },
  (t) => [
    check('course_lesson_status_check', sql`${t.status} IN ('locked','ready','in_progress','completed')`),
    index('course_lesson_course_sort_idx').on(t.courseId, t.sortOrder)
  ]
)

export type CourseRow = typeof courseTable.$inferSelect
export type InsertCourseRow = typeof courseTable.$inferInsert
export type CourseLessonRow = typeof courseLessonTable.$inferSelect
export type InsertCourseLessonRow = typeof courseLessonTable.$inferInsert
