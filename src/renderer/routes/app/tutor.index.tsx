import { createFileRoute } from '@tanstack/react-router'

import TutorPage from '@renderer/pages/tutor/TutorPage'

export const Route = createFileRoute('/app/tutor/')({
  component: TutorPage
})
