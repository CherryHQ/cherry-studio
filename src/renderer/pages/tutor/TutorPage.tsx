import { type FC, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { useKnowledgeBases } from '@renderer/hooks/useKnowledgeBase'
import { useCourseLessons, useCourses } from '@renderer/hooks/useTutor'

const TutorPage: FC = () => {
  const { t } = useTranslation()
  const { courses, isLoading: coursesLoading, createCourse } = useCourses()
  const { bases } = useKnowledgeBases()

  const [selectedCourseId, setSelectedCourseId] = useState<string | null>(null)
  const [showCreate, setShowCreate] = useState(false)
  const [newTitle, setNewTitle] = useState('')
  const [selectedKbId, setSelectedKbId] = useState('')

  const { lessons, isLoading: lessonsLoading, completeLesson } = useCourseLessons(selectedCourseId)

  const selectedCourse = courses.find((c) => c.id === selectedCourseId)

  const handleCreate = async () => {
    if (!newTitle.trim() || !selectedKbId) return
    await createCourse(newTitle.trim(), selectedKbId)
    setShowCreate(false)
    setNewTitle('')
  }

  const statusLabel = (status: string) => {
    if (status === 'completed') return '✓'
    if (status === 'in_progress') return '▶'
    if (status === 'ready') return '○'
    return '🔒'
  }

  return (
    <div className="flex h-full overflow-hidden">
      {/* Sidebar */}
      <div className="flex w-56 flex-col border-r bg-background">
        <div className="flex items-center justify-between border-b px-3 py-3">
          <span className="text-sm font-medium">{t('tutor.title')}</span>
          <button
            type="button"
            className="rounded p-1 text-xs hover:bg-muted"
            onClick={() => setShowCreate(!showCreate)}>
            +
          </button>
        </div>

        {showCreate && (
          <div className="border-b p-3 space-y-2">
            <input
              className="w-full rounded border bg-background px-2 py-1 text-xs"
              placeholder={t('tutor.course_name')}
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
            />
            <select
              className="w-full rounded border bg-background px-2 py-1 text-xs"
              value={selectedKbId}
              onChange={(e) => setSelectedKbId(e.target.value)}>
              <option value="">{t('tutor.select_kb')}</option>
              {bases.map((kb) => (
                <option key={kb.id} value={kb.id}>
                  {kb.name}
                </option>
              ))}
            </select>
            <button
              type="button"
              className="w-full rounded bg-primary px-2 py-1 text-xs text-primary-foreground disabled:opacity-50"
              disabled={!newTitle.trim() || !selectedKbId}
              onClick={handleCreate}>
              {t('tutor.create')}
            </button>
          </div>
        )}

        <div className="flex-1 overflow-y-auto">
          {coursesLoading ? (
            <div className="p-3 text-xs text-muted-foreground">{t('common.loading')}</div>
          ) : (
            courses.map((course) => (
              <button
                type="button"
                key={course.id}
                className={`w-full px-3 py-2 text-left text-sm hover:bg-muted ${selectedCourseId === course.id ? 'bg-muted' : ''}`}
                onClick={() => setSelectedCourseId(course.id)}>
                <div className="truncate font-medium">{course.title}</div>
                <div className="text-xs text-muted-foreground">
                  {course.completedLessons}/{course.totalLessons}
                </div>
              </button>
            ))
          )}
        </div>
      </div>

      {/* Main area */}
      <div className="flex flex-1 flex-col overflow-hidden">
        {!selectedCourse ? (
          <div className="flex flex-1 items-center justify-center text-muted-foreground text-sm">
            {t('tutor.select_course')}
          </div>
        ) : (
          <>
            <div className="flex items-center border-b px-4 py-3">
              <div>
                <h1 className="text-base font-semibold">{selectedCourse.title}</h1>
                <div className="text-xs text-muted-foreground">
                  {selectedCourse.syllabusStatus === 'building'
                    ? t('tutor.building_syllabus')
                    : `${selectedCourse.completedLessons} / ${selectedCourse.totalLessons} ${t('tutor.lessons_done')}`}
                </div>
              </div>
              {selectedCourse.totalLessons > 0 && (
                <div className="ml-auto h-2 w-32 rounded-full bg-muted">
                  <div
                    className="h-2 rounded-full bg-primary transition-all"
                    style={{
                      width: `${(selectedCourse.completedLessons / selectedCourse.totalLessons) * 100}%`
                    }}
                  />
                </div>
              )}
            </div>

            <div className="flex-1 overflow-y-auto p-4">
              {lessonsLoading ? (
                <div className="text-sm text-muted-foreground">{t('common.loading')}</div>
              ) : lessons.length === 0 ? (
                <div className="text-sm text-muted-foreground">{t('tutor.no_lessons')}</div>
              ) : (
                <div className="space-y-2">
                  {lessons.map((lesson) => (
                    <div
                      key={lesson.id}
                      className={`flex items-center rounded-lg border p-3 ${lesson.status === 'in_progress' ? 'border-primary bg-primary/5' : ''}`}>
                      <span className="mr-3 w-4 text-center text-sm">{statusLabel(lesson.status)}</span>
                      <span className={`flex-1 text-sm ${lesson.status === 'locked' ? 'text-muted-foreground' : ''}`}>
                        {lesson.title}
                      </span>
                      {(lesson.status === 'ready' || lesson.status === 'in_progress') && (
                        <button
                          type="button"
                          className="ml-3 rounded bg-primary px-3 py-1 text-xs text-primary-foreground"
                          onClick={() => completeLesson(lesson.id)}>
                          {t('tutor.complete_lesson')}
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  )
}

export default TutorPage
