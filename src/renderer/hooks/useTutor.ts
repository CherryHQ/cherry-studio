import { useCallback, useEffect, useState } from 'react'

import { ipcApi } from '@renderer/ipc'

export interface TutorCourse {
  id: string
  title: string
  knowledgeBaseId: string
  syllabusStatus: string
  totalLessons: number
  completedLessons: number
  currentLessonId?: string | null
  createdAt: number
  updatedAt: number
}

export interface TutorLesson {
  id: string
  courseId: string
  sortOrder: number
  title: string
  status: string
  pageStart?: number | null
  pageEnd?: number | null
  createdAt: number
  updatedAt: number
}

export function useCourses() {
  const [courses, setCourses] = useState<TutorCourse[]>([])
  const [isLoading, setIsLoading] = useState(false)

  const refresh = useCallback(async () => {
    setIsLoading(true)
    try {
      const result = await ipcApi.request('tutor.course.list', {})
      setCourses(result as TutorCourse[])
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    refresh()
  }, [refresh])

  const createCourse = useCallback(
    async (title: string, knowledgeBaseId: string) => {
      const result = await ipcApi.request('tutor.course.create', { title, knowledgeBaseId })
      await refresh()
      return result
    },
    [refresh]
  )

  return { courses, isLoading, refresh, createCourse }
}

export function useCourseLessons(courseId: string | null) {
  const [lessons, setLessons] = useState<TutorLesson[]>([])
  const [isLoading, setIsLoading] = useState(false)

  const refresh = useCallback(async () => {
    if (!courseId) return
    setIsLoading(true)
    try {
      const result = await ipcApi.request('tutor.course.lessons', { courseId })
      setLessons(result as TutorLesson[])
    } finally {
      setIsLoading(false)
    }
  }, [courseId])

  useEffect(() => {
    refresh()
  }, [refresh])

  const completeLesson = useCallback(
    async (lessonId: string) => {
      const result = await ipcApi.request('tutor.lesson.complete', { lessonId })
      await refresh()
      return result
    },
    [refresh]
  )

  return { lessons, isLoading, refresh, completeLesson }
}
