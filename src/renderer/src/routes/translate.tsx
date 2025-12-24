import TranslatePage from '@renderer/pages/translate/TranslatePage'
import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/translate')({
  component: TranslatePage
})
