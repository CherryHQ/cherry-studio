export type SyllabusStatus = 'pending' | 'building' | 'ready' | 'failed'
export type LessonStatus = 'locked' | 'ready' | 'in_progress' | 'completed'

export interface Course {
  id: string
  title: string
  knowledgeBaseId: string
  currentLessonId?: string | null
  syllabusJobId?: string | null
  syllabusStatus: SyllabusStatus
  totalLessons: number
  completedLessons: number
  createdAt: number
  updatedAt: number
}

export interface CourseLesson {
  id: string
  courseId: string
  sortOrder: number
  title: string
  pageStart?: number | null
  pageEnd?: number | null
  chunkStart?: number | null
  chunkEnd?: number | null
  status: LessonStatus
  createdAt: number
  updatedAt: number
}
