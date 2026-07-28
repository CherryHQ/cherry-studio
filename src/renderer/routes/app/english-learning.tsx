import { EnglishLearningLayout } from '@renderer/pages/englishLearning/EnglishLearningLayout'
import { createFileRoute, Outlet } from '@tanstack/react-router'

export const Route = createFileRoute('/app/english-learning')({
  component: () => (
    <EnglishLearningLayout>
      <Outlet />
    </EnglishLearningLayout>
  )
})
