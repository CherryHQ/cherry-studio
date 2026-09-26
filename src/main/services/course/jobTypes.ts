export interface BuildSyllabusJobInput {
  courseId: string
}

declare module '@main/core/job/jobRegistry' {
  interface JobRegistry {
    'course.build-syllabus': BuildSyllabusJobInput
  }
}
