import { SettingsPage } from '@renderer/pages/englishLearning/SettingsPage'
import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/app/english-learning/settings')({
  component: SettingsPage
})
