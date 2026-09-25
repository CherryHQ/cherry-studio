import { asc, desc, eq } from 'drizzle-orm'

import { application } from '@application'
import { courseLessonTable, courseTable } from '@main/data/db/schemas/course'
import type { Course, CourseLesson, LessonStatus } from '@shared/data/types/course'

function toCourse(row: typeof courseTable.$inferSelect): Course {
  return {
    id: row.id,
    title: row.title,
    knowledgeBaseId: row.knowledgeBaseId,
    currentLessonId: row.currentLessonId,
    syllabusJobId: row.syllabusJobId,
    syllabusStatus: row.syllabusStatus as Course['syllabusStatus'],
    totalLessons: row.totalLessons,
    completedLessons: row.completedLessons,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  }
}

function toLesson(row: typeof courseLessonTable.$inferSelect): CourseLesson {
  return {
    id: row.id,
    courseId: row.courseId,
    sortOrder: row.sortOrder,
    title: row.title,
    pageStart: row.pageStart,
    pageEnd: row.pageEnd,
    chunkStart: row.chunkStart,
    chunkEnd: row.chunkEnd,
    status: row.status as LessonStatus,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  }
}

class CourseService {
  create(input: { title: string; knowledgeBaseId: string }): Course {
    const db = application.get('DbService').getDb()
    const rows = db
      .insert(courseTable)
      .values({ title: input.title, knowledgeBaseId: input.knowledgeBaseId })
      .returning()
      .all()
    const row = rows[0]
    if (!row) throw new Error('CourseService: insert failed')
    return toCourse(row)
  }

  getById(id: string): Course {
    const db = application.get('DbService').getDb()
    const row = db.select().from(courseTable).where(eq(courseTable.id, id)).get()
    if (!row) throw new Error(`Course not found: ${id}`)
    return toCourse(row)
  }

  list(): Course[] {
    const db = application.get('DbService').getDb()
    return db.select().from(courseTable).orderBy(desc(courseTable.createdAt)).all().map(toCourse)
  }

  patch(
    id: string,
    updates: Partial<
      Pick<Course, 'currentLessonId' | 'syllabusJobId' | 'syllabusStatus' | 'totalLessons' | 'completedLessons'>
    >
  ): void {
    const db = application.get('DbService').getDb()
    db.update(courseTable).set(updates).where(eq(courseTable.id, id)).run()
  }

  delete(id: string): void {
    application.get('DbService').withWriteTx((db) => {
      db.delete(courseLessonTable).where(eq(courseLessonTable.courseId, id)).run()
      db.delete(courseTable).where(eq(courseTable.id, id)).run()
    })
  }

  getLessons(courseId: string): CourseLesson[] {
    const db = application.get('DbService').getDb()
    return db
      .select()
      .from(courseLessonTable)
      .where(eq(courseLessonTable.courseId, courseId))
      .orderBy(asc(courseLessonTable.sortOrder))
      .all()
      .map(toLesson)
  }

  upsertLessons(
    courseId: string,
    lessons: Array<{ title: string; sortOrder: number; pageStart?: number; pageEnd?: number }>
  ): void {
    application.get('DbService').withWriteTx((db) => {
      db.delete(courseLessonTable).where(eq(courseLessonTable.courseId, courseId)).run()
      if (lessons.length === 0) return
      db.insert(courseLessonTable)
        .values(
          lessons.map((l, i) => ({
            courseId,
            sortOrder: l.sortOrder,
            title: l.title,
            pageStart: l.pageStart ?? null,
            pageEnd: l.pageEnd ?? null,
            status: i === 0 ? 'ready' : 'locked'
          }))
        )
        .run()
    })
  }

  completeLesson(lessonId: string): { nextLessonId: string | null } {
    return application.get('DbService').withWriteTx((db) => {
      const lesson = db.select().from(courseLessonTable).where(eq(courseLessonTable.id, lessonId)).get()
      if (!lesson) throw new Error(`Lesson not found: ${lessonId}`)

      db.update(courseLessonTable).set({ status: 'completed' }).where(eq(courseLessonTable.id, lessonId)).run()

      const next = db
        .select()
        .from(courseLessonTable)
        .where(eq(courseLessonTable.courseId, lesson.courseId))
        .orderBy(asc(courseLessonTable.sortOrder))
        .all()
        .find((l) => l.sortOrder > lesson.sortOrder && l.status === 'locked')

      if (next) {
        db.update(courseLessonTable).set({ status: 'ready' }).where(eq(courseLessonTable.id, next.id)).run()
        db.update(courseTable).set({ currentLessonId: next.id }).where(eq(courseTable.id, lesson.courseId)).run()
      }

      const all = db.select().from(courseLessonTable).where(eq(courseLessonTable.courseId, lesson.courseId)).all()
      const completed = all.filter((l) => l.status === 'completed').length
      db.update(courseTable).set({ completedLessons: completed }).where(eq(courseTable.id, lesson.courseId)).run()

      return { nextLessonId: next?.id ?? null }
    })
  }
}

export const courseService = new CourseService()
